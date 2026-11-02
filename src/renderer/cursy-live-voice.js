/**
 * Cursy Live Voice — Gemini Live (Portal-style continuous PCM + chat transcriptions).
 * Portal: full Live audio dialogue on WSS; REST STT was only for Matrix chat text, not a substitute for Live.
 * Handoff: Portal Electron ^33 + localhost:3333; VIBE Electron ^28 + 127.0.0.1 static server.
 * If rms stays 0 on ScriptProcessor, uplink uses MediaStreamTrackProcessor when available.
 */
(function () {
  const LIVE_MODEL = 'models/gemini-2.5-flash-native-audio-latest';
  const LIVE_VOICE_NAME = 'Leda';
  const OUT_SAMPLE_RATE = 24000;
  const IN_SAMPLE_RATE = 16000;

  let hooks = null;
  let active = false;
  let ws = null;
  let setupCompleteReceived = false;
  let micStream = null;
  let audioContextRef = null;
  let processor = null;
  let mediaRecorder = null;
  let nextPlayTime = 0;
  let userTranscriptBuf = '';
  let assistantTranscriptBuf = '';
  let serverMsgCount = 0;
  let micChunksSent = 0;
  let micCaptureRate = IN_SAMPLE_RATE;
  let lastMicRms = 0;
  let usePortalMicUpload = false;
  let micPumpAbort = false;
  let micTrackReader = null;
  let useTrackProcessorUplink = false;
  let micBridgeIframe = null;
  let httpMicBridgeListener = false;

  function logMicChunkProgress() {
    if (micChunksSent === 1) {
      console.log(
        '[CursyLiveVoice] First mic chunk, rms',
        lastMicRms.toFixed(4),
        useTrackProcessorUplink ? '(TrackProcessor)' : '(ScriptProcessor)'
      );
    } else if (micChunksSent === 10) {
      console.log('[CursyLiveVoice] Mic streaming OK (10), rms', lastMicRms.toFixed(4));
    } else if (micChunksSent === 50) {
      console.log('[CursyLiveVoice] Mic streaming OK (50), rms', lastMicRms.toFixed(4), '— speak, pause ~1.5s');
      if (lastMicRms < 0.002) {
        console.warn(
          '[CursyLiveVoice] Mic level near silence — ScriptProcessor/TrackProcessor read zeros; try Electron 33 (Portal) or test Matrix Portal on this machine'
        );
        hooks?.onError?.('Mic capture reads silence in VIBE — Live API OK, PCM path blocked');
      }
    }
  }

  function uplinkMicPcm16(pcm16, float32ForRms) {
    if (float32ForRms) lastMicRms = pcmRms(float32ForRms);
    if (!setupCompleteReceived || !active) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      sendLiveMicPcm16(pcm16);
    } catch (err) {
      console.error('[CursyLiveVoice] ws.send failed', err);
      return;
    }
    micChunksSent += 1;
    logMicChunkProgress();
  }

  function startMicTrackProcessorPump(stream) {
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack || typeof MediaStreamTrackProcessor === 'undefined') {
      console.log('[CursyLiveVoice] MediaStreamTrackProcessor not available — ScriptProcessor uplink');
      return false;
    }
    try {
      const tp = new MediaStreamTrackProcessor({ track: audioTrack });
      micTrackReader = tp.readable.getReader();
      micPumpAbort = false;
      useTrackProcessorUplink = true;
      console.log('[CursyLiveVoice] Uplink via MediaStreamTrackProcessor');
      (async () => {
        while (!micPumpAbort && active) {
          const { value, done } = await micTrackReader.read();
          if (done || micPumpAbort) break;
          if (!value) continue;
          try {
            const frames = value.numberOfFrames;
            const float32 = new Float32Array(frames);
            value.copyTo(float32, { planeIndex: 0 });
            const pcm16 = float32ToPcm16At16k(float32, value.sampleRate);
            uplinkMicPcm16(pcm16, float32);
          } finally {
            value.close();
          }
        }
      })().catch((err) => console.error('[CursyLiveVoice] TrackProcessor pump error', err));
      return true;
    } catch (err) {
      console.warn('[CursyLiveVoice] TrackProcessor setup failed', err);
      useTrackProcessorUplink = false;
      return false;
    }
  }

  function isPortalStyleOrigin() {
    const h = window.location.hostname;
    return (
      window.location.protocol === 'http:' && (h === '127.0.0.1' || h === 'localhost')
    );
  }

  function pcmRms(float32) {
    let sum = 0;
    for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
    return Math.sqrt(sum / float32.length);
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

  function sendLiveMicPcm16(pcm16) {
    const b64 = pcm16ToB64(pcm16);
    const blob = { mimeType: 'audio/pcm;rate=16000', data: b64 };
    if (usePortalMicUpload) {
      ws.send(JSON.stringify({ realtimeInput: { mediaChunks: [blob] } }));
    } else {
      ws.send(JSON.stringify({ realtimeInput: { audio: blob } }));
    }
  }

  function nudgeSpokenGreeting() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        realtimeInput: {
          text: 'Say a brief friendly hello, then wait for the user.',
        },
      })
    );
    console.log('[CursyLiveVoice] Sent text nudge');
  }

  function playAudioPcm(base64) {
    if (!audioContextRef) return;
    const binary = window.atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    const int16Array = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) float32[i] = int16Array[i] / 32768;

    const buffer = audioContextRef.createBuffer(1, float32.length, OUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);
    const source = audioContextRef.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.destination);

    const currentTime = audioContextRef.currentTime;
    if (nextPlayTime < currentTime) nextPlayTime = currentTime;
    source.start(nextPlayTime);
    nextPlayTime += buffer.duration;
  }

  function flushTurn() {
    const userLine = userTranscriptBuf.trim();
    const assistantLine = assistantTranscriptBuf.trim();
    userTranscriptBuf = '';
    assistantTranscriptBuf = '';
    if (userLine && hooks?.onUserLine) hooks.onUserLine(userLine);
    if (assistantLine && hooks?.onAssistantLine) hooks.onAssistantLine(assistantLine);
  }

  async function transcribeRecordedUtterance(audioBlob, mimeType) {
    if (!hooks?.transcribeBlob) return;
    try {
      const buf = await audioBlob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      }
      const base64 = window.btoa(binary);
      const res = await hooks.transcribeBlob({ base64, mimeType: mimeType || 'audio/webm' });
      const text = (res?.text || '').trim();
      if (res?.success && text && text !== '[SILENCE]') {
        console.log('[CursyLiveVoice] REST STT:', text.slice(0, 120));
        if (hooks.onUserLine) hooks.onUserLine(text);
      }
    } catch (err) {
      console.warn('[CursyLiveVoice] REST STT failed', err);
    }
  }

  async function parseWsJson(raw) {
    if (raw instanceof Blob) return JSON.parse(await raw.text());
    if (raw instanceof ArrayBuffer) {
      return JSON.parse(new TextDecoder('utf-8').decode(raw));
    }
    if (typeof raw === 'string') return JSON.parse(raw);
    return JSON.parse(String(raw));
  }

  function handleServerMessage(parsed) {
    serverMsgCount += 1;
    if (parsed.error) {
      console.error('[CursyLiveVoice] Server error', parsed.error);
      hooks?.onError?.(parsed.error.message || JSON.stringify(parsed.error).slice(0, 200));
      return;
    }

    if (parsed.setupComplete) {
      setupCompleteReceived = true;
      console.log('[CursyLiveVoice] setupComplete');
      setTimeout(() => nudgeSpokenGreeting(), 600);
      hooks?.onReady?.();
      hooks?.onState?.('listening');
    }

    if (!parsed.serverContent) return;
    const sc = parsed.serverContent;
    console.log('[CursyLiveVoice] ← serverContent', Object.keys(sc).join(', '));

    if (sc.inputTranscription?.text) {
      userTranscriptBuf += sc.inputTranscription.text;
      console.log('[CursyLiveVoice] Live heard:', sc.inputTranscription.text.slice(0, 120));
    }
    if (sc.outputTranscription?.text) {
      assistantTranscriptBuf += sc.outputTranscription.text;
    }

    if (sc.modelTurn?.parts) {
      hooks?.onState?.('speaking');
      for (const p of sc.modelTurn.parts) {
        if (p.inlineData?.data) {
          playAudioPcm(p.inlineData.data);
        }
        if (p.text && !p.thought) assistantTranscriptBuf += p.text;
      }
    }

    if (sc.turnComplete) {
      console.log('[CursyLiveVoice] turnComplete');
      flushTurn();
      hooks?.onState?.('listening');
    }
  }

  function stopStream(stream) {
    if (!stream) return;
    stream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
  }

  /** Peak RMS while user might speak — picks a device that actually moves the meter. */
  function probeStreamRms(stream, durationMs) {
    return new Promise((resolve) => {
      const ctx = new window.AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(2048, 1, 1);
      let peak = 0;
      let samples = 0;
      const started = performance.now();
      proc.onaudioprocess = (ev) => {
        const f = ev.inputBuffer.getChannelData(0);
        const r = pcmRms(f);
        if (r > peak) peak = r;
        samples += 1;
        if (performance.now() - started >= durationMs) {
          proc.onaudioprocess = null;
          try {
            src.disconnect();
            proc.disconnect();
          } catch {
            /* ignore */
          }
          ctx.close().catch(() => {});
          resolve(peak);
        }
      };
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(proc);
      proc.connect(g);
      g.connect(ctx.destination);
      ctx.resume().catch(() => {});
      setTimeout(() => {
        if (proc.onaudioprocess) {
          proc.onaudioprocess = null;
          ctx.close().catch(() => {});
          resolve(peak || 0);
        }
      }, durationMs + 200);
    });
  }

  async function acquireMicStream() {
    let warmup = null;
    try {
      warmup = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      throw new Error(
        'Microphone blocked or unavailable: ' +
          (err.message || err.name) +
          '. Check Windows Settings → Privacy → Microphone for desktop apps.'
      );
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    for (const d of inputs) {
      console.log('[CursyLiveVoice] Audio input:', d.label || '(no label)', d.deviceId.slice(0, 8));
    }

    const preferred = hooks?.getPreferredMicDeviceId?.();
    const order = [];
    if (preferred) order.push(preferred);
    for (const d of inputs) {
      if (d.deviceId && !order.includes(d.deviceId)) order.push(d.deviceId);
    }
    if (!order.length) order.push('default');

    stopStream(warmup);

    let bestStream = null;
    let bestRms = 0;
    let bestLabel = '';

    for (const deviceId of order) {
      const constraints =
        deviceId === 'default'
          ? {
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
            }
          : {
              audio: {
                deviceId: { exact: deviceId },
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
            };
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        console.warn('[CursyLiveVoice] Skipping device', deviceId.slice(0, 8), err.message || err.name);
        continue;
      }
      const track = stream.getAudioTracks()[0];
      const label = track?.label || deviceId;
      console.log('[CursyLiveVoice] Probing', label, '… speak if you can');
      const peak = await probeStreamRms(stream, 700);
      console.log('[CursyLiveVoice] Probe peak rms', peak.toFixed(4), '—', label);
      if (peak > bestRms) {
        if (bestStream) stopStream(bestStream);
        bestStream = stream;
        bestRms = peak;
        bestLabel = label;
      } else {
        stopStream(stream);
      }
      if (peak >= 0.008) break;
    }

    if (!bestStream) {
      throw new Error('No microphone input devices available.');
    }

    if (bestRms < 0.002) {
      console.warn(
        '[CursyLiveVoice] All probed inputs near silence (best rms',
        bestRms.toFixed(4),
        '). Windows may be routing the wrong device or muting this app.'
      );
    } else {
      const track = bestStream.getAudioTracks()[0];
      if (track?.getSettings?.().deviceId) {
        hooks?.onMicDeviceSelected?.(track.getSettings().deviceId);
      }
    }

    console.log('[CursyLiveVoice] Using mic:', bestLabel, 'probe rms', bestRms.toFixed(4));
    return bestStream;
  }

  function stopHttpMicBridge() {
    if (micBridgeIframe?.contentWindow) {
      try {
        micBridgeIframe.contentWindow.postMessage(
          { channel: 'vibe-voice-mic-cmd', cmd: 'stop' },
          '*'
        );
      } catch {
        /* ignore */
      }
    }
    if (micBridgeIframe?.parentNode) {
      micBridgeIframe.parentNode.removeChild(micBridgeIframe);
    }
    micBridgeIframe = null;
  }

  function ensureHttpMicBridgeListener() {
    if (httpMicBridgeListener) return;
    httpMicBridgeListener = true;
    window.addEventListener('message', (e) => {
      const data = e.data;
      if (!data || data.channel !== 'vibe-voice-mic-evt') return;
      if (micBridgeIframe && e.source !== micBridgeIframe.contentWindow) return;
      if (data.event === 'pcm' && data.b64) {
        const binary = window.atob(data.b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const pcm16 = new Int16Array(
          bytes.buffer,
          bytes.byteOffset,
          Math.floor(bytes.byteLength / 2)
        );
        if (typeof data.rms === 'number') lastMicRms = data.rms;
        uplinkMicPcm16(pcm16, null);
      } else if (data.event === 'error' && data.message) {
        hooks?.onError?.(data.message);
      }
    });
  }

  async function startHttpMicBridge() {
    ensureHttpMicBridgeListener();
    let bridgeUrl = null;
    if (window.electronAPI?.getVoiceBridgeUrl) {
      const res = await window.electronAPI.getVoiceBridgeUrl();
      if (res?.success && res.url) bridgeUrl = res.url;
    }
    if (!bridgeUrl) {
      throw new Error(
        'Live mic needs the local voice bridge (HTTP server). Restart VIBE IDE or use npm start.'
      );
    }

    stopHttpMicBridge();

    return new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.title = 'VIBE voice mic bridge';
      iframe.style.cssText =
        'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;border:0;left:0;bottom:0';
      iframe.src = bridgeUrl;
      micBridgeIframe = iframe;
      document.body.appendChild(iframe);

      const timeout = setTimeout(() => {
        reject(new Error('Voice mic bridge did not become ready'));
      }, 20000);

      const onMsg = (ev) => {
        if (ev.source !== iframe.contentWindow) return;
        const d = ev.data;
        if (!d || d.channel !== 'vibe-voice-mic-evt') return;
        if (d.event === 'bridge-ready') {
          iframe.contentWindow.postMessage(
            { channel: 'vibe-voice-mic-cmd', cmd: 'start', parentOrigin: window.location.origin },
            '*'
          );
        } else if (d.event === 'started') {
          window.removeEventListener('message', onMsg);
          clearTimeout(timeout);
          console.log('[CursyLiveVoice] HTTP mic bridge streaming (main UI file://)');
          resolve();
        } else if (d.event === 'error') {
          window.removeEventListener('message', onMsg);
          clearTimeout(timeout);
          reject(new Error(d.message || 'Voice mic bridge error'));
        }
      };
      window.addEventListener('message', onMsg);
    });
  }

  function stopMicPipeline() {
    stopHttpMicBridge();
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try {
        mediaRecorder.stop();
      } catch {
        /* ignore */
      }
    }
    mediaRecorder = null;
    micPumpAbort = true;
    if (micTrackReader) {
      micTrackReader.cancel().catch(() => {});
      micTrackReader = null;
    }
    useTrackProcessorUplink = false;
    if (processor) {
      try {
        processor.disconnect();
      } catch {
        /* ignore */
      }
      processor.onaudioprocess = null;
      processor = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    if (audioContextRef && audioContextRef.state !== 'closed') {
      audioContextRef.close().catch(() => {});
    }
    audioContextRef = null;
    setupCompleteReceived = false;
    serverMsgCount = 0;
    micChunksSent = 0;
    micCaptureRate = IN_SAMPLE_RATE;
    nextPlayTime = 0;
  }

  async function connect() {
    if (!hooks?.getWsUrl) throw new Error('Live voice not initialized');
    const auth = await hooks.getWsUrl();
    if (!auth?.success || !auth.wsUrl) {
      throw new Error(auth?.error || auth?.hint || 'Could not get Live session URL');
    }

    hooks?.onState?.('connecting');
    setupCompleteReceived = false;
    serverMsgCount = 0;
    micChunksSent = 0;
    active = true;

    ws = new WebSocket(auth.wsUrl);

    ws.onerror = (e) => console.error('[CursyLiveVoice] WSS error', e);
    ws.onclose = (e) => {
      console.log('[CursyLiveVoice] WSS closed', e.code, e.reason || '', '| mic:', micChunksSent);
      if (active) {
        if (e.code !== 1000) {
          hooks?.onError?.(`Live disconnected (${e.code}${e.reason ? `: ${e.reason}` : ''})`);
        }
        disconnect(false);
      }
    };

    ws.onmessage = async (e) => {
      try {
        handleServerMessage(await parseWsJson(e.data));
      } catch (err) {
        console.error('[CursyLiveVoice] WSS parse error', err);
      }
    };

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Live WebSocket open timeout')), 20000);
      ws.onopen = () => {
        clearTimeout(t);
        console.log('[CursyLiveVoice] WSS connected');
        const instruction = String(
          hooks.getSystemInstruction?.() ||
            'You are Cursy, a warm coding co-organiser. Speak naturally and briefly.'
        ).slice(0, 4000);
        ws.send(
          JSON.stringify({
            setup: {
              model: LIVE_MODEL,
              systemInstruction: { parts: [{ text: instruction }] },
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: LIVE_VOICE_NAME },
                  },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          })
        );
        resolve();
      };
    });

    try {
      const perm = await navigator.permissions.query({ name: 'microphone' });
      console.log('[CursyLiveVoice] Browser mic permission state:', perm.state);
    } catch {
      /* permissions API optional in Electron */
    }

    const onLocalhost = isPortalStyleOrigin();
    const useHttpMicBridge = !onLocalhost;

    if (useHttpMicBridge) {
      usePortalMicUpload = true;
      console.log(
        '[CursyLiveVoice] Origin:',
        window.location.origin,
        '— file:// shell; mic via localhost bridge'
      );
      await startHttpMicBridge();
      audioContextRef = new window.AudioContext();
      if (audioContextRef.state === 'suspended') {
        await audioContextRef.resume();
      }
      micCaptureRate = IN_SAMPLE_RATE;
      hooks?.onMicReady?.({ label: 'localhost mic bridge', bridged: true, sampleRate: IN_SAMPLE_RATE });
    } else {
      usePortalMicUpload = true;
      console.log(
        '[CursyLiveVoice] Origin:',
        window.location.origin,
        '— localhost shell (legacy HTTP UI)'
      );
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: IN_SAMPLE_RATE },
      });
      audioContextRef = new window.AudioContext({ sampleRate: IN_SAMPLE_RATE });
      if (audioContextRef.state === 'suspended') {
        await audioContextRef.resume();
      }
      micCaptureRate = audioContextRef.sampleRate;
      const track = micStream.getAudioTracks()[0];
      const settings = track?.getSettings?.() || {};
      const trackInfo = track
        ? {
            label: track.label,
            muted: track.muted,
            enabled: track.enabled,
            readyState: track.readyState,
            sampleRate: settings.sampleRate,
            deviceId: settings.deviceId,
          }
        : {};
      console.log('[CursyLiveVoice] Mic device:', trackInfo, '@', micCaptureRate, 'Hz → PCM 16 kHz uplink');
      hooks?.onMicReady?.(trackInfo);
    }

    if (!micStream) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(
          () =>
            reject(
              new Error(
                'No setupComplete (msgs: ' + serverMsgCount + ') — check Live API on your key'
              )
            ),
          25000
        );
        const poll = setInterval(() => {
          if (setupCompleteReceived) {
            clearInterval(poll);
            clearTimeout(t);
            resolve();
          }
        }, 50);
      });
      hooks?.onState?.('listening');
      return;
    }

    const source = audioContextRef.createMediaStreamSource(micStream);
    const analyser = audioContextRef.createAnalyser();
    analyser.fftSize = 256;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const gainNode = audioContextRef.createGain();
    gainNode.gain.value = 0;
    const trackPump = startMicTrackProcessorPump(micStream);
    if (!trackPump) {
      processor = audioContextRef.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (ev) => {
        const float32 = ev.inputBuffer.getChannelData(0);
        const chunkRate = ev.inputBuffer.sampleRate || micCaptureRate;
        const pcm16 = usePortalMicUpload
          ? float32ToPcm16At16k(float32, IN_SAMPLE_RATE)
          : float32ToPcm16At16k(float32, chunkRate);
        uplinkMicPcm16(pcm16, float32);
      };
      if (usePortalMicUpload) {
        source.connect(analyser);
        analyser.connect(processor);
      } else {
        source.connect(processor);
        source.connect(analyser);
      }
      processor.connect(gainNode);
    } else {
      source.connect(analyser);
      analyser.connect(gainNode);
    }
    gainNode.connect(audioContextRef.destination);

    let audioChunks = [];
    let isSpeaking = false;
    let silenceTimer = null;
    try {
      mediaRecorder = new MediaRecorder(micStream, { mimeType: 'audio/webm' });
    } catch {
      mediaRecorder = new MediaRecorder(micStream);
    }
    const recorderMime = mediaRecorder.mimeType || 'audio/webm';

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: recorderMime });
      audioChunks = [];
      if (blob.size > 0) transcribeRecordedUtterance(blob, recorderMime);
    };

    const checkVad = () => {
      if (!active) return;
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const average = sum / dataArray.length;

      if (average > 18 || lastMicRms > 0.008) {
        if (!isSpeaking) {
          isSpeaking = true;
          console.log('[CursyLiveVoice] VAD: speech start (avg', Math.round(average), ')');
          if (mediaRecorder && mediaRecorder.state === 'inactive') {
            mediaRecorder.start();
          }
        }
        if (silenceTimer) {
          clearTimeout(silenceTimer);
          silenceTimer = null;
        }
      } else if (isSpeaking) {
        if (!silenceTimer) {
          silenceTimer = setTimeout(() => {
            silenceTimer = null;
            isSpeaking = false;
            console.log('[CursyLiveVoice] VAD: speech end → REST STT');
            if (mediaRecorder && mediaRecorder.state === 'recording') {
              mediaRecorder.stop();
            }
          }, 1500);
        }
      }
      requestAnimationFrame(checkVad);
    };
    requestAnimationFrame(checkVad);

    await new Promise((resolve, reject) => {
      const t = setTimeout(
        () =>
          reject(
            new Error(
              'No setupComplete (msgs: ' + serverMsgCount + ') — check Live API on your key'
            )
          ),
        25000
      );
      const poll = setInterval(() => {
        if (setupCompleteReceived) {
          clearInterval(poll);
          clearTimeout(t);
          resolve();
        }
      }, 50);
    });

    hooks?.onState?.('listening');
  }

  function disconnect(userInitiated = true) {
    active = false;
    flushTurn();
    stopMicPipeline();
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      ws = null;
    }
    hooks?.onState?.('idle');
    if (userInitiated && hooks?.onToggleUi) hooks.onToggleUi(false);
  }

  async function toggle() {
    if (active) {
      disconnect(true);
      return false;
    }
    try {
      await connect();
      hooks?.onToggleUi?.(true);
      return true;
    } catch (err) {
      console.error('[CursyLiveVoice]', err);
      hooks?.onError?.(err.message || String(err));
      hooks?.onState?.('idle');
      stopMicPipeline();
      if (ws) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        ws = null;
      }
      return false;
    }
  }

  window.CursyLiveVoice = {
    init(api) {
      hooks = api || {};
    },
    toggle,
    isActive: () => active,
    disconnect,
  };
})();
