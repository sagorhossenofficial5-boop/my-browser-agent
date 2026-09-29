const express = require('express');
const puppeteer = require('puppeteer');

// ১. auto_fill_and_submit সেফ ইমপোর্ট
let automationRunner = null;
try {
  const importedModule = require('./auto_fill_and_submit');
  if (typeof importedModule === 'function') {
    automationRunner = importedModule;
  } else if (typeof importedModule?.runAutomation === 'function') {
    automationRunner = importedModule.runAutomation;
  } else if (typeof importedModule?.default === 'function') {
    automationRunner = importedModule.default;
  }
  console.log('✅ Automation module loaded successfully');
} catch (e) {
  console.log('⚠ Automation module not loaded:', e.message);
}

const app = express();
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

app.use(express.json());

let browserInstance = null;
let pageInstance = null;
let isBrowserBusy = false;

// ২. Puppeteer ব্রাউজার ইনিশিয়ালাইজেশন
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
    await pageInstance.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await pageInstance.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }

  return pageInstance;
}

// ৩. ওয়েব রাউটস (/health, /snapshot, /live, /browser-status)
app.get('/health', (req, res) => res.status(200).send('OK'));

app.get('/browser-status', async (req, res) => {
  try {
    const page = await getBrowserPage();
    res.json({ url: page.url(), status: isBrowserBusy ? 'busy' : 'ready' });
  } catch {
    res.json({ url: 'unknown', status: 'error' });
  }
});

app.get('/snapshot', async (req, res) => {
  try {
    const page = await getBrowserPage();
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 65, timeout: 15000 });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.send(screenshot);
  } catch (err) {
    res.status(503).end();
  }
});

app.get(['/', '/live'], (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Browser Agent Live View</title>
  <style>
    body { background: #0f172a; color: #fff; font-family: sans-serif; margin: 0; padding: 15px; display: flex; flex-direction: column; align-items: center; }
    .header { width: 100%; max-width: 900px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .status-badge { background: #22c55e; color: #000; padding: 4px 10px; border-radius: 12px; font-weight: bold; font-size: 13px; }
    .url-bar { background: #1e293b; padding: 8px 14px; border-radius: 8px; width: 100%; max-width: 900px; box-sizing: border-box; margin-bottom: 12px; word-break: break-all; font-size: 14px; color: #38bdf8; }
    .screen-container { width: 100%; max-width: 900px; background: #000; border-radius: 8px; overflow: hidden; min-height: 400px; display: flex; justify-content: center; align-items: center; }
    img { width: 100%; height: auto; display: block; }
  </style>
</head>
<body>
  <div class="header">
    <h2>🤖 Browser Agent Live Stream</h2>
    <span class="status-badge" id="status-badge">LIVE</span>
  </div>
  <div class="url-bar" id="current-url">Loading URL...</div>
  <div class="screen-container">
    <img id="live-screen" alt="Rendering browser screen..." />
  </div>
  <script>
    const imgEl = document.getElementById('live-screen');
    const urlEl = document.getElementById('current-url');
    function refreshFrame() {
      const nextImg = new Image();
      nextImg.onload = () => { imgEl.src = nextImg.src; };
      nextImg.src = '/snapshot?t=' + Date.now();
    }
    async function updateStatus() {
      try {
        const res = await fetch('/browser-status');
        const data = await res.json();
        urlEl.textContent = 'URL: ' + data.url;
      } catch (e) {}
    }
    setInterval(refreshFrame, 1000);
    setInterval(updateStatus, 3000);
    refreshFrame();
    updateStatus();
  </script>
</body>
</html>
  `);
});

// ৪. টেলিগ্রাম সেন্ডার ফাংশনসমূহ
async function sendTelegramPhoto(token, chatId, imageBuffer, caption) {
  try {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const crlf = '\r\n';
    
    let head = '--' + boundary + crlf;
    head += 'Content-Disposition: form-data; name="chat_id"' + crlf + crlf;
    head += chatId + crlf;

    head += '--' + boundary + crlf;
    head += 'Content-Disposition: form-data; name="caption"' + crlf + crlf;
    head += caption + crlf;

    head += '--' + boundary + crlf;
    head += 'Content-Disposition: form-data; name="photo"; filename="screen.jpg"' + crlf;
    head += 'Content-Type: image/jpeg' + crlf + crlf;

    const tail = crlf + '--' + boundary + '--' + crlf;

    const body = Buffer.concat([
      Buffer.from(head, 'utf-8'),
      imageBuffer,
      Buffer.from(tail, 'utf-8')
    ]);

    await fetch('https://api.telegram.org/bot' + token + '/sendPhoto', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
      body: body
    });
  } catch (err) {
    console.error('Failed to send photo to Telegram:', err.message);
  }
}

async function sendTelegramMessage(token, chatId, text) {
  try {
    await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text })
    });
  } catch (e) {}
}

// ৫. এজেন্ট কমান্ড ও অটোমেশন হ্যান্ডলার
async function handleAgentCommand(commandText, token, chatId) {
  if (isBrowserBusy) {
    return sendTelegramMessage(token, chatId, '⏳ Browser is currently busy. Please wait a moment...');
  }

  isBrowserBusy = true;
  const text = commandText.trim();
  const lower = text.toLowerCase();
  let page = null;

  try {
    page = await getBrowserPage();
    await sendTelegramMessage(token, chatId, '⚡ Executing: "' + text + '"...');

    if (lower.startsWith('/goto ') || lower.startsWith('goto ')) {
      let targetUrl = text.replace(/^\/?goto\s+/i, '').trim();
      if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    } else if (lower.includes('chatgpt') || lower.includes('openai')) {
      await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 25000 });
    } else if (lower.includes('claude')) {
      await page.goto('https://claude.ai', { waitUntil: 'domcontentloaded', timeout: 25000 });
    } else if (lower.includes('wikipedia')) {
      await page.goto('https://www.wikipedia.org', { waitUntil: 'domcontentloaded', timeout: 25000 });
    } else if (lower.includes('google')) {
      await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 25000 });
    } else {
      await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 25000 });
      const searchBox = await page.$('textarea[name="q"], input[name="q"]');
      if (searchBox) {
        await searchBox.type(text, { delay: 40 });
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      }
    }

    if (typeof automationRunner === 'function') {
      try {
        console.log('🤖 Triggering automation module...');
        await automationRunner(page, text);
      } catch (autoErr) {
        console.error('Automation error:', autoErr.message);
      }
    }

    const buffer = await page.screenshot({ type: 'jpeg', quality: 60, timeout: 15000 });
    await sendTelegramPhoto(token, chatId, buffer, '✅ Done! Current URL:\n' + page.url());
  } catch (actionErr) {
    await sendTelegramMessage(token, chatId, '⚠️ Task status: ' + actionErr.message);
    if (page) {
      try {
        const fallbackBuf = await page.screenshot({ type: 'jpeg', quality: 50, timeout: 5000 });
        await sendTelegramPhoto(token, chatId, fallbackBuf, 'Current view:\n' + page.url());
      } catch (e) {}
    }
  } finally {
    isBrowserBusy = false;
  }
}

// ৬. টেলিগ্রাম পোলিং ইঞ্জিন
async function startTelegramBot(token) {
  if (!token) return;

  try {
    await fetch('https://api.telegram.org/bot' + token + '/deleteWebhook?drop_pending_updates=true');
  } catch (e) {}

  console.log('🤖 Telegram native bot polling starting...');
  let offset = 0;

  async function poll() {
    try {
      const res = await fetch('https://api.telegram.org/bot' + token + '/getUpdates?offset=' + offset + '&timeout=30');
      const data = await res.json();
      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const msg = update.message;
          if (!msg || !msg.text) continue;

          const rawText = msg.text.trim();
          const lower = rawText.toLowerCase();
          const chatId = msg.chat.id;

          if (lower === '/start' || lower === 'start' || lower === 'hi') {
            await sendTelegramMessage(token, chatId, '🤖 Autonomous Browser Agent is LIVE on Render 24/7!\n\nCommands:\n• /screen\n• /goto <url>\n• Just type any query or task!');
          } else if (lower === '/status' || lower === 'status' || lower === '/health') {
            const page = await getBrowserPage();
            await sendTelegramMessage(token, chatId, '✅ System Health: Operational\n🔗 Active URL: ' + page.url() + '\n📌 Status: ' + (isBrowserBusy ? 'Busy' : 'Ready'));
          } else if (lower === '/screen' || lower === 'screen') {
            const page = await getBrowserPage();
            const buffer = await page.screenshot({ type: 'jpeg', quality: 60, timeout: 15000 });
            await sendTelegramPhoto(token, chatId, buffer, '📸 ' + page.url());
          } else {
            await handleAgentCommand(rawText, token, chatId);
          }
        }
      }
    } catch (err) {
      const delay = err.message && err.message.includes('409') ? 10000 : 3000;
      await new Promise(r => setTimeout(r, delay));
    }
    setImmediate(poll);
  }

  poll();
}

app.listen(PORT, async () => {
  console.log('Runner listening on port ' + PORT);
  await getBrowserPage().catch(err => console.error('Browser launch error:', err));
  startTelegramBot(TELEGRAM_BOT_TOKEN);
});
