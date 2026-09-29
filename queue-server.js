const express = require('express');

// Start the existing Steel-backed runner on an internal port.
const INTERNAL_PORT = Number(process.env.INTERNAL_RUNNER_PORT || 3101);
const PUBLIC_PORT = Number(process.env.PORT || 3000);
process.env.PORT = String(INTERNAL_PORT);
require('./runner-server');

const app = express();
app.use(express.json({ limit: '2mb' }));

const queue = [];
let running = false;

function enqueue(req, res) {
  queue.push({ req, res });
  drain();
}

async function drain() {
  if (running || queue.length === 0) return;
  running = true;
  const job = queue.shift();
  const { req, res } = job;
  try {
    const body = req.body || {};
    const headers = { 'content-type': 'application/json' };
    for (const key of ['x-action-secret', 'x-runner-secret', 'authorization']) {
      if (req.get(key)) headers[key] = req.get(key);
    }

    const upstream = await fetch(`http://127.0.0.1:${INTERNAL_PORT}/api/action`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.set('content-type', upstream.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ success: false, error: `Runner proxy error: ${err.message}` });
  } finally {
    running = false;
    setImmediate(drain);
  }
}

app.post('/api/action', enqueue);

// Everything else is passed through to the existing runner unchanged.
app.use(async (req, res) => {
  try {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k !== 'host' && k !== 'content-length') headers[k] = v;
    }
    const upstream = await fetch(`http://127.0.0.1:${INTERNAL_PORT}${req.originalUrl}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {})
    });
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    res.status(502).json({ success: false, error: `Runner proxy error: ${err.message}` });
  }
});

app.listen(PUBLIC_PORT, '0.0.0.0', () => {
  console.log(`🧵 Queue proxy listening on ${PUBLIC_PORT}; runner on ${INTERNAL_PORT}`);
});
