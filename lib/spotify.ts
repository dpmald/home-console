// Spotify Web API integration (Option 1: controls the background Spotify Android
// app on the Cozyla 24" via Spotify Connect, so the screen never leaves the kiosk).

export interface SpotifyNowPlaying {
  configured: boolean;
  playing: boolean;
  track?: string;
  artist?: string;
  albumArt?: string;
  deviceName?: string;
  deviceId?: string;
  progressMs?: number;
  durationMs?: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export function isSpotifyConfigured(): boolean {
  return Boolean(
    process.env.SPOTIFY_CLIENT_ID &&
      process.env.SPOTIFY_CLIENT_SECRET &&
      process.env.SPOTIFY_REFRESH_TOKEN,
  );
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  const refresh = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!id || !secret || !refresh) {
    throw new Error('Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET / SPOTIFY_REFRESH_TOKEN');
  }
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
    }),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Spotify token error ${r.status}: ${await r.text()}`);
  const j = await r.json();
  cachedToken = {
    token: j.access_token,
    expiresAt: Date.now() + Number(j.expires_in || 3600) * 1000,
  };
  return cachedToken.token;
}

async function spFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
}

/** Find the Cozyla device (by SPOTIFY_DEVICE_NAME substring, active device, or first available). */
export async function resolveKitchenDeviceId(): Promise<{ id: string | null; name: string | null }> {
  const r = await spFetch('/me/player/devices');
  if (!r.ok) return { id: null, name: null };
  const j = await r.json();
  const devices: { id: string; name: string; is_active: boolean }[] = j.devices ?? [];
  if (!devices.length) return { id: null, name: null };

  const preferred = (process.env.SPOTIFY_DEVICE_NAME || '').trim().toLowerCase();
  const match =
    (preferred && devices.find((d) => d.name.toLowerCase().includes(preferred))) ||
    devices.find((d) => d.is_active) ||
    devices[0];
  return { id: match?.id ?? null, name: match?.name ?? null };
}

export async function getNowPlaying(): Promise<SpotifyNowPlaying> {
  if (!isSpotifyConfigured()) return { configured: false, playing: false };
  const r = await spFetch('/me/player');
  if (r.status === 204 || !r.ok) {
    const dev = await resolveKitchenDeviceId();
    return { configured: true, playing: false, deviceName: dev.name ?? undefined, deviceId: dev.id ?? undefined };
  }
  const j = await r.json();
  return {
    configured: true,
    playing: Boolean(j.is_playing),
    track: j.item?.name,
    artist: (j.item?.artists ?? []).map((a: any) => a.name).join(', '),
    albumArt: j.item?.album?.images?.[0]?.url,
    deviceName: j.device?.name,
    deviceId: j.device?.id,
    progressMs: j.progress_ms,
    durationMs: j.item?.duration_ms,
  };
}

export async function controlSpotify(action: {
  op: 'play' | 'pause' | 'next' | 'previous';
  query?: string;
  uri?: string;
}): Promise<{ ok: boolean; playing?: string; device?: string; needsWake?: boolean; error?: string }> {
  if (!isSpotifyConfigured()) {
    return { ok: false, error: 'Spotify is not configured in .env.local yet' };
  }

  const dev = await resolveKitchenDeviceId();
  const qs = dev.id ? `?device_id=${encodeURIComponent(dev.id)}` : '';

  if (action.op !== 'play') {
    const response = await spFetch(`/me/player/${action.op}${qs}`, { method: action.op === 'pause' ? 'PUT' : 'POST' });
    return response.ok ? { ok: true, device: dev.name ?? undefined }
      : { ok: false, error: 'Spotify could not confirm the playback change.' };
  }

  // Play (either resume, play a specific URI, or search for a query first)
  if (!dev.id) {
    return {
      ok: false,
      needsWake: true,
      error: 'Cozyla Spotify app is asleep — waking com.spotify.music in background.',
    };
  }

  let body: Record<string, unknown> | undefined;
  let label = 'Resumed playback';

  if (action.uri) {
    body = action.uri.includes(':track:') ? { uris: [action.uri] } : { context_uri: action.uri };
    label = action.uri;
  } else if (action.query && action.query.trim()) {
    const q = action.query.trim();
    const sr = await spFetch(`/search?q=${encodeURIComponent(q)}&type=playlist,album,artist,track&limit=1`);
    if (sr.ok) {
      const sj = await sr.json();
      const playlist = sj.playlists?.items?.[0];
      const album = sj.albums?.items?.[0];
      const artist = sj.artists?.items?.[0];
      const track = sj.tracks?.items?.[0];
      const pick = playlist || album || artist || track;
      if (pick?.uri) {
        body = pick.uri.includes(':track:') ? { uris: [pick.uri] } : { context_uri: pick.uri };
        label = `${pick.name}${pick.artists?.[0]?.name ? ` — ${pick.artists[0].name}` : ''}`;
      }
    }
    if (!body) return { ok: false, error: 'Spotify could not find that selection.' };
  }

  const pr = await spFetch(`/me/player/play${qs}`, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!pr.ok && pr.status === 404) {
    return { ok: false, needsWake: true, error: 'Spotify device not active yet' };
  }
  if (!pr.ok) return { ok: false, error: 'Spotify could not confirm playback.' };
  return { ok: true, playing: label, device: dev.name ?? undefined };
}
