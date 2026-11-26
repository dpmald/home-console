'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createConversation, type ConversationStatus, type VoiceClientTool } from '@/lib/voice/conversation';
import { startWakeListener } from '@/lib/voice/wake';
import styles from './VoiceOrb.module.css';

const WAKE_PREFERENCE = 'home-console.wake.enabled';
type WakeStatus = 'off' | 'starting' | 'armed' | 'error';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClientTool: VoiceClientTool;
  onServerToolDone: (name: string) => void;
  onWakeStatusChange?: (armed: boolean) => void;
  initialPrompt?: string;
  suspended?: boolean;
}

function readyTone(context: AudioContext | null) {
  if (context?.state !== 'running') return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const at = context.currentTime;
  oscillator.frequency.setValueAtTime(560, at);
  oscillator.frequency.setValueAtTime(790, at + 0.09);
  gain.gain.setValueAtTime(0.045, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
  oscillator.connect(gain).connect(context.destination);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  oscillator.start(at);
  oscillator.stop(at + 0.2);
}

export function VoiceOrb(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const audio = useRef<HTMLAudioElement>(null);
  const tone = useRef<AudioContext | null>(null);
  const call = useRef<ReturnType<typeof createConversation> | null>(null);
  const detector = useRef<AbortController | null>(null);
  const wantsWake = useRef(false);
  const wakeBlocked = useRef(false);
  const mounted = useRef(false);
  const [enabled, setEnabled] = useState(false);
  const [wake, setWake] = useState<WakeStatus>('off');
  const [wakeError, setWakeError] = useState('');
  const [status, setStatus] = useState<ConversationStatus | 'idle'>('idle');
  const [caption, setCaption] = useState('');
  const [issue, setIssue] = useState('');
  const [draft, setDraft] = useState('');

  function unlockSound() {
    try {
      tone.current ??= new AudioContext();
      if (tone.current.state !== 'running') void tone.current.resume().catch(() => {});
    } catch { /* The listening label also signals readiness. */ }
  }

  const pauseWake = useCallback(() => {
    detector.current?.abort();
    detector.current = null;
    if (mounted.current) setWake('off');
  }, []);

  const endCall = useCallback(() => {
    call.current?.close();
    call.current = null;
    if (mounted.current) setStatus('idle');
  }, []);

  const startCall = useCallback((useMic: boolean, firstText?: string, woken = false) => {
    if (call.current || !audio.current || document.hidden || latest.current.suspended) return;
    pauseWake();
    setIssue('');
    setCaption('');
    setStatus('connecting');
    latest.current.onOpenChange(true);
    const session = createConversation(audio.current, {
      onClientTool: (name, args) => latest.current.onClientTool(name, args),
      onServerToolDone: name => latest.current.onServerToolDone(name),
      onCaption: setCaption,
      onStatus: setStatus,
      onReady: () => {
        if (firstText) setDraft(current => current.trim() === firstText ? '' : current);
        if (!useMic) return;
        // A restored hands-free preference can wake before anyone has opened the panel.
        unlockSound();
        const context = tone.current;
        if (context?.state === 'running') readyTone(context);
        else void context?.resume().then(() => { if (call.current === session) readyTone(context); }).catch(() => {});
      },
      onEnded: error => {
        call.current = null;
        setStatus('idle');
        setIssue(error || '');
        if (!error) latest.current.onOpenChange(false);
        // A configuration or connection failure must not repeatedly open paid sessions.
        if (error && woken) {
          wakeBlocked.current = true;
          setWake('error');
          setWakeError('Hands-free is paused. Check the connection, then retry.');
        }
      },
    });
    call.current = session;
    void session.start(useMic, firstText);
  }, [pauseWake]);

  const arm = useCallback(() => {
    if (!mounted.current || !wantsWake.current || wakeBlocked.current || document.hidden
        || latest.current.suspended || call.current || detector.current) return;
    const controller = new AbortController();
    detector.current = controller;
    setWake('starting');
    const failed = (error: Error) => {
      if (controller.signal.aborted || detector.current !== controller) return;
      controller.abort();
      detector.current = null;
      wakeBlocked.current = true;
      setWakeError(error.message.slice(0, 240) || 'Check microphone access and retry.');
      setWake('error');
    };
    void startWakeListener(() => {
      if (!controller.signal.aborted && detector.current === controller) startCall(true, undefined, true);
    }, failed, controller.signal).then(stop => {
      if (controller.signal.aborted) stop();
      else setWake('armed');
    }).catch(failed);
  }, [startCall]);

  useEffect(() => {
    mounted.current = true;
    try { wantsWake.current = localStorage.getItem(WAKE_PREFERENCE) === '1'; } catch { /* Private mode. */ }
    setEnabled(wantsWake.current);
    arm();
    const suspend = () => {
      pauseWake();
      endCall();
      setCaption('');
    };
    const visibility = () => { if (document.hidden) suspend(); else arm(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', arm);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('pageshow', arm);
      pauseWake();
      endCall();
      void tone.current?.close().catch(() => {});
      tone.current = null;
    };
  }, [arm, endCall, pauseWake]);

  useEffect(() => {
    if (props.suspended) {
      pauseWake();
      endCall();
    } else if (status === 'idle') arm();
  }, [status, props.suspended, enabled, arm, endCall, pauseWake]);

  // The board can close the panel when a different kiosk interaction takes focus.
  useEffect(() => {
    if (!props.open) { endCall(); setCaption(''); setIssue(''); setDraft(''); }
    else setDraft(props.initialPrompt || '');
  }, [props.open, props.initialPrompt, endCall]);

  useEffect(() => { latest.current.onWakeStatusChange?.(wake === 'armed'); }, [wake]);

  const closePanel = useCallback(() => {
    endCall();
    latest.current.onOpenChange(false);
  }, [endCall]);

  useEffect(() => {
    if (!props.open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') closePanel(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [props.open, closePanel]);

  function preferWake(value: boolean) {
    wantsWake.current = value;
    setEnabled(value);
    wakeBlocked.current = false;
    setWakeError('');
    try { localStorage.setItem(WAKE_PREFERENCE, value ? '1' : '0'); } catch { /* This tab still works. */ }
    if (value) { unlockSound(); arm(); }
    else { pauseWake(); endCall(); }
  }

  function sendDraft() {
    const text = draft.trim();
    if (!text || status === 'connecting') return;
    unlockSound();
    if (call.current) {
      if (!call.current.sendText(text)) return;
      setDraft('');
    } else startCall(false, text);
  }

  const live = status !== 'idle';
  const heading = { idle: 'Kitchen voice', connecting: 'Connecting…', listening: 'Listening',
    speaking: 'Speaking', typing: 'Ready for your question' }[status];
  const handsFree = wake === 'armed' ? 'Listening for “Hey Kitchen”'
    : wake === 'starting' ? 'Starting wake detection…'
    : enabled && live ? 'Resumes after this conversation' : 'Say “Hey Kitchen”, wait for the tone, then ask.';

  return <>
    <audio ref={audio} autoPlay playsInline />
    {props.open && <section role="dialog" aria-labelledby="kitchen-assistant-title" className={styles.panel}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.indicator} data-live={live} aria-hidden="true" />
          <h2 id="kitchen-assistant-title" aria-live="polite">{heading}</h2>
        </div>
        <button type="button" className={styles.close} onClick={closePanel} aria-label="Close Kitchen voice">×</button>
      </header>
      <div className={styles.reply} role="status">
        {issue || caption || (status === 'listening' ? 'Go ahead. You can ask a follow-up or interrupt.'
          : status === 'connecting' ? 'Wait for the listening cue.'
          : 'Ask about the family schedule, change dinner, or start a timer.')}
      </div>
      <div className={styles.controls}>
        {(!live || status === 'typing') && <button type="button" className={styles.talk} onClick={() => {
          unlockSound();
          setIssue('');
          if (!call.current) startCall(true);
          else void call.current.enableMicrophone().catch(() => setIssue('Allow microphone access to talk, or keep typing.'));
        }}>Talk</button>}
        {live && <button type="button" className={styles.end} onClick={closePanel}>End conversation</button>}
      </div>
      <form className={styles.form} onSubmit={event => { event.preventDefault(); sendDraft(); }}>
        <input aria-label="Question for Kitchen voice" placeholder="Type a question…" maxLength={1500}
          value={draft} onChange={event => setDraft(event.target.value)} />
        <button type="submit" disabled={!draft.trim() || status === 'connecting'}>Send</button>
      </form>
      <div className={styles.setting}>
        <div>
          <strong>Hands-free wake</strong>
          <small>{enabled && wakeError && !live ? wakeError : handsFree}</small>
        </div>
        <button type="button" role="switch" aria-checked={enabled} aria-label="Hands-free wake"
          className={styles.toggle} onClick={() => preferWake(!enabled)}>{enabled ? 'On' : 'Off'}</button>
      </div>
      {enabled && wakeError && !live && <button type="button" onClick={() => preferWake(true)}>Retry wake detection</button>}
      <p className={styles.privacy}>Wake detection runs on this device. Conversations use OpenAI.</p>
    </section>}
  </>;
}
