const http = require('http');
const PORT = 4000;
const RUNNER_URL = 'http://localhost:3000/agent-step';

const html = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Autonomous Touch Controller</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: sans-serif; background: #0f172a; color: #fff; margin: 0; padding: 10px; display: flex; flex-direction: column; align-items: center; }
    h3 { margin: 5px 0; font-size: 1rem; color: #38bdf8; }
    .screen-wrap { width: 100%; max-width: 600px; border: 2px solid #38bdf8; border-radius: 8px; overflow: hidden; background: #000; position: relative; }
    #screen { width: 100%; display: block; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
    .box { width: 100%; max-width: 600px; margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
    input, button { padding: 12px; border-radius: 6px; border: none; font-size: 1rem; outline: none; }
    input { background: #1e293b; color: #fff; border: 1px solid #475569; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    button { background: #2563eb; color: #fff; font-weight: bold; cursor: pointer; }
    button:active { opacity: 0.8; }
    .green { background: #16a34a; }
    .orange { background: #ea580c; }
    #log { width: 100%; max-width: 600px; margin-top: 8px; font-size: 0.85rem; color: #38bdf8; background: #1e293b; padding: 8px; border-radius: 6px; min-height: 40px; }
  </style>
</head>
<body>
  <h3>⚡ Live Remote Touch Screen</h3>
  <div class="screen-wrap">
    <img id="screen" src="" alt="Live Remote View">
  </div>

  <div class="box">
    <input type="text" id="cmd" placeholder="Type text or CSS selector here..." />
    <div class="grid">
      <button onclick="sendType()">Type Text</button>
      <button class="green" onclick="submitEnter()">Press Enter</button>
    </div>
    <div class="grid">
      <button class="orange" onclick="clickSelector('input[name=\\'commit\\']')">Click Sign In</button>
      <button onclick="refreshScreen()">Force Refresh</button>
    </div>
  </div>
  <div id="log">Status: Ready. Tap anywhere on image to click.</div>

  <script>
    const img = document.getElementById('screen');
    const log = document.getElementById('log');

    async function refreshScreen() {
      try {
        const res = await fetch('/screen');
        const data = await res.json();
        if (data.screenshot) img.src = data.screenshot;
      } catch (e) {}
    }
    setInterval(refreshScreen, 1500);

    // Direct touch & click listener for mobile
    function handleTap(e) {
      e.preventDefault();
      const rect = img.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const scaleX = 1280 / rect.width;
      const scaleY = 800 / rect.height;
      const x = Math.round((clientX - rect.left) * scaleX);
      const y = Math.round((clientY - rect.top) * scaleY);

      log.innerText = 'Tapped at (' + x + ', ' + y + ') - Executing click...';
      fetch('/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y })
      }).then(() => setTimeout(refreshScreen, 800));
    }

    img.addEventListener('click', handleTap);
    img.addEventListener('touchstart', handleTap, { passive: false });

    async function sendType() {
      const text = document.getElementById('cmd').value;
      if (!text) return;
      log.innerText = 'Typing: ' + text;
      await fetch('/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'type', params: { text } })
      });
      document.getElementById('cmd').value = '';
      setTimeout(refreshScreen, 1000);
    }

    async function submitEnter() {
      log.innerText = 'Sending Enter key...';
      await fetch('/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'press', params: { key: 'Enter' } })
      });
      setTimeout(refreshScreen, 1500);
    }

    async function clickSelector(selector) {
      log.innerText = 'Clicking selector: ' + selector;
      await fetch('/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'click', params: { selector } })
      });
      setTimeout(refreshScreen, 2000);
    }

    refreshScreen();
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } else if (req.url === '/screen' && req.method === 'GET') {
    try {
      const r = await fetch(RUNNER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'wait', params: { duration: 100 } })
      });
      const data = await r.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ screenshot: data.screenshot }));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
  } else if (req.url === '/click' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { x, y } = JSON.parse(body);
        await fetch(RUNNER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'click', params: { x, y } })
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
  } else if (req.url === '/step' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        await fetch(RUNNER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
  } else {
    res.writeHead(404); res.end();
  }
});

server.listen(PORT, () => console.log('Interactive mobile touch controller live on 4000'));
