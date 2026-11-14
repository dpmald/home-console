'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CLIENT_TOOL_NAMES } from '@/lib/voice/tools';

export interface VoiceClientHandlers {
  onStartTimer: (seconds: number, label: string) => void;
  onCancelTimers: () => void;
  onPlayNpr: () => void;
  onStopNpr: () => void;
  onServerToolDone: () => void;
}

type Status = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';

const AUTO_DISCONNECT_MS = 90_000;

export function VoiceOrb(props: VoiceClientHandlers) {
  const [status, setStatus] = useState<Status>('idle');
  const [caption, setCaption] = useState<string>('');
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlers = useRef(props);
  handlers.current = props;

  const stop = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    setStatus('idle');
  }, []);

  const bumpIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stop, AUTO_DISCONNECT_MS);
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  const start = async () => {
    setCaption('');
    setStatus('connecting');
    try {
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audio = audioRef.current ?? new Audio();
      audio.autoplay = true;
      audioRef.current = audio;
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
      };

      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = mic;
      mic.getTracks().forEach((t) => pc.addTrack(t, mic));

      const dc = pc.createDataChannel('oai-events');
      const send = (ev: Record<string, unknown>) => {
        if (dc.readyState === 'open') dc.send(JSON.stringify(ev));
      };

      dc.onopen = () => {
        setStatus('listening');
        bumpIdle();
      };

      dc.onmessage = async (e) => {
        bumpIdle();
        let msg: any;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === 'output_audio_buffer.started') setStatus('speaking');
        if (msg.type === 'output_audio_buffer.stopped') setStatus('listening');
        if (msg.type === 'response.output_audio_transcript.done' && msg.transcript) {
          setCaption(msg.transcript);
        }
        if (msg.type === 'response.function_call_arguments.done') {
          const name: string = msg.name;
          const call_id: string = msg.call_id;
          let args: any = {};
          try {
            args = JSON.parse(msg.arguments || '{}');
          } catch {}

          let output: unknown = { ok: true };
          if (CLIENT_TOOL_NAMES.has(name)) {
            if (name === 'set_timer') {
              const secs = Math.max(1, Math.round((Number(args.minutes) || 0) * 60 + (Number(args.seconds) || 0)));
              handlers.current.onStartTimer(secs, String(args.label || 'Timer'));
              output = { ok: true, seconds: secs };
            } else if (name === 'cancel_timers') {
              handlers.current.onCancelTimers();
            } else if (name === 'play_npr') {
              handlers.current.onPlayNpr();
            } else if (name === 'stop_npr') {
              handlers.current.onStopNpr();
            } else if (name === 'end_session') {
              setTimeout(stop, 1200);
            }
          } else {
            const r = await fetch('/api/voice/tool', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, args }),
            });
            const j = await r.json();
            output = j.result;
            handlers.current.onServerToolDone();
          }

          send({
            type: 'conversation.item.create',
            item: { type: 'function_call_output', call_id, output: JSON.stringify(output) },
          });
          send({ type: 'response.create' });
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch('/api/voice/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      });
      if (!sdpRes.ok) {
        const err = await sdpRes.text();
        throw new Error(err || `HTTP ${sdpRes.status}`);
      }
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });
    } catch (e: any) {
      console.error('voice start error', e);
      stop();
      setStatus('error');
      setCaption('Voice needs OPENAI_API_KEY + mic permission');
    }
  };

  const live = status === 'listening' || status === 'speaking' || status === 'connecting';
  const label =
    status === 'connecting'
      ? 'Connecting…'
      : status === 'listening'
        ? 'Listening — speak now'
        : status === 'speaking'
          ? 'Speaking… (tap to stop)'
          : status === 'error'
            ? 'Voice retry'
            : 'Ask Kitchen';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {caption && (
        <span style={{ color: 'var(--muted)', fontSize: '0.92rem', maxWidth: 320, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          “{caption}”
        </span>
      )}
      <button className={`voice-btn ${live ? 'live' : ''}`} onClick={live ? stop : start}>
        <span className="dot" />
        🎙️ {label}
      </button>
    </div>
  );
}
