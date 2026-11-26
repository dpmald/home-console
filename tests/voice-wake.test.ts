import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createKeywordSpotter } from '@sherpaw/kws/node';
import { wakePhrase } from '../lib/voice/wake-phrase';

// Synthetic 16 kHz mono PCM clips rendered with Windows Speech (David and Zira).
// These files exercise real inference without needing a mic, account or network.
async function readClip(name: string) {
  const wav = await readFile(`tests/fixtures/voice-wake/${name}.wav`);
  const data = wav.indexOf('data') + 8;
  const sampleCount = wav.readUInt32LE(data - 4) / 2;
  const samples = new Float32Array(sampleCount + 16000); // Drain the streaming decoder.
  for (let i = 0; i < sampleCount; i++) samples[i] = wav.readInt16LE(data + i * 2) / 32768;
  return samples;
}

test('offline English model recognizes Hey Kitchen and rejects a similar sounding phrase', async (t) => {
  const detector = await createKeywordSpotter({
    model: {
      data: await readFile('public/voice-wake/zipformer-4ca3ae0d.data'),
      metadata: JSON.parse(await readFile('public/voice-wake/zipformer-e7e22329.json', 'utf8')),
    },
    keywords: [wakePhrase],
  });
  t.after(() => detector.dispose());

  for (const [name, expected] of [['hey-chicken', []], ['hey-kitchen', ['Hey Kitchen']]] as const) {
    await detector.reset();
    const clip = await readClip(name);
    const detected = [];
    for (let i = 0; i < clip.length; i += 1600) {
      const hits = await detector.processAudio(clip.subarray(i, i + 1600), 16000);
      detected.push(...hits.map((hit) => hit.label));
    }
    assert.deepEqual(detected, expected, name);
  }
});
