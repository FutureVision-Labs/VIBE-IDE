/**
 * Gemini Live (BidiGenerateContent) — WS URL from BYOK key in userData.
 */

const { loadGeminiApiKey } = require('./cloud-llm-client');

const LIVE_WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

function getGeminiLiveWsUrl(userDataPath, fs) {
  const apiKey = loadGeminiApiKey(userDataPath, fs);
  if (!apiKey) {
    return {
      success: false,
      error: 'No Gemini API key',
      hint: 'File → User Settings → add your Google AI Studio key.',
    };
  }
  return {
    success: true,
    wsUrl: `${LIVE_WS_BASE}?key=${encodeURIComponent(apiKey)}`,
    model: 'gemini-2.5-flash-native-audio-latest',
  };
}

module.exports = {
  getGeminiLiveWsUrl,
  LIVE_MODEL: 'models/gemini-2.5-flash-native-audio-latest',
};
