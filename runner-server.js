const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

app.use(express.json());

let browserInstance = null;
let pageInstance = null;

// --- 1. Puppeteer Initialization ---
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
    await pageInstance.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }

  return pageInstance;
}

// --- 2. Web Routes (/health, /snapshot, /live) ---
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/snapshot', async (req, res) => {
  try {
    const page = await getBrowserPage();
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 65 });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.send(screenshot);
  } catch (err) {
    res.status(500).send('Screenshot capture error: ' + err.message);
  }
});

app.get('/browser-status', async (req, res) => {
  try {
    const page = await getBrowserPage();
    res.json({ url: page.url(), status: 'running' });
  } catch {
    res.json({ url: 'unknown', status: 'error' });
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
    .screen-container { width: 100%; max-width: 900px; background: #000; border-radius: 8px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); min-height: 400px; display: flex; justify-content: center; align-items: center; }
    img { width: 100%; height: auto; display: block; }
  </style>
</head>
<body>
  <div class="header">
    <h2>🤖 Browser Agent Live Stream</h2>
    <span class="status-badge" id="status">LIVE</span>
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
      nextImg.onload = () => {
        imgEl.src = nextImg.src;
      };
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

// --- 3. Telegram Agent Engine ---
async function sendTelegramPhoto(token, chatId, imageBuffer, caption) {
  try {
    const boundary = '----TelegramFormBoundary' + Math.random().toString(36).substring(2);
    let body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="screen.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      imageBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: body
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
      body: JSON.stringify({ chat_id: chatId, text: text })
    });
  } catch (e) {
    console.error('Failed to send message:', e.message);
  }
}

async function handleAgentCommand(commandText, token, chatId) {
  const page = await getBrowserPage();
  const text = commandText.trim();
  const lower = text.toLowerCase();

  await sendTelegramMessage(token, chatId, `⚡ Executing: "${text}"...`);

  try {
    if (lower.startsWith('/goto ') || lower.startsWith('goto ')) {
      let targetUrl = text.replace(/^\/?goto\s+/i, '').trim();
      if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } else if (lower.includes('google')) {
      await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });
    } else if (lower.includes('chatgpt') || lower.includes('openai')) {
      await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded' });
    } else if (lower.includes('claude')) {
      await page.goto('https://claude.ai', { waitUntil: 'domcontentloaded' });
    } else if (lower.includes('wikipedia')) {
      await page.goto('https://www.wikipedia.org', { waitUntil: 'domcontentloaded' });
    } else {
      await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });
      const searchBox = await page.$('textarea[name="q"], input[name="q"]');
      if (searchBox) {
        await searchBox.type(text, { delay: 40 });
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      }
    }

    const buffer = await page.screenshot({ type: 'jpeg', quality: 60 });
    await sendTelegramPhoto(token, chatId, buffer, `✅ Done! Current URL:\n${page.url()}`);
  } catch (actionErr) {
    await sendTelegramMessage(token, chatId, `⚠️ Action error: ${actionErr.message}`);
  }
}

async function startTelegramBot(token) {
  if (!token) {
    console.log('No TELEGRAM_BOT_TOKEN found.');
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`);
  } catch (e) {}

  console.log('🤖 Telegram native bot polling starting...');
  let offset = 0;

  async function poll() {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=30`);
      const data = await res.json();
      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const msg = update.message;
          if (!msg || !msg.text) continue;

          const rawText = msg.text.trim();
          const lower = rawText.toLowerCase();
          const chatId = msg.chat.id;

          if (lower === '/start' || lower === 'start' || lower === 'hi' || lower === 'hello') {
            await sendTelegramMessage(token, chatId, '🤖 Autonomous Browser Agent is LIVE on Render 24/7!\n\nCommands:\n• /screen (Get current browser view)\n• /goto <url>\n• Just type anything to browse, search, or automate!');
          } else if (lower === '/status' || lower === 'status' || lower === '/health') {
            const page = await getBrowserPage();
            await sendTelegramMessage(token, chatId, `✅ System Health: Operational\n🔗 Active URL: ${page.url()}`);
          } else if (lower === '/screen' || lower === 'screen') {
            const page = await getBrowserPage();
            const buffer = await page.screenshot({ type: 'jpeg', quality: 60 });
            await sendTelegramPhoto(token, chatId, buffer, `📸 ${page.url()}`);
          } else {
            await handleAgentCommand(rawText, token, chatId);
          }
        }
      }
    } catch (err) {
      if (err.message && err.message.includes('409')) {
        await new Promise(r => setTimeout(r, 10000));
      } else {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    setImmediate(poll);
  }

  poll();
}

app.listen(PORT, async () => {
  console.log(`Runner listening on port ${PORT}`);
  await getBrowserPage().catch(err => console.error('Browser launch error:', err));
  startTelegramBot(TELEGRAM_BOT_TOKEN);
});
