const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

app.use(express.json());

let browserInstance = null;
let pageInstance = null;
let taskRunning = false;
const taskQueue = [];

const NAV_TIMEOUT = 20000;
const TASK_TIMEOUT = 30000;
const SCREENSHOT_TIMEOUT = 2000;

function withTimeout(promise, ms, label = 'Operation') {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

function enqueueTask(task) {
  taskQueue.push(task);
  processTaskQueue().catch(err => console.error('Task queue error:', err.message));
}

async function processTaskQueue() {
  if (taskRunning) return;
  taskRunning = true;
  try {
    while (taskQueue.length > 0) {
      const task = taskQueue.shift();
      try {
        await withTimeout(task(), TASK_TIMEOUT, 'Agent task');
      } catch (err) {
        console.error('Agent task failed:', err.message);
        if (task.onError) {
          try { await task.onError(err); } catch (_) {}
        }
      }
    }
  } finally {
    taskRunning = false;
  }
}

async function getBrowserPage() {
  if (!browserInstance) {
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
  }

  if (!pageInstance || pageInstance.isClosed()) {
    pageInstance = await browserInstance.newPage();
    await pageInstance.setViewport({ width: 1280, height: 800 });
    pageInstance.setDefaultNavigationTimeout(NAV_TIMEOUT);
    pageInstance.setDefaultTimeout(10000);
    await pageInstance.goto('https://www.google.com', {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT
    }).catch(err => console.warn('Initial navigation:', err.message));
  }

  return pageInstance;
}

async function safeScreenshot(page, quality = 60) {
  return withTimeout(
    page.screenshot({ type: 'jpeg', quality, encoding: 'binary' }),
    SCREENSHOT_TIMEOUT,
    'Screenshot'
  );
}

function placeholderJpeg() {
  // Tiny valid JPEG placeholder generated as a static fallback.
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8BP//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8BP//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEABj8Cf//Z',
    'base64'
  );
}

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/snapshot', async (req, res) => {
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const page = await withTimeout(getBrowserPage(), SCREENSHOT_TIMEOUT, 'Browser ready');
    const screenshot = await safeScreenshot(page, 60);
    res.send(screenshot);
  } catch (err) {
    console.warn('Snapshot fallback:', err.message);
    res.send(placeholderJpeg());
  }
});

app.get('/browser-status', async (req, res) => {
  try {
    const page = await getBrowserPage();
    res.json({ url: page.url(), status: 'running', taskRunning, queueLength: taskQueue.length });
  } catch (err) {
    res.json({ url: 'unknown', status: 'error', error: err.message });
  }
});

app.get(['/', '/live'], (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Browser Agent Live View</title><style>body{background:#0f172a;color:#fff;font-family:sans-serif;margin:0;padding:15px;display:flex;flex-direction:column;align-items:center}.header,.url{width:100%;max-width:900px}.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.badge{background:#22c55e;color:#000;padding:4px 10px;border-radius:12px;font-weight:bold}.url{background:#1e293b;padding:8px 14px;border-radius:8px;box-sizing:border-box;margin-bottom:12px;word-break:break-all;color:#38bdf8}.screen{width:100%;max-width:900px;background:#000;border-radius:8px;overflow:hidden;min-height:400px}.screen img{width:100%;height:auto;display:block}</style></head><body><div class="header"><h2>🤖 Browser Agent Live View</h2><span class="badge" id="status">LIVE</span></div><div class="url" id="url">Loading URL...</div><div class="screen"><img id="screen" alt="Browser snapshot"></div><script>const img=document.getElementById('screen');const url=document.getElementById('url');function frame(){const next=new Image();next.onload=()=>{img.src=next.src};next.onerror=()=>{setTimeout(frame,250)};next.src='/snapshot?t='+Date.now()}async function status(){try{const r=await fetch('/browser-status',{cache:'no-store'});const d=await r.json();url.textContent='URL: '+d.url+' | Agent: '+d.status+' | Queue: '+d.queueLength}catch(e){}}setInterval(frame,1000);setInterval(status,3000);frame();status();</script></body></html>`);
});

async function sendTelegramPhoto(token, chatId, imageBuffer, caption) {
  try {
    const boundary = '----TelegramFormBoundary' + Math.random().toString(36).substring(2);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="screen.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      imageBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body
    });
  } catch (err) {
    console.error('Failed to send photo to Telegram:', err.message);
  }
}

async function sendTelegramMessage(token, chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch (err) {
    console.error('Failed to send message:', err.message);
  }
}

async function clickCommonInteractive(page) {
  const keywords = ['log in', 'sign in', 'continue', 'accept', 'submit'];
  const clicked = await page.evaluate((words) => {
    const elements = Array.from(document.querySelectorAll('button, a, input[type="submit"]'));
    const normalize = value => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const candidate = elements.find(el => {
      const text = normalize(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title'));
      return text && words.some(word => text.includes(word));
    });
    if (candidate) {
      candidate.click();
      return true;
    }
    return false;
  }, keywords).catch(() => false);
  if (clicked) await new Promise(resolve => setTimeout(resolve, 3000));
  return clicked;
}

async function handleAgentCommand(commandText, token, chatId) {
  const text = commandText.trim();
  const lower = text.toLowerCase();
  await sendTelegramMessage(token, chatId, `⚡ Executing: "${text}"...`);

  const action = async () => {
    const page = await getBrowserPage();
    if (lower.startsWith('/goto ') || lower.startsWith('goto ')) {
      let targetUrl = text.replace(/^\/?goto\s+/i, '').trim();
      if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    } else if (lower.includes('google')) {
      await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    } else if (lower.includes('chatgpt') || lower.includes('openai')) {
      await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    } else if (lower.includes('claude')) {
      await page.goto('https://claude.ai', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    } else if (lower.includes('wikipedia')) {
      await page.goto('https://www.wikipedia.org', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    } else {
      await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      const searchBox = await page.$('textarea[name="q"], input[name="q"]');
      if (searchBox) {
        await searchBox.type(text, { delay: 30 });
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }).catch(() => {});
      }
    }

    const clicked = await clickCommonInteractive(page);
    const buffer = await safeScreenshot(page, 60);
    await sendTelegramPhoto(token, chatId, buffer, `✅ Done! Current URL:\n${page.url()}${clicked ? '\n🔘 Interactive button clicked.' : ''}`);
  };

  enqueueTask(action);
}

async function startTelegramBot(token) {
  if (!token) {
    console.log('No TELEGRAM_BOT_TOKEN found.');
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`, { method: 'POST' });
  } catch (_) {}

  console.log('🤖 Telegram native bot polling starting...');
  let offset = 0;

  async function poll() {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=30`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const msg = update.message;
          if (!msg || !msg.text) continue;
          const rawText = msg.text.trim();
          const lower = rawText.toLowerCase();
          const chatId = msg.chat.id;

          if (lower === '/start' || lower === 'start' || lower === 'hi' || lower === 'hello') {
            await sendTelegramMessage(token, chatId, '🤖 Autonomous Browser Agent is LIVE on Render 24/7!\n\nCommands:\n• /screen\n• /goto <url>\n• Natural-language browser tasks');
          } else if (lower === '/status' || lower === 'status' || lower === '/health') {
            const page = await getBrowserPage();
            await sendTelegramMessage(token, chatId, `✅ System Health: Operational\n🔗 Active URL: ${page.url()}\n📋 Queue: ${taskQueue.length}`);
          } else if (lower === '/screen' || lower === 'screen') {
            try {
              const page = await getBrowserPage();
              const buffer = await safeScreenshot(page, 60);
              await sendTelegramPhoto(token, chatId, buffer, `📸 ${page.url()}`);
            } catch (err) {
              await sendTelegramMessage(token, chatId, `⚠️ Screenshot unavailable: ${err.message}`);
            }
          } else {
            await handleAgentCommand(rawText, token, chatId);
          }
        }
      }
    } catch (err) {
      const message = String(err && err.message || err);
      console.error('Telegram polling error:', message);
      await new Promise(resolve => setTimeout(resolve, message.includes('409') ? 10000 : 3000));
    }
    setImmediate(poll);
  }
  poll();
}

app.listen(PORT, async () => {
  console.log(`Runner listening on port ${PORT}`);
  await getBrowserPage().catch(err => console.error('Browser launch error:', err.message));
  startTelegramBot(TELEGRAM_BOT_TOKEN);
});
