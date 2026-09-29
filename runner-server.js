const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = Number(process.env.PORT || 3000);
const RUNNER_SECRET = process.env.RUNNER_SECRET || '';
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${PORT}`;

app.get('/', (req, res) => {
  res.status(200).send('Bot & Agent are running 24/7');
});

app.get('/health', (req, res) => {
  res.status(200).send('Bot & Agent are running 24/7');
});

function authorized(req) {
  if (!RUNNER_SECRET) return true;
  const secret = req.headers['x-runner-secret'] || '';
  return secret === RUNNER_SECRET;
}

async function runBrowser({ actions, url, command, prompt }) {
  const execution_logs = [];
  const log = (msg) => execution_logs.push(`[${new Date().toISOString()}] ${msg}`);
  let browser = null;

  try {
    const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
    log(`Resolved Chrome path: ${chromePath}`);

    browser = await puppeteer.launch({
      headless: true,
      executablePath: chromePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--no-first-run',
        '--no-default-browser-check'
      ],
      timeout: 60000
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    const targetUrl = url || (command && command.startsWith('http') ? command : 'https://example.com');
    log(`Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    log(`Navigation complete: ${targetUrl}`);

    if (Array.isArray(actions)) {
      for (const act of actions) {
        const type = act.type || act.action;
        log(`Executing action: ${type}`);
        if (type === 'click' && act.selector) {
          await page.waitForSelector(act.selector, { timeout: 10000 });
          await page.click(act.selector);
        } else if (type === 'type' && act.selector && act.text != null) {
          await page.waitForSelector(act.selector, { timeout: 10000 });
          await page.click(act.selector);
          await page.type(act.selector, String(act.text));
        } else if (type === 'wait') {
          await new Promise(r => setTimeout(r, Number(act.duration || act.ms || 3000)));
        }
      }
    } else if (prompt) {
      log('Applying prompt to first text field');
      await page.evaluate((text) => {
        const el = document.querySelector('textarea, input[type="text"]');
        if (el) {
          el.focus();
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, prompt);
    }

    const screenshotBuffer = await page.screenshot({ type: 'png' });
    const screenshot = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;
    log('Screenshot captured successfully');

    return { execution_logs, screenshot };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

app.post('/agent-command', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ success: false, error: 'Unauthorized: Invalid runner secret' });

  const { actions, url, command, prompt } = req.body || {};
  try {
    const result = await runBrowser({ actions, url, command, prompt });
    return res.json({
      success: true,
      status: 'executed',
      message: 'Actions completed successfully',
      ...result
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      status: 'failed',
      error: err.message,
      execution_logs: [`[${new Date().toISOString()}] Execution error: ${err.message}`]
    });
  }
});

async function startTelegramBot(token) {
  if (!token) {
    console.log('No TELEGRAM_BOT_TOKEN provided, skipping bot start.');
    return;
  }

  console.log('🤖 Starting native Telegram bot polling...');
  let offset = 0;

  async function sendMessage(chatId, text) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text })
      });
      if (!res.ok) {
        const body = await res.text();
        console.error('Failed to send telegram message:', res.status, body);
      }
    } catch (e) {
      console.error('Failed to send telegram message:', e.message);
    }
  }

  async function poll() {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=30`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const msg = update.message;
          if (msg && msg.text) {
            const text = msg.text.trim().toLowerCase();
            const chatId = msg.chat.id;

            if (text.startsWith('/start') || text === 'start' || text === 'hi' || text === 'hello') {
              await sendMessage(chatId, '🤖 Agent is online and ready 24/7 on Render! Type /status to check health.');
            } else if (text.startsWith('/status') || text === 'status' || text.startsWith('/health') || text === 'health') {
              await sendMessage(chatId, '✅ All systems operational on Render (24/7 Keep-Alive active).');
            } else {
              await sendMessage(chatId, `Received: "${msg.text}". Agent is active.`);
            }
          }
        }
      } else if (!data.ok) {
        console.error('Telegram API polling error:', data.description || 'Unknown Telegram API error');
      }
    } catch (err) {
      console.error('Telegram polling error:', err.message);
      await new Promise(r => setTimeout(r, 5000));
    }
    setImmediate(poll);
  }

  poll();
  console.log('🤖 Telegram Bot successfully initialized and polling for messages!');
}

function startBackgroundWorker() {
  const intervalMs = Number(process.env.WORKER_INTERVAL_MS || 300000);
  setInterval(async () => {
    try {
      const response = await fetch(`${SELF_URL}/health`);
      console.log(`Worker heartbeat: ${response.status}`);
    } catch (err) {
      console.error('Worker heartbeat failed:', err.message);
    }
  }, intervalMs).unref();
  console.log(`Background worker heartbeat scheduled every ${intervalMs}ms.`);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Runner listening on port ${PORT}`);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  startTelegramBot(token);
  startBackgroundWorker();
});
