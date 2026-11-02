/**
 * Mic capture on http://127.0.0.1 — parent shell may be file:// (Monaco). postMessage PCM uplink only.
 */
(function () {
  'use strict';

  const CHANNEL_CMD = 'vibe-voice-mic-cmd';
  const CHANNEL_EVT = 'vibe-voice-mic-evt';
  const IN_SAMPLE_RATE = 16000;

  let parentOrigin = '*';
  let stream = null;
  let audioContext = null;
  let processor = null;
  let pumpAbort = false;
  let trackReader = null;
  let active = false;

  function post(event, payload) {
    if (window.parent === window) return;
    window.parent.postMessage({ channel: CHANNEL_EVT, event, ...payload }, parentOrigin);
  }

  function float32ToPcm16At16k(float32, inputRate) {
    const rate = inputRate || IN_SAMPLE_RATE;
    if (Math.round(rate) === IN_SAMPLE_RATE) {
      const pcm16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
      }
      return pcm16;
    }
    const ratio = rate / IN_SAMPLE_RATE;
    const outLen = Math.max(1, Math.floor(float32.length / ratio));
    const pcm16 = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const idx = Math.min(float32.length - 1, Math.floor(i * ratio));
      const s = Math.max(-1, Math.min(1, float32[idx]));
      pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
    }
    return pcm16;
  }

  function pcm16ToB64(pcm16) {
    const uint8 = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
    let binary = '';
    for (let i = 0; i < uint8.byteLength; i++) binary += String.fromCharCode(uint8[i]);
    return window.btoa(binary);
  }

  function pcmRms(float32) {
    let sum = 0;
    for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
    return Math.sqrt(sum / float32.length);
  }

  function stop() {
    active = false;
    pumpAbort = true;
    if (trackReader) {
      trackReader.cancel().catch(() => {});
      trackReader = null;
    }
    if (processor) {
      try {
        processor.disconnect();
      } catch (_) {
        /* ignore */
      }
      processor.onaudioprocess = null;
      processor = null;
    }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().catch(() => {});
    }
    audioContext = null;
  }

  async function start() {
    stop();
    active = true;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: IN_SAMPLE_RATE },
    });
    audioContext = new window.AudioContext({ sampleRate: IN_SAMPLE_RATE });
    if (audioContext.state === 'suspended') await audioContext.resume();

    const track = stream.getAudioTracks()[0];
    post('mic-ready', {
      label: track?.label || 'microphone',
      sampleRate: audioContext.sampleRate,
    });

    const source = audioContext.createMediaStreamSource(stream);
    const gain = audioContext.createGain();
    gain.gain.value = 0;

    const uplink = (float32, rate) => {
      if (!active) return;
      const pcm16 = float32ToPcm16At16k(float32, rate);
      post('pcm', { b64: pcm16ToB64(pcm16), rms: pcmRms(float32) });
    };

    if (typeof MediaStreamTrackProcessor !== 'undefined' && track) {
      try {
        const tp = new MediaStreamTrackProcessor({ track });
        trackReader = tp.readable.getReader();
        pumpAbort = false;
        (async () => {
          while (!pumpAbort && active) {
            const { value, done } = await trackReader.read();
            if (done || pumpAbort) break;
            if (!value) continue;
            try {
              const frames = value.numberOfFrames;
              const float32 = new Float32Array(frames);
              value.copyTo(float32, { planeIndex: 0 });
              uplink(float32, value.sampleRate);
            } finally {
              value.close();
            }
          }
        })().catch((err) => post('error', { message: String(err.message || err) }));
      } catch (_) {
        /* fall through */
      }
    }

    if (!trackReader) {
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (ev) => {
        const float32 = ev.inputBuffer.getChannelData(0);
        uplink(float32, ev.inputBuffer.sampleRate || IN_SAMPLE_RATE);
      };
      source.connect(processor);
      processor.connect(gain);
    } else {
      source.connect(gain);
    }
    gain.connect(audioContext.destination);
    post('started', {});
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const data = e.data;
    if (!data || data.channel !== CHANNEL_CMD) return;
    if (data.parentOrigin) parentOrigin = data.parentOrigin;
    if (data.cmd === 'start') {
      start().catch((err) => post('error', { message: String(err.message || err) }));
    } else if (data.cmd === 'stop') {
      stop();
      post('stopped', {});
    }
  });

  post('bridge-ready', { origin: window.location.origin });
})();
