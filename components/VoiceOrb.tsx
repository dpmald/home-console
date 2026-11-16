'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CLIENT_TOOL_NAMES } from '@/lib/voice/tools';
import { voiceResultSucceeded } from '@/lib/voice/request';

export interface VoiceClientHandlers {
  onStartTimer: (seconds: number, label: string) => void;
  onCancelTimers: () => void;
  onPlayNpr: () => void;
  onStopNpr: () => void;
  onServerToolDone: (name?: string) => void;
}

type Status = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';
const AUTO_DISCONNECT_MS = 90_000;
const TOOL_FAILURE = 'That change was not confirmed. Please check the list before trying again.';

export function VoiceOrb(props: VoiceClientHandlers) {
  const [status, setStatus] = useState<Status>('idle');
  const [caption, setCaption] = useState('');
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const handlers = useRef(props);
  handlers.current = props;

  const stop = useCallback(() => {
    ++generation.current;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (endTimer.current) clearTimeout(endTimer.current);
    idleTimer.current = null;
    endTimer.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
    if (mounted.current) setStatus('idle');
  }, []);

  const bumpIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stop, AUTO_DISCONNECT_MS);
  }, [stop]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop(); };
  }, [stop]);

  const start = async () => {
    // A second click before React re-renders must not start another microphone.
    if (abortRef.current) return;
    const session = ++generation.current;
    const active = () => mounted.current && generation.current === session;
    const controller = new AbortController();
    abortRef.current = controller;
    const outputs = new Map<string, Promise<unknown>>();
    setCaption('');
    setStatus('connecting');
    try {
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      const audio = audioRef.current ?? new Audio();
      audio.autoplay = true;
      audioRef.current = audio;
      pc.ontrack = (event) => { if (active()) audio.srcObject = event.streams[0]; };
      pc.onconnectionstatechange = () => {
        if (active() && pc.connectionState === 'failed') {
          stop();
          setStatus('error');
          setCaption('Voice disconnected. Please check the list before trying again.');
        }
      };

      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!active()) {
        mic.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = mic;
      mic.getTracks().forEach((track) => pc.addTrack(track, mic));
      const dc = pc.createDataChannel('oai-events');
      const send = (event: Record<string, unknown>) => {
        if (active() && dc.readyState === 'open') dc.send(JSON.stringify(event));
      };
      dc.onopen = () => {
        if (!active()) return;
        setStatus('listening');
        bumpIdle();
      };

      const execute = async (name: string, callId: string, argumentText: unknown): Promise<unknown> => {
        try {
          if (typeof argumentText !== 'string' || argumentText.length > 32768) throw new Error('invalid arguments');
          const args = JSON.parse(argumentText || '{}') as Record<string, unknown>;
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('invalid arguments');
          if (!active()) return { ok: false, error: 'Voice session ended.' };
          if (CLIENT_TOOL_NAMES.has(name)) {
            if (name === 'set_timer') {
              const total = Number(args.minutes ?? 0) * 60 + Number(args.seconds ?? 0);
              if (!Number.isFinite(total) || total <= 0 || total > 86400) throw new Error('invalid timer');
              const seconds = Math.round(total);
              handlers.current.onStartTimer(seconds, String(args.label || 'Timer').slice(0, 100));
              return { ok: true, seconds };
            }
            if (name === 'cancel_timers') handlers.current.onCancelTimers();
            if (name === 'play_npr') handlers.current.onPlayNpr();
            if (name === 'stop_npr') handlers.current.onStopNpr();
            if (name === 'end_session') endTimer.current = setTimeout(() => { if (active()) stop(); }, 1200);
            return { ok: true };
          }
          const response = await fetch('/api/voice/tool', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, args, call_id: callId }),
            signal: controller.signal,
          });
          const body: unknown = await response.json();
          const result = body && typeof body === 'object' && 'result' in body ? body.result : null;
          if (!response.ok || !voiceResultSucceeded(result)) throw new Error('tool failed');
          if (active()) handlers.current.onServerToolDone(name);
          return result;
        } catch {
          if (active()) setCaption(TOOL_FAILURE);
          return { ok: false, error: TOOL_FAILURE };
        }
      };

      dc.onmessage = async (event) => {
        if (!active()) return;
        bumpIdle();
        let message: Record<string, unknown>;
        try {
          if (typeof event.data !== 'string' || event.data.length > 65536) return;
          message = JSON.parse(event.data);
          if (!message || typeof message !== 'object' || Array.isArray(message)) return;
        } catch { return; }
        if (message.type === 'output_audio_buffer.started') setStatus('speaking');
        if (message.type === 'output_audio_buffer.stopped') setStatus('listening');
        if (message.type === 'response.output_audio_transcript.done' && typeof message.transcript === 'string') {
          setCaption(message.transcript.slice(0, 1200));
        }
        if (message.type !== 'response.function_call_arguments.done') return;
        const name = message.name;
        const callId = message.call_id;
        if (typeof name !== 'string' || typeof callId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(callId)) return;
        // Duplicate provider events reuse the same in-flight work and result.
        // Server-side operation IDs also protect grocery writes if the response is lost.
        const existing = outputs.get(callId);
        if (existing) return;
        const pending = execute(name, callId, message.arguments);
        outputs.set(callId, pending);
        const output = await pending;
        send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) } });
        send({ type: 'response.create' });
      };

      const offer = await pc.createOffer();
      if (!active()) return;
      await pc.setLocalDescription(offer);
      if (!active()) return;
      const response = await fetch('/api/voice/session', {
        method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: offer.sdp,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('voice unavailable');
      const answer = await response.text();
      if (!active()) return;
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    } catch {
      if (!active()) return;
      stop();
      setStatus('error');
      setCaption('Voice is unavailable. Check microphone permission, or type your request.');
    }
  };

  const live = status === 'listening' || status === 'speaking' || status === 'connecting';
  const label = status === 'connecting' ? 'Connecting…' : status === 'listening' ? 'Listening — speak now'
    : status === 'speaking' ? 'Speaking… (tap to stop)' : status === 'error' ? 'Retry kitchen voice' : 'Kitchen voice';

  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
      <button type="button" className={`voice-btn ${live ? 'live' : ''}`} aria-pressed={live}
        onClick={live ? stop : start} style={{ minHeight: 48 }}>
        <span className="dot" />🎙️ {label}
      </button>
      {caption && <span role="status" aria-live="polite" style={{ color: 'var(--muted)', fontSize: '0.92rem', maxWidth: 480 }}>
        {caption}
      </span>}
    </div>
  );
}
