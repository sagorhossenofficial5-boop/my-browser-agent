const express = require('express');
const puppeteer = require('puppeteer');

let automationRunner = null;
try {
  const importedModule = require('./auto_fill_and_submit');
  if (typeof importedModule === 'function') automationRunner = importedModule;
  else if (typeof importedModule?.runAutomation === 'function') automationRunner = importedModule.runAutomation;
  else if (typeof importedModule?.default === 'function') automationRunner = importedModule.default;
  console.log(automationRunner ? '✅ Automation module loaded successfully' : '⚠️ Automation module loaded but no runnable export found');
} catch (e) {
  console.log('⚠️ Automation module not loaded:', e.message);
}

const app = express();
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ACTION_API_SECRET = process.env.ACTION_API_SECRET;
const STEEL_API_KEY = process.env.STEEL_API_KEY;
const ENABLE_TELEGRAM_POLLING = process.env.ENABLE_TELEGRAM_POLLING === 'true';

app.use(express.json({ limit: '2mb' }));

let browserInstance = null;
let pageInstance = null;
let steelBrowserInstance = null;
let steelSessionId = null;
let steelPageInstance = null;
let isBrowserBusy = false;

const FALLBACK_JPEG = Buffer.from([
  0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46,0x00,0x01,0x01,0x01,0x00,0x48,0x00,0x48,0x00,0x00,
  0xff,0xdb,0x00,0x43,0x00,0x08,0x06,0x06,0x07,0x06,0x05,0x08,0x07,0x07,0x07,0x09,0x09,0x08,0x0a,0x0c,
  0x14,0x0d,0x0c,0x0b,0x0b,0x0c,0x19,0x12,0x13,0x0f,0x14,0x1d,0x1a,0x1f,0x1e,0x1d,0x1a,0x1c,0x1c,
  0x20,0x24,0x2e,0x27,0x20,0x22,0x2c,0x23,0x1c,0x1c,0x28,0x37,0x29,0x2c,0x30,0x31,0x34,0x34,0x34,0x1f,
  0x27,0x39,0x3d,0x38,0x32,0x3c,0x2e,0x33,0x34,0x32,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,
  0x01,0x11,0x00,0xff,0xc4,0x00,0x1f,0x00,0x00,0x01,0x05,0x01,0x01,0x01,0x01,0x01,0x01,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09,0x0a,0x0b,0xff,0xda,0x00,0x08,
  0x01,0x01,0x00,0x00,0x3f,0x00,0xbf,0x80,0xff,0xd9
]);

function withTimeout(promise, ms, message = 'Operation timed out') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function getLocalBrowserPage() {
  if (!browserInstance) {
    console.log('🌐 Launching local Puppeteer browser...');
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--no-zygote']
    });
  }
  if (!pageInstance || pageInstance.isClosed()) {
    pageInstance = await browserInstance.newPage();
    await pageInstance.setViewport({ width: 1280, height: 800 });
    await pageInstance.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await pageInstance.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  }
  return pageInstance;
}

async function createSteelSession() {
  if (!STEEL_API_KEY) throw new Error('STEEL_API_KEY is not configured');
  const response = await withTimeout(fetch('https://api.steel.dev/v1/sessions', {
    method: 'POST',
    headers: { 'steel-api-key': STEEL_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeout: 600000 })
  }), 10000, 'Steel session creation timed out');
  const data = await response.json();
  if (!response.ok || !data.id) throw new Error(data.message || data.error || `Steel session creation failed (${response.status})`);
  return data;
}

async function getSteelBrowserPage() {
  if (!STEEL_API_KEY) return null;
  if (steelBrowserInstance && steelPageInstance && !steelPageInstance.isClosed()) return steelPageInstance;

  const session = await createSteelSession();
  steelSessionId = session.id;
  const websocketUrl = session.websocketUrl || `wss://connect.steel.dev?apiKey=${encodeURIComponent(STEEL_API_KEY)}&sessionId=${encodeURIComponent(session.id)}`;
  steelBrowserInstance = await withTimeout(puppeteer.connect({ browserWSEndpoint: websocketUrl }), 15000, 'Steel CDP connection timed out');
  steelPageInstance = (await steelBrowserInstance.pages())[0] || await steelBrowserInstance.newPage();
  await steelPageInstance.setViewport({ width: 1280, height: 800 });
  steelPageInstance.setDefaultNavigationTimeout(20000);
  return steelPageInstance;
}

async function releaseSteelSession() {
  const sessionId = steelSessionId;
  steelSessionId = null;
  steelPageInstance = null;
  if (steelBrowserInstance) {
    try { await steelBrowserInstance.disconnect(); } catch (_) {}
    steelBrowserInstance = null;
  }
  if (sessionId && STEEL_API_KEY) {
    try {
      await fetch(`https://api.steel.dev/v1/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: { 'steel-api-key': STEEL_API_KEY }
      });
    } catch (_) {}
  }
}

async function getBrowserPage(useSteel = false) {
  if (useSteel && STEEL_API_KEY) {
    try {
      return await getSteelBrowserPage();
    } catch (err) {
      console.error('Steel connection failed, falling back to local browser:', err.message);
    }
  }
  return getLocalBrowserPage();
}

async function runAutomationSafely(page, command, logs) {
  if (typeof automationRunner !== 'function') {
    logs.push('automation helper unavailable');
    return;
  }
  try {
    await withTimeout(Promise.resolve(automationRunner(page, command)), 60000, 'automation helper exceeded 60s');
    logs.push('automation helper completed');
  } catch (err) {
    logs.push(`automation helper: ${err.message}`);
  }
}

async function executeBrowserAction({ command, url, useSteel = false }) {
  const logs = [];
  const page = await getBrowserPage(Boolean(useSteel));
  page.setDefaultNavigationTimeout(20000);
  page.setDefaultTimeout(10000);

  const text = String(command || '').trim();
  const lower = text.toLowerCase();

  if (url) {
    await page.goto(String(url), { waitUntil: 'domcontentloaded', timeout: 20000 });
    logs.push(`navigated to ${page.url()}`);
  } else if (lower.startsWith('/goto ') || lower.startsWith('goto ')) {
    let target = text.replace(/^\/?goto\s+/i, '').trim();
    if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
    logs.push(`navigated to ${page.url()}`);
  } else if (lower.includes('chatgpt') || lower.includes('openai')) {
    await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(err => logs.push(`navigation: ${err.message}`));
  } else if (lower.includes('claude')) {
    await page.goto('https://claude.ai', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(err => logs.push(`navigation: ${err.message}`));
  } else if (lower.includes('wikipedia')) {
    await page.goto('https://www.wikipedia.org', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(err => logs.push(`navigation: ${err.message}`));
  } else {
    const current = page.url();
    if (!current || current === 'about:blank') await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  }

  await runAutomationSafely(page, text, logs);
  const screenshot = await withTimeout(page.screenshot({ type: 'jpeg', quality: 60 }), 15000, 'screenshot timed out');
  return { page, screenshot, logs };
}

app.get('/health', (req, res) => res.status(200).send('OK'));

app.get('/browser-status', async (req, res) => {
  try {
    const page = steelPageInstance && !steelPageInstance.isClosed() ? steelPageInstance : await getLocalBrowserPage();
    res.json({ url: page.url(), status: isBrowserBusy ? 'busy' : 'ready', steel: Boolean(steelPageInstance && !steelPageInstance.isClosed()) });
  } catch (err) {
    res.json({ url: 'unknown', status: 'error', error: err.message });
  }
});

app.get('/snapshot', async (req, res) => {
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const page = steelPageInstance && !steelPageInstance.isClosed() ? steelPageInstance : await getLocalBrowserPage();
    const screenshot = await withTimeout(page.screenshot({ type: 'jpeg', quality: 65 }), 5000, 'snapshot timed out');
    res.send(screenshot);
  } catch (_) {
    res.send(FALLBACK_JPEG);
  }
});

app.get(['/', '/live'], (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Browser Agent Live View</title><style>body{background:#0f172a;color:#fff;font-family:sans-serif;margin:0;padding:15px;display:flex;flex-direction:column;align-items:center}.header,.url-bar,.screen-container{width:100%;max-width:900px}.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.status-badge{background:#22c55e;color:#000;padding:4px 10px;border-radius:12px;font-weight:bold}.url-bar{background:#1e293b;padding:8px 14px;border-radius:8px;box-sizing:border-box;margin-bottom:12px;word-break:break-all;color:#38bdf8}.screen-container{background:#000;border-radius:8px;overflow:hidden;min-height:400px;display:flex;justify-content:center;align-items:center}img{width:100%;height:auto;display:block}</style></head><body><div class="header"><h2>🤖 Browser Agent Live View</h2><span class="status-badge" id="status">LIVE</span></div><div class="url-bar" id="url">Loading...</div><div class="screen-container"><img id="screen" alt="Browser snapshot"/></div><script>const img=document.getElementById('screen');const url=document.getElementById('url');function frame(){const n=new Image();n.onload=()=>img.src=n.src;n.onerror=()=>setTimeout(frame,500);n.src='/snapshot?t='+Date.now()}async function status(){try{const r=await fetch('/browser-status');const d=await r.json();url.textContent='URL: '+d.url+' | '+d.status+(d.steel?' | Steel':' | Local')}catch(e){}}setInterval(frame,1000);setInterval(status,3000);frame();status();</script></body></html>`);
});

function isAuthorized(req) {
  if (!ACTION_API_SECRET) return true;
  const provided = req.get('x-action-secret') || req.get('x-runner-secret') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return provided === ACTION_API_SECRET;
}

app.post('/api/action', async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  if (isBrowserBusy) return res.status(409).json({ success: false, error: 'Browser is busy with another task' });

  const { command, url, useSteel } = req.body || {};
  if (!command && !url) return res.status(400).json({ success: false, error: 'command or url is required' });

  isBrowserBusy = true;
  const started = Date.now();
  let page = null;
  try {
    const result = await withTimeout(executeBrowserAction({ command: command || `goto ${url}`, url, useSteel: Boolean(useSteel || STEEL_API_KEY) }), 90000, 'browser action exceeded 90s');
    page = result.page;
    const currentUrl = page.url();
    return res.json({ success: true, currentUrl, screenshotBase64: result.screenshot.toString('base64'), logs: [...result.logs, `durationMs=${Date.now() - started}`] });
  } catch (err) {
    const logs = [`action error: ${err.message}`, `durationMs=${Date.now() - started}`];
    let screenshotBase64 = null;
    try {
      if (page) screenshotBase64 = (await withTimeout(page.screenshot({ type: 'jpeg', quality: 50 }), 5000)).toString('base64');
    } catch (_) {}
    return res.status(500).json({ success: false, currentUrl: page ? page.url() : null, screenshotBase64, logs, error: err.message });
  } finally {
    isBrowserBusy = false;
  }
});

async function sendTelegramPhoto(token, chatId, imageBuffer, caption) {
  try {
    const boundary = '----TelegramBoundary' + Math.random().toString(36).slice(2);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="screen.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      imageBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body });
  } catch (err) { console.error('Telegram photo error:', err.message); }
}

async function sendTelegramMessage(token, chatId, text) {
  try { await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chat_id:chatId,text}) }); } catch (_) {}
}

async function startTelegramBot(token) {
  if (!token || !ENABLE_TELEGRAM_POLLING) {
    console.log('Telegram native polling disabled; n8n should own Telegram polling.');
    return;
  }
  try { await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`); } catch (_) {}
  let offset = 0;
  async function poll() {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=30`);
      const data = await res.json();
      if (data.ok) for (const update of data.result || []) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text) continue;
        const text = msg.text.trim();
        const lower = text.toLowerCase();
        if (lower === '/start' || lower === 'start' || lower === 'hi') await sendTelegramMessage(token, msg.chat.id, '🤖 Autonomous Browser Agent is online. Use /screen, /goto <url>, or type a task.');
        else if (lower === '/status' || lower === 'status' || lower === '/health') {
          const page = steelPageInstance && !steelPageInstance.isClosed() ? steelPageInstance : await getLocalBrowserPage();
          await sendTelegramMessage(token, msg.chat.id, `✅ Operational\nURL: ${page.url()}\nStatus: ${isBrowserBusy ? 'Busy' : 'Ready'}`);
        } else if (lower === '/screen' || lower === 'screen') {
          const page = steelPageInstance && !steelPageInstance.isClosed() ? steelPageInstance : await getLocalBrowserPage();
          const buf = await withTimeout(page.screenshot({type:'jpeg',quality:60}),5000);
          await sendTelegramPhoto(token,msg.chat.id,buf,`📸 ${page.url()}`);
        } else if (!isBrowserBusy) {
          try {
            const result = await withTimeout(executeBrowserAction({command:text,useSteel:Boolean(STEEL_API_KEY)}),90000);
            await sendTelegramPhoto(token,msg.chat.id,result.screenshot,`✅ Done\n${result.page.url()}`);
          } catch (err) { await sendTelegramMessage(token,msg.chat.id,`⚠️ ${err.message}`); }
        } else await sendTelegramMessage(token,msg.chat.id,'⏳ Browser is busy. Please wait.');
      }
    } catch (err) { await new Promise(r=>setTimeout(r,err.message?.includes('409')?10000:3000)); }
    setImmediate(poll);
  }
  poll();
}

app.listen(PORT, async () => {
  console.log(`Runner listening on port ${PORT}`);
  await getLocalBrowserPage().catch(err => console.error('Browser launch error:', err));
  startTelegramBot(TELEGRAM_BOT_TOKEN);
});
