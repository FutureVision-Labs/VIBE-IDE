/**
 * REST STT for live voice (same contract as gemini-matrix-portal /api/transcribe).
 */

const { loadGeminiApiKey } = require('./cloud-llm-client');

const TRANSCRIBE_PROMPT =
  'Transcribe this audio exactly as spoken. Do not add any commentary, inner thoughts, markdown formatting, or quotation marks. If the audio is empty, silent, or only contains ambient room noise/static, YOU MUST OUTPUT THE EXACT WORD: [SILENCE]. Output only the pure raw transcript.';

async function transcribeLiveAudioBlob(userDataPath, fs, { base64, mimeType }) {
  const apiKey = loadGeminiApiKey(userDataPath, fs);
  if (!apiKey) {
    return { success: false, error: 'No Gemini API key' };
  }
  if (!base64) {
    return { success: false, error: 'No audio data' };
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: TRANSCRIBE_PROMPT },
              { inlineData: { mimeType: mimeType || 'audio/webm', data: base64 } },
            ],
          },
        ],
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText || 'Transcribe failed';
    return { success: false, error: msg };
  }

  const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  return { success: true, text };
}

module.exports = { transcribeLiveAudioBlob };
