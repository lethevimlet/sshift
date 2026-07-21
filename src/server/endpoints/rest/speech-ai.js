/**
 * Speech & AI REST endpoints
 *
 * - GET  /api/speech-ai/config          — public config (auth keys redacted)
 * - POST /api/speech-ai/config           — save speech-ai settings
 * - POST /api/speech-ai/stt              — proxy audio blob to the configured
 *                                          STT endpoint (DeepInfra-compatible
 *                                          OpenAI transcription API)
 * - POST /api/speech-ai/wand             — proxy transcript text to the
 *                                          configured OpenAI-compatible LLM
 *                                          chat completions endpoint, using
 *                                          the saved wand system prompt.
 *
 * The browser never sees the raw STT/LLM auth keys — they live in the
 * gitignored config.json and are only read server-side here.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { loadConfig, saveConfig, getSpeechAiConfig, getDefaultWandSystemPrompt } = require('../../utils/config');

// Use the global fetch (Node 18+) for proxying. Fall back to undici/https for
// ancient environments — but Node >=20 is the project floor, so global fetch
// is always available.
const fetch = global.fetch;

// Whisper transcription accepts these mimetypes. Browsers usually send
// audio/webm;general;codecs=opus from MediaRecorder. We trust the client
// filename extension when present, otherwise fall back to webm.
function audioMimeFromRequest(req) {
  const ct = req.headers['content-type'] || '';
  if (ct.startsWith('multipart/')) {
    // multer/formidable not installed; we receive the audio file as a raw
    // body in this proxy, see POST /api/speech-ai/stt below.
    return 'audio/webm';
  }
  return ct || 'audio/webm';
}

function registerSpeechAiEndpoints(app, io) {
  // ---- Public config (redacted) -------------------------------------------
  app.get('/api/speech-ai/config', (req, res) => {
    const pub = getPublicSpeechAiConfigSafe();
    res.json(pub);
  });

  // ---- Save settings -------------------------------------------------------
  app.post('/api/speech-ai/config', (req, res) => {
    const config = loadConfig();
    const b = req.body || {};

    // Non-secret fields overwrite directly.
    if (b.hasOwnProperty('sttEndpoint'))  config.sttEndpoint  = typeof b.sttEndpoint === 'string' ? b.sttEndpoint.trim() : '';
    if (b.hasOwnProperty('sttLanguage'))  config.sttLanguage  = typeof b.sttLanguage === 'string' ? b.sttLanguage.trim() : '';
    if (b.hasOwnProperty('llmEndpoint')) config.llmEndpoint = typeof b.llmEndpoint === 'string' ? b.llmEndpoint.trim() : '';
    if (b.hasOwnProperty('llmModel'))     config.llmModel    = typeof b.llmModel === 'string' ? b.llmModel.trim() : '';
    if (b.hasOwnProperty('wandSystemPrompt')) {
      config.wandSystemPrompt = typeof b.wandSystemPrompt === 'string' ? b.wandSystemPrompt : '';
    }

    // Auth keys: blank/no-change sentinel => keep existing. Any non-empty
    // string (including the literal word "clear") overwrites. Use the
    // sentinel "__UNCHANGED__" for "leave as is".
    if (b.hasOwnProperty('sttAuthKey')) {
      const v = b.sttAuthKey;
      if (v !== '__UNCHANGED__' && v !== null && v !== undefined) {
        config.sttAuthKey = typeof v === 'string' ? v.trim() : '';
      }
    }
    if (b.hasOwnProperty('llmAuthKey')) {
      const v = b.llmAuthKey;
      if (v !== '__UNCHANGED__' && v !== null && v !== undefined) {
        config.llmAuthKey = typeof v === 'string' ? v.trim() : '';
      }
    }

    const saved = saveConfig(config);
    if (!saved) return res.status(500).json({ error: 'Failed to save config' });

    res.json(getPublicSpeechAiConfigSafe());
  });

  // ---- Default wand system prompt -----------------------------------------
  // Returned to the "Reset" button so the user can restore the default
  // without us baking it into the client bundle.
  app.get('/api/speech-ai/wand-default', (req, res) => {
    res.json({ prompt: getDefaultWandSystemPrompt() });
  });

  // ---- STT proxy -----------------------------------------------------------
  // Body: raw audio bytes (any mimetype MediaRecorder produces). We forward
  // to <sttEndpoint> as multipart/form-data with model=openai/whisper-large-v3
  // (whisper-large-v3 is the full multilingual model with strong EN+ES support;
  // the -turbo variant is optimised for English-only and weaker on Spanish).
  // Returns { text } on success.
  app.post('/api/speech-ai/stt', (req, res) => {
    handleSttProxy(req, res).catch(err => {
      console.error('[SPEECH-AI] STT proxy error:', err);
      res.status(502).json({ error: 'Speech-to-text proxy failed', detail: String(err.message || err) });
    });
  });

  // ---- LLM wand proxy -----------------------------------------------------
  // Body: { text: "<transcript>" }
  // Returns { text: "<cleaned>" } on success.
  app.post('/api/speech-ai/wand', (req, res) => {
    handleWandProxy(req, res).catch(err => {
      console.error('[SPEECH-AI] Wand proxy error:', err);
      res.status(502).json({ error: 'LLM wand proxy failed', detail: String(err.message || err) });
    });
  });
}

// Local helper so a save failure (or any error) never crashes the route —
// returns empty defaults instead. Auth keys are still never exposed.
function getPublicSpeechAiConfigSafe() {
  try {
    const cfg = getSpeechAiConfig();
    return {
      sttEndpoint: cfg.sttEndpoint || '',
      sttLanguage: cfg.sttLanguage || '',
      llmEndpoint: cfg.llmEndpoint,
      llmModel: cfg.llmModel,
      // If user never set a custom wand prompt, expose the default so the
      // textarea populates with it on first load.
      wandSystemPrompt: cfg.wandSystemPrompt || getDefaultWandSystemPrompt(),
      sttAuthKeySet: !!cfg.sttAuthKey,
      llmAuthKeySet: !!cfg.llmAuthKey
    };
  } catch (err) {
    console.error('[SPEECH-AI] Failed to read public config:', err);
    return {
      sttEndpoint: '',
      sttLanguage: '',
      llmEndpoint: 'https://api.deepinfra.com/v1/openai/chat/completions',
      llmModel: 'meta-llama/Llama-3.3-70B-Instruct',
      wandSystemPrompt: getDefaultWandSystemPrompt(),
      sttAuthKeySet: false,
      llmAuthKeySet: false
    };
  }
}

async function handleSttProxy(req, res) {
  const cfg = getSpeechAiConfig();
  if (!cfg.sttEndpoint) return res.status(400).json({ error: 'STT endpoint not configured' });
  if (!cfg.sttAuthKey) return res.status(400).json({ error: 'STT auth key not configured' });

  // Collect raw body bytes.
  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', c => chunks.push(c));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const audioBuffer = Buffer.concat(chunks);
  if (!audioBuffer.length) return res.status(400).json({ error: 'No audio received' });

  // Build multipart/form-data manually — we deliberately avoid adding
  // multer/formidable as dependencies just for one endpoint.
  const boundary = 'sshift-' + Math.random().toString(16).slice(2) + '-' + Date.now().toString(16);
  const filename = req.headers['x-audio-filename'] || `recording-${Date.now()}.webm`;
  const mime = (req.headers['content-type'] && !req.headers['content-type'].includes('application/json'))
    ? req.headers['content-type']
    : 'audio/webm';

  const parts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="model"\r\n\r\n`,
    `openai/whisper-large-v3\r\n`,
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`,
    `Content-Type: ${mime}\r\n\r\n`
  ];
  const headerBuf = Buffer.from(parts.join(''), 'utf8');
  const tailBuf = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([headerBuf, audioBuffer, tailBuf]);

  // Optional language hint.
  let url = cfg.sttEndpoint;
  if (cfg.sttLanguage) {
    const sep = url.includes('?') ? '&' : '?';
    url = url + sep + 'language=' + encodeURIComponent(cfg.sttLanguage);
  }

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.sttAuthKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    console.error('[SPEECH-AI] STT upstream error', upstream.status, text);
    return res.status(upstream.status).json({ error: 'STT upstream error', detail: text });
  }

  // OpenAI-compatible transcription returns { text: "..." }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { parsed = { text }; }
  res.json({ text: parsed.text || '' });
}

async function handleWandProxy(req, res) {
  const cfg = getSpeechAiConfig();
  if (!cfg.llmEndpoint) return res.status(400).json({ error: 'LLM endpoint not configured' });
  if (!cfg.llmAuthKey) return res.status(400).json({ error: 'LLM auth key not configured' });

  const userText = (req.body && typeof req.body.text === 'string') ? req.body.text : '';
  if (!userText.trim()) return res.status(400).json({ error: 'No transcript text provided' });

  const systemPrompt = cfg.wandSystemPrompt || getDefaultWandSystemPrompt();

  const upstream = await fetch(cfg.llmEndpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.llmAuthKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: cfg.llmModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText }
      ],
      temperature: 0.2,
      max_tokens: Math.min(2048, Math.max(64, Math.ceil(userText.length / 2)))
    })
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    console.error('[SPEECH-AI] LLM upstream error', upstream.status, text);
    return res.status(upstream.status).json({ error: 'LLM upstream error', detail: text });
  }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { parsed = { choices: [] }; }

  const cleaned = parsed.choices?.[0]?.message?.content ?? '';
  res.json({ text: cleaned.trim() });
}

module.exports = { registerSpeechAiEndpoints };