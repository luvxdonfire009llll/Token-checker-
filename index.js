const express = require('express');
const multer = require('multer');
const fs = require('fs');
const readline = require('readline');
const axios = require('axios');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

const PORT = process.env.PORT || 3000;
const APP_ID = process.env.APP_ID || '';
const APP_SECRET = process.env.APP_SECRET || '';

if (!APP_ID || !APP_SECRET) {
  console.warn('Warning: APP_ID or APP_SECRET not set. Set them as environment variables.');
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper: get app access token to inspect tokens
function getAppAccessToken() {
  return `${APP_ID}|${APP_SECRET}`;
}

// Inspect single token
async function inspectToken(token) {
  try {
    const appAccessToken = getAppAccessToken();
    // 1) debug_token to check validity
    const debugUrl = `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appAccessToken)}`;
    const debugResp = await axios.get(debugUrl);
    const data = debugResp.data && debugResp.data.data ? debugResp.data.data : null;

    if (!data || !data.is_valid) {
      return { token, valid: false, reason: data ? data.error : 'invalid_response' };
    }

    // 2) if valid, fetch name
    const meUrl = `https://graph.facebook.com/me?fields=name,id&access_token=${encodeURIComponent(token)}`;
    const meResp = await axios.get(meUrl);
    const me = meResp.data;

    return {
      token,
      valid: true,
      user: { id: me.id, name: me.name },
      scope: data.scopes || data.scope,
      expires_at: data.expires_at || null
    };
  } catch (err) {
    // handle Graph API error responses gracefully
    const respErr = err && err.response && err.response.data ? err.response.data : null;
    return { token, valid: false, reason: respErr || err.message || 'request_failed' };
  }
}

// Single token check endpoint
app.post('/api/check-token', async (req, res) => {
  const token = (req.body.token || '').trim();
  if (!token) return res.status(400).json({ error: 'token required' });

  const result = await inspectToken(token);
  res.json(result);
});

// Multi-token (file upload). Accepts .txt with tokens newline separated.
app.post('/api/check-file', upload.single('tokensFile'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });

  const filePath = req.file.path;
  const results = [];

  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      const t = (line || '').trim();
      if (!t) continue;
      // You could add throttling here if needed to avoid rate limits
      // but for simplicity we call sequentially
