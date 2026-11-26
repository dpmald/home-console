import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { openKitchen } from './helpers/kiosk-browser.mjs';

test('Hey Kitchen starts one conversation, handles follow-ups and returns to local standby', async t => {
  const page = await openKitchen(t, { viewport: { width: 1920, height: 1080 } });
  const wakeAudio = readFileSync('tests/fixtures/voice-wake/hey-kitchen.wav').toString('base64');
  // Synthetic device audio, with real browser media tracks, acoustic model and WebRTC transport.
  await page.evaluate(() => {
    const tracks = [];
    const audio = new AudioContext();
    const microphones = [];
    const messages = [];
    navigator.mediaDevices.getUserMedia = async () => {
      await audio.resume();
      const dest = audio.createMediaStreamDestination();
      microphones.push(dest);
      tracks.push(...dest.stream.getTracks());
      return dest.stream;
    };
    window.voiceFixture = {
      tracks, messages, peers: [], audio, channel: null,
      async speak(base64) {
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const source = audio.createBufferSource();
        source.buffer = await audio.decodeAudioData(bytes.buffer);
        source.connect(microphones.at(-1));
        source.start();
      },
    };
  });
  let sessions = 0;
  await page.route('**/api/voice/session', async route => {
    sessions++;
    const sdp = await page.evaluate(async offer => {
      const f = window.voiceFixture;
      const peer = new RTCPeerConnection();
      f.peers.push(peer);
      peer.ondatachannel = ({ channel }) => {
        f.channel = channel;
        channel.onmessage = event => f.messages.push(JSON.parse(event.data));
      };
      await peer.setRemoteDescription({ type: 'offer', sdp: offer });
      await peer.setLocalDescription(await peer.createAnswer());
      if (peer.iceGatheringState !== 'complete') await new Promise(resolve => {
        peer.onicegatheringstatechange = () => { if (peer.iceGatheringState === 'complete') resolve(); };
      });
      return peer.localDescription.sdp;
    }, route.request().postData());
    await route.fulfill({ contentType: 'application/sdp', body: sdp });
  });
  async function provider(event) {
    await page.evaluate(value => window.voiceFixture.channel.send(JSON.stringify(value)), event);
  }
  async function tool(id, name, args, status = 'completed') {
    await provider({ type: 'response.done', response: { id: 'response_' + id, status, output: [
      { type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) },
    ] } });
  }
  async function result(id) {
    await page.waitForFunction(id => window.voiceFixture.messages.some(m => m.item?.call_id === id), id);
    return page.evaluate(id => JSON.parse(window.voiceFixture.messages.find(m => m.item?.call_id === id).item.output), id);
  }
  const dock = page.locator('.hearth-dock');
  const launcher = dock.getByRole('button', { name: /Kitchen voice|Hey Kitchen on/i });
  const dialog = page.getByRole('dialog');
  const wake = dialog.getByRole('switch', { name: 'Hands-free wake' });

  await launcher.click();
  assert.equal(await wake.getAttribute('aria-checked'), 'false');
  assert.equal(await page.evaluate(() => window.voiceFixture.tracks.length), 0);
  await wake.click();
  await dialog.getByText('Listening for “Hey Kitchen”').waitFor();
  await dialog.getByRole('button', { name: 'Close Kitchen voice' }).click();
  assert.equal(sessions, 0);
  await page.evaluate(audio => window.voiceFixture.speak(audio), wakeAudio);
  await dialog.getByRole('heading', { name: 'Listening' }).waitFor();
  assert.equal(sessions, 1);
  assert.deepEqual(await page.evaluate(() => window.voiceFixture.tracks.map(t => t.readyState)), ['ended', 'live']);

  await tool('timer1', 'set_timer', { seconds: 75, label: 'Pasta' });
  assert.equal((await result('timer1')).ok, true);
  await tool('timer1', 'set_timer', { seconds: 75, label: 'Pasta' });
  await tool('cancelled1', 'set_timer', { seconds: 10, label: 'Interrupted' }, 'cancelled');
  await tool('context1', 'get_console_context', {});
  const context = await result('context1');
  assert.equal(context.ok, true);
  assert.equal(context.timers.length, 1);
  assert.equal(context.timers[0].label, 'Pasta');
  assert.equal(await page.evaluate(() => window.voiceFixture.messages.filter(m => m.item?.call_id === 'timer1').length), 1);
  await provider({ type: 'response.output_audio_transcript.done', transcript: 'Your pasta timer is running.' });
  await dialog.getByText('Your pasta timer is running.').waitFor();
  await provider({ type: 'output_audio_buffer.started' });
  await dialog.getByRole('heading', { name: 'Speaking' }).waitFor();
  await provider({ type: 'input_audio_buffer.speech_started' });
  await dialog.getByRole('heading', { name: 'Listening' }).waitFor();
  assert.equal(sessions, 1);

  await tool('grocery1', 'add_grocery_items', { items: [{ name: 'synthetic test item' }] });
  assert.equal((await result('grocery1')).ok, false); // Isolated route rejects the write.
  await tool('end1', 'end_session', {});
  await dialog.waitFor({ state: 'hidden' });
  await dock.getByRole('button', { name: 'Hey Kitchen on' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.voiceFixture.tracks.map(t => t.readyState)), ['ended', 'ended', 'live']);

  await launcher.click();
  await wake.click();
  await page.waitForFunction(() => window.voiceFixture.tracks.every(t => t.readyState === 'ended'));
  assert.equal(await wake.getAttribute('aria-checked'), 'false');
  // Typed entry starts a new conversation without opening a microphone.
  await dialog.getByRole('textbox').fill('Show my timers');
  await dialog.getByRole('button', { name: 'Send' }).click();
  await page.waitForFunction(() => window.voiceFixture.messages.some(m => m.item?.content?.[0]?.text === 'Show my timers'));
  assert.equal(sessions, 2);
  assert.equal(await page.evaluate(() => window.voiceFixture.tracks.length), 3);
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await dialog.boundingBox();
  assert.ok(panel.x >= 0 && panel.x + panel.width <= 390 && panel.y >= 0 && panel.y + panel.height <= 844);
  await dialog.getByRole('button', { name: 'End conversation' }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('home-console.wake.enabled')), '0');
});

test('failed connection preserves a typed question and late mic permission cannot reopen a closed conversation', async t => {
  const page = await openKitchen(t, { viewport: { width: 1280, height: 720 } });
  const launcher = page.locator('.hearth-dock').getByRole('button', { name: 'Kitchen voice', exact: true });
  const dialog = page.getByRole('dialog');
  await launcher.click();
  const prompt = 'What is on the calendar?';
  await dialog.getByRole('textbox').fill(prompt);
  await dialog.getByRole('button', { name: 'Send' }).click();
  await dialog.getByText(/Kitchen voice is unavailable/).waitFor();
  assert.equal(await dialog.getByRole('textbox').inputValue(), prompt);

  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => {
      window.grantTestMic = () => {
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        window.lateTrack = destination.stream.getAudioTracks()[0];
        resolve(destination.stream);
        void context.close();
      };
    });
  });
  await dialog.getByRole('button', { name: 'Talk', exact: true }).click();
  await page.waitForFunction(() => Boolean(window.grantTestMic));
  await dialog.getByRole('button', { name: 'Close Kitchen voice' }).click();
  await page.evaluate(() => window.grantTestMic());
  await page.waitForFunction(() => window.lateTrack.readyState === 'ended');
  assert.equal(await dialog.isVisible(), false);
});
