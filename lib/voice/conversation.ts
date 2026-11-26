import { CLIENT_TOOL_NAMES } from './tools';
import { voiceResultSucceeded } from './request';

export type ConversationStatus = 'connecting' | 'listening' | 'typing' | 'speaking';
export type VoiceClientTool = (name: string, args: Record<string, unknown>) => unknown | Promise<unknown>;

interface Callbacks {
  onStatus: (state: ConversationStatus) => void;
  onCaption: (text: string) => void;
  onClientTool: VoiceClientTool;
  onServerToolDone: (name: string) => void;
  onEnded: (message?: string) => void;
  onReady: () => void;
}

const UNCONFIRMED = 'The console could not confirm this action. Check the screen before trying it again.';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Owns one peer, its microphone and the requests made during one conversation. */
export function createConversation(audio: HTMLAudioElement, callbacks: Callbacks) {
  const controller = new AbortController();
  const signal = controller.signal;
  let peer: RTCPeerConnection | undefined;
  let channel: RTCDataChannel | undefined;
  let mic: MediaStream | undefined;
  let sender: RTCRtpSender | undefined;
  let micPending = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let responseActive = false;
  let replyPending = false;
  let playing = false;
  let hearingSpeech = false;
  let ending = false;
  const completedCalls = new Set<string>();

  function close() {
    if (signal.aborted) return;
    controller.abort();
    clearTimeout(deadline);
    mic?.getTracks().forEach(track => track.stop());
    channel?.close();
    peer?.close();
    audio.pause();
    audio.srcObject = null;
  }

  function end(message?: string) {
    if (signal.aborted) return;
    close();
    callbacks.onEnded(message);
  }

  function idle() {
    clearTimeout(deadline);
    if (!hearingSpeech && !playing) deadline = setTimeout(() => end(), 90_000);
  }

  function send(payload: Record<string, unknown>) {
    if (!signal.aborted && channel?.readyState === 'open') channel.send(JSON.stringify(payload));
  }

  function requestReply() {
    if (responseActive) {
      replyPending = true;
      return;
    }
    responseActive = true;
    replyPending = false;
    send({ type: 'response.create' });
  }

  function sendText(text: string) {
    if (channel?.readyState !== 'open' || signal.aborted) return false;
    send({ type: 'conversation.item.create', item: {
      type: 'message', role: 'user', content: [{ type: 'input_text', text: text.slice(0, 1500) }],
    } });
    requestReply();
    idle();
    return true;
  }

  async function enableMicrophone() {
    if (mic || micPending || signal.aborted) return;
    micPending = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (signal.aborted) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      mic = stream;
      try {
        const track = stream.getAudioTracks()[0];
        if (!track || !sender) throw new Error('Microphone unavailable');
        track.onended = () => end('Microphone disconnected. Reconnect it and tap Talk.');
        await sender.replaceTrack(track);
      } catch (error) {
        stream.getTracks().forEach(track => track.stop());
        mic = undefined;
        throw error;
      }
      if (!signal.aborted && channel?.readyState === 'open') callbacks.onStatus('listening');
    } finally {
      micPending = false;
    }
  }

  async function execute(call: Record<string, unknown>) {
    const name = call.name;
    const id = call.call_id;
    if (typeof name !== 'string' || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || completedCalls.has(id)) return false;
    completedCalls.add(id);
    let result: unknown;
    try {
      if (typeof call.arguments !== 'string' || call.arguments.length > 32768) throw new Error();
      const args: unknown = JSON.parse(call.arguments || '{}');
      if (!record(args)) throw new Error();
      if (name === 'end_session') {
        ending = true;
        if (playing) {
          mic?.getTracks().forEach(track => track.stop());
          clearTimeout(deadline);
          deadline = setTimeout(() => end(), 4000);
        } else end();
        return false;
      }
      if (CLIENT_TOOL_NAMES.has(name)) {
        result = await callbacks.onClientTool(name, args);
      } else {
        const res = await fetch('/api/voice/tool', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, args, call_id: id }), signal,
        });
        const data: unknown = await res.json();
        result = record(data) ? data.result : null;
        if (!res.ok) throw new Error();
        if (!voiceResultSucceeded(result)) {
          if (!record(result) || result.ok !== false || result.needs_clarification !== true) throw new Error();
          result = { ok: false, needs_clarification: true,
            message: String(result.message || 'Which one did you mean?').slice(0, 250),
            choices: Array.isArray(result.choices) ? result.choices.slice(0, 12).filter(record).map(choice => ({
              ref: String(choice.ref ?? '').slice(0, 100), label: String(choice.label ?? '').slice(0, 200),
            })) : [],
          };
        } else if (!signal.aborted) {
          callbacks.onServerToolDone(name);
        }
      }
      if (!record(result)) throw new Error();
    } catch {
      result = { ok: false, error: UNCONFIRMED };
      if (!signal.aborted) callbacks.onCaption(UNCONFIRMED);
    }
    send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: id, output: JSON.stringify(result) } });
    return true;
  }

  async function onMessage(event: MessageEvent) {
    if (signal.aborted || typeof event.data !== 'string' || event.data.length > 2_000_000) return;
    let msg: unknown;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (!record(msg)) return;
    if (ending) {
      if (msg.type === 'output_audio_buffer.stopped' || msg.type === 'output_audio_buffer.cleared') end();
      return;
    }
    switch (msg.type) {
      case 'response.created':
        responseActive = true;
        break;
      case 'output_audio_buffer.started':
        playing = true;
        callbacks.onStatus('speaking');
        break;
      case 'input_audio_buffer.speech_started':
        hearingSpeech = true;
        callbacks.onStatus(mic ? 'listening' : 'typing');
        break;
      case 'output_audio_buffer.cleared':
      case 'output_audio_buffer.stopped':
        playing = false;
        callbacks.onStatus(mic ? 'listening' : 'typing');
        break;
      case 'input_audio_buffer.speech_stopped':
        hearingSpeech = false;
        break;
      case 'response.output_audio_transcript.done':
      case 'response.output_text.done': {
        const caption = msg.transcript ?? msg.text;
        if (typeof caption === 'string') callbacks.onCaption(caption.slice(0, 1800));
        break;
      }
      case 'response.done': {
        const response = msg.response;
        if (!record(response)) return;
        responseActive = false;
        if (response.status === 'failed') {
          end('Voice could not finish the reply. Check any requested change before retrying.');
          return;
        }
        let hasNewOutput = false;
        if (response.status === 'completed' && Array.isArray(response.output)) {
          // Execute in order and request one follow-up after every tool result is in the conversation.
          // A cancelled partial response must never change household data.
          for (const item of response.output) {
            if (signal.aborted || ending) return;
            if (record(item) && item.type === 'function_call') hasNewOutput = await execute(item) || hasNewOutput;
          }
        }
        if (!signal.aborted && !ending && (hasNewOutput || replyPending)) requestReply();
        break;
      }
      case 'error':
        if (record(msg.error) && msg.error.code === 'conversation_already_has_active_response') {
          responseActive = true;
          replyPending = true;
          break;
        }
        end('Voice lost the conversation. Check any requested change before retrying.');
        return;
      default:
        return;
    }
    if (!signal.aborted && !ending) idle();
  }

  async function start(useMic: boolean, firstText?: string) {
    let failure = 'Voice could not connect. Check your connection and try again.';
    try {
      deadline = setTimeout(() => end('Voice took too long to connect. Tap Talk to retry.'), 30_000);
      peer = new RTCPeerConnection();
      peer.ontrack = event => {
        if (signal.aborted) return;
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio.play().catch(() => end('Allow audio playback on this console, then tap Talk.'));
      };
      peer.onconnectionstatechange = () => {
        if (peer?.connectionState === 'failed' || peer?.connectionState === 'disconnected') end('Voice disconnected. Check the screen before retrying a change.');
      };
      sender = peer.addTransceiver('audio', { direction: 'sendrecv' }).sender;
      if (useMic) {
        failure = 'Allow microphone access in this browser, then tap Talk. You can also type a question.';
        await enableMicrophone();
        if (signal.aborted) return;
      }
      failure = 'Voice could not connect. Check your connection and try again.';
      channel = peer.createDataChannel('oai-events');
      channel.onclose = () => end('The voice connection closed. Tap Talk to reconnect.');
      channel.onerror = () => end('The voice connection was interrupted. Check the screen before retrying.');
      channel.onmessage = event => { void onMessage(event).catch(() => end('Voice could not finish this turn.')); };
      channel.onopen = () => {
        if (signal.aborted) return;
        callbacks.onStatus(mic ? 'listening' : 'typing');
        callbacks.onReady();
        idle();
        if (firstText) sendText(firstText);
      };
      const offer = await peer.createOffer();
      if (signal.aborted) return;
      await peer.setLocalDescription(offer);
      if (signal.aborted) return;
      const answer = await fetch('/api/voice/session', {
        method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: offer.sdp, signal,
      });
      if (!answer.ok) {
        if (answer.status === 401 || answer.status === 403) failure = 'Unlock this console to use Kitchen voice.';
        if (answer.status === 503) failure = 'Kitchen voice is unavailable. Check the console’s Realtime configuration and connection.';
        throw new Error();
      }
      const sdp = await answer.text();
      if (!signal.aborted) await peer.setRemoteDescription({ type: 'answer', sdp });
    } catch {
      end(failure);
    }
  }

  return { start, close, sendText, enableMicrophone };
}
