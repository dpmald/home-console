import { wakePhrase } from './wake-phrase';

async function loadModelAsset(filename: string, signal: AbortSignal) {
  const response = await fetch(`/voice-wake/${filename}`, { signal, cache: 'force-cache' });
  if (!response.ok) throw new Error('The wake-word model could not load. Check the connection and try again.');
  return response;
}

async function loadDetector(signal: AbortSignal) {
  const [{ createKeywordSpotter }, data, metadata] = await Promise.all([
    import('@sherpaw/kws'),
    loadModelAsset('zipformer-4ca3ae0d.data', signal).then((r) => r.arrayBuffer()),
    loadModelAsset('zipformer-e7e22329.json', signal).then((r) => r.json()),
  ]);
  signal.throwIfAborted();
  return createKeywordSpotter({ model: { data, metadata }, keywords: [wakePhrase], signal });
}

/** Resolves when local listening is ready. Abort also cancels a pending start. */
export async function startWakeListener(
  onWake: () => void,
  onError: (error: Error) => void,
  signal: AbortSignal,
): Promise<() => void> {
  signal.throwIfAborted();
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined'
    || typeof AudioWorkletNode === 'undefined' || typeof WebAssembly === 'undefined') {
    throw new Error('Hands-free voice needs microphone access and a recent browser on HTTPS.');
  }

  const context = new AudioContext();
  const lifetime = new AbortController();
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let capture: AudioWorkletNode | undefined;
  let resumeDeadline: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    signal.removeEventListener('abort', stop);
    clearTimeout(resumeDeadline);
    stream?.getTracks().forEach((track) => track.stop());
    source?.disconnect();
    capture?.port.close();
    capture?.disconnect();
    context.onstatechange = null;
    void context.close().catch(() => {});
  };
  const fail = (message: string) => {
    if (lifetime.signal.aborted) return;
    stop();
    onError(new Error(message));
  };
  signal.addEventListener('abort', stop, { once: true });
  // getUserMedia has no abort option. Release a subsequently granted track even
  // if the user disabled listening while the browser permission sheet was open.
  const openMicrophone = async () => {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (lifetime.signal.aborted) {
      mic.getTracks().forEach((track) => track.stop());
      lifetime.signal.throwIfAborted();
    }
    stream = mic;
    return mic;
  };

  try {
    // Initiate resume on the enable tap. A restored preference can encounter a
    // fresh browser autoplay gate, so give the UI a recoverable error in that case.
    const resume = new Promise<void>((resolve, reject) => {
      resumeDeadline = setTimeout(() => reject(new Error('Tap to enable hands-free audio on this device.')), 12000);
      context.resume().then(resolve, reject);
    });
    const cancelled = new Promise<never>((_, reject) => {
      lifetime.signal.addEventListener('abort', () => reject(lifetime.signal.reason), { once: true });
    });
    const setup = Promise.all([
      openMicrophone(), loadDetector(lifetime.signal), context.audioWorklet.addModule('/voice-wake/capture.js'), resume,
    ]);
    const [mic, detector] = await Promise.race([setup, cancelled]);
    lifetime.signal.throwIfAborted();
    clearTimeout(resumeDeadline);
    if (context.state !== 'running' || !mic.active) throw new Error('The device microphone is paused. Tap to try again.');

    source = context.createMediaStreamSource(mic);
    capture = new AudioWorkletNode(context, 'kitchen-wake-capture', {
      channelCount: 1, channelCountMode: 'explicit', numberOfOutputs: 1, outputChannelCount: [1],
    });
    const listen = async (samples: Float32Array) => {
      try {
        const hits = await detector.processAudio(samples, context.sampleRate);
        if (!lifetime.signal.aborted && hits.some((hit) => hit.label === wakePhrase.label)) {
          stop();
          onWake();
        }
      } catch {
        fail('Wake-word recognition stopped. Tap to try again.');
      }
    };
    capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (!lifetime.signal.aborted) void listen(event.data);
    };
    capture.onprocessorerror = () => fail('Audio capture stopped. Tap to try again.');
    mic.getAudioTracks().forEach((track) => {
      track.addEventListener('ended', () => fail('The microphone disconnected. Tap to try again.'), { once: true });
    });
    context.onstatechange = () => {
      if (context.state !== 'running') fail('Hands-free audio paused. Tap to try again.');
    };
    // The worklet writes silence to its output and forwards input only to the local worker.
    source.connect(capture).connect(context.destination);
    return stop;
  } catch (error) {
    stop();
    throw error;
  }
}
