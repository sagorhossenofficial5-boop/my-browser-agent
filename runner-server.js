const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

app.use(express.json({ limit: '2mb' }));

let browserInstance = null;
let pageInstance = null;
let taskQueue = Promise.resolve();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withTimeout(promise, ms, label = 'operation') {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function getBrowserPage() {
  if (!browserInstance || !browserInstance.isConnected()) {
    console.log('🌐 Launching Puppeteer browser...');
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote'
      ]
    });
    browserInstance.on('disconnected', () => {
      browserInstance = null;
      pageInstance = null;
    });
  }

  if (!pageInstance || pageInstance.isClosed()) {
    pageInstance = await browserInstance.newPage();
    await pageInstance.setViewport({ width: 1280, height: 800 });
    pageInstance.setDefaultNavigationTimeout(20000);
    pageInstance.setDefaultTimeout(5000);
    await pageInstance.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    await pageInstance.goto('https://www.google.com', {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    }).catch(() => {});
  }

  return pageInstance;
}

app.get('/health', (req, res) => res.status(200).send('OK'));

function placeholderJpeg() {
  // A tiny valid JPEG. This prevents broken-image UI when Chrome is temporarily unavailable.
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEABj8Cf//Z',
    'base64'
  );
}

app.get('/snapshot', async (req, res) => {
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const page = await getBrowserPage();
    const screenshot = await withTimeout(
      page.screenshot({ type: 'jpeg', quality: 60 }),
      2000,
      'screenshot'
    );
    return res.send(screenshot);
  } catch (err) {
    console.error('Snapshot error:', err.message);
    return res.send(placeholderJpeg());
  }
});

app.get('/browser-status', async (req, res) => {
  try {
    const page = await getBrowserPage();
    res.json({ url: page.url(), status: 'running' });
  } catch (err) {
    res.json({ url: 'unknown', status: 'error', error: err.message });
  }
});

app.get(['/', '/live'], (req, res) => {
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Browser Agent Live</title><style>body{margin:0;background:#0f172a;color:#fff;font-family:system-ui;padding:15px}main{max-width:1100px;margin:auto}.bar{background:#1e293b;padding:10px;border-radius:8px;margin:10px 0;word-break:break-all}.screen{background:#000;border-radius:8px;overflow:hidden;min-height:400px;display:flex;align-items:center;justify-content:center}img{display:block;width:100%;height:auto}</style></head><body><main><h2>🤖 Browser Agent Live</h2><div class="bar" id="status">Loading...</div><div class="screen"><img id="screen" alt="Browser snapshot"></div></main><script>const img=document.getElementById('screen');const status=document.getElementById('status');function refresh(){const next=new Image();next.onload=()=>{img.src=next.src};next.onerror=()=>{setTimeout(refresh,250)};next.src='/snapshot?t='+Date.now()}async function stat(){try{const r=await fetch('/browser-status',{cache:'no-store'});const d=await r.json();status.textContent='Status: '+d.status+' | URL: '+d.url}catch(e){status.textContent='Status unavailable'}}setInterval(refresh,1000);setInterval(stat,3000);refresh();stat();</script></body></html>`);
});

async function sendTelegramMessage(token, chatId, text) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    if (!r.ok) console.error('Telegram sendMessage HTTP', r.status);
  } catch (e) { console.error('Failed to send message:', e.message); }
}

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
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body
    });
    if (!r.ok) console.error('Telegram sendPhoto HTTP', r.status);
  } catch (e) { console.error('Failed to send photo:', e.message); }
}

async function clickCommonInteractive(page) {
  const clicked = await page.evaluate(() => {
    const keywords = ['log in', 'login', 'sign in', 'signin', 'continue', 'accept', 'submit'];
    const els = [...document.querySelectorAll('button, a, input[type="submit"]')];
    const el = els.find((node) => {
      const text = ((node.innerText || node.value || node.getAttribute('aria-label') || '') + '').trim().toLowerCase();
      return keywords.some((k) => text.includes(k));
    });
    if (!el) return false;
    el.click();
    return true;
  }).catch(() => false);
  if (clicked) await sleep(3000);
  return clicked;
}

async function runAgentAction(commandText) {
  const page = await getBrowserPage();
  const text = commandText.trim();
  const lower = text.toLowerCase();

  if (lower.startsWith('/goto ') || lower.startsWith('goto ')) {
    let target = text.replace(/^\/?goto\s+/i, '').trim();
    if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } else if (lower.includes('chatgpt') || lower.includes('openai')) {
    await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
  } else if (lower.includes('claude')) {
    await page.goto('https://claude.ai', { waitUntil: 'domcontentloaded', timeout: 20000 });
  } else if (lower.includes('wikipedia')) {
    await page.goto('https://www.wikipedia.org', { waitUntil: 'domcontentloaded', timeout: 20000 });
  } else if (lower.includes('google')) {
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
  } else {
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const box = await page.$('textarea[name="q"], input[name="q"]');
    if (box) {
      await box.type(text, { delay: 20 });
      await box.press('Enter');
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }
  }

  const clicked = await clickCommonInteractive(page);
  return { url: page.url(), clicked };
}

async function handleAgentCommand(commandText, token, chatId) {
  await sendTelegramMessage(token, chatId, `⚡ Executing: "${commandText.trim()}"...`);
  try {
    const result = await withTimeout(runAgentAction(commandText), 30000, 'agent task');
    const page = await getBrowserPage();
    const buffer = await withTimeout(page.screenshot({ type: 'jpeg', quality: 60 }), 2000, 'task screenshot');
    await sendTelegramPhoto(token, chatId, buffer, `✅ Done!\nURL: ${result.url}${result.clicked ? '\n🔘 Interactive control clicked.' : ''}`);
  } catch (err) {
    console.error('Agent task error:', err.message);
    await sendTelegramMessage(token, chatId, `⚠️ Agent task stopped: ${err.message}`);
  }
}

function enqueueAgentTask(task) {
  const run = taskQueue.then(task, task);
  taskQueue = run.catch(() => {});
  return run;
}

async function startTelegramBot(token) {
  if (!token) return console.log('No TELEGRAM_BOT_TOKEN found.');
  try { await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`, { method: 'POST' }); } catch {}
  let offset = 0;
  console.log('🤖 Telegram native bot polling starting...');

  async function poll() {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=25`);
      const data = await res.json();
      if (data.ok) {
        for (const update of data.result || []) {
          offset = update.update_id + 1;
          const msg = update.message;
          if (!msg?.text) continue;
          const text = msg.text.trim();
          const lower = text.toLowerCase();
          const chatId = msg.chat.id;
          if (/^\/?start$/i.test(lower) || ['hi','hello'].includes(lower)) {
            await sendTelegramMessage(token, chatId, '🤖 Autonomous Browser Agent is LIVE on Render!');
          } else if (/^\/?status$/i.test(lower) || /^\/?health$/i.test(lower)) {
            try { const page = await getBrowserPage(); await sendTelegramMessage(token, chatId, `✅ Operational\nURL: ${page.url()}`); } catch (e) { await sendTelegramMessage(token, chatId, `⚠️ Browser error: ${e.message}`); }
          } else if (/^\/?screen$/i.test(lower)) {
            try { const page = await getBrowserPage(); const buffer = await withTimeout(page.screenshot({ type: 'jpeg', quality: 60 }), 2000, 'screenshot'); await sendTelegramPhoto(token, chatId, buffer, `📸 ${page.url()}`); } catch (e) { await sendTelegramMessage(token, chatId, `⚠️ Screenshot error: ${e.message}`); }
          } else {
            enqueueAgentTask(() => handleAgentCommand(text, token, chatId)).catch((e) => console.error('Queued task error:', e.message));
          }
        }
      } else if (data.error_code === 409) {
        console.error('Telegram 409 Conflict; backing off 10s.');
        await sleep(10000);
      }
    } catch (err) {
      console.error('Telegram polling error:', err.message);
      await sleep(3000);
    }
    setImmediate(poll);
  }
  poll();
  console.log('🤖 Telegram Bot successfully initialized and polling for messages!');
}

app.listen(PORT, async () => {
  console.log(`Runner listening on port ${PORT}`);
  await getBrowserPage().catch((err) => console.error('Browser launch error:', err.message));
  startTelegramBot(TELEGRAM_BOT_TOKEN);
});
