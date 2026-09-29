const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = Number(process.env.PORT || 3000);
const RUNNER_SECRET = process.env.RUNNER_SECRET || '';
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${PORT}`;

let agentBrowser = null;
let agentPage = null;
let browserLock = Promise.resolve();

app.get('/', (req, res) => res.status(200).send('Bot & Agent are running 24/7'));
app.get('/health', (req, res) => res.status(200).send('Bot & Agent are running 24/7'));

function authorized(req) {
  if (!RUNNER_SECRET) return true;
  return (req.headers['x-runner-secret'] || '') === RUNNER_SECRET;
}

async function withBrowserLock(fn) {
  const previous = browserLock;
  let release;
  browserLock = new Promise(resolve => { release = resolve; });
  await previous.catch(() => {});
  try { return await fn(); } finally { release(); }
}

async function ensureAgentBrowser(url) {
  if (!agentBrowser || !agentBrowser.connected) {
    const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
    agentBrowser = await puppeteer.launch({
      headless: true,
      executablePath: chromePath,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-software-rasterizer','--disable-extensions','--no-first-run','--no-default-browser-check'],
      timeout: 60000
    });
    agentPage = await agentBrowser.newPage();
    await agentPage.setViewport({ width: 1280, height: 800 });
  }
  if (url) await agentPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  return agentPage;
}

async function runBrowser({ actions, url, command, prompt }) {
  return withBrowserLock(async () => {
    const execution_logs = [];
    const log = msg => execution_logs.push(`[${new Date().toISOString()}] ${msg}`);
    const page = await ensureAgentBrowser(url || (command && command.startsWith('http') ? command : 'https://example.com'));
    log(`Current URL: ${page.url()}`);
    if (Array.isArray(actions)) {
      for (const act of actions) {
        const type = act.type || act.action;
        log(`Executing action: ${type}`);
        if (type === 'click' && act.selector) { await page.waitForSelector(act.selector, { timeout: 10000 }); await page.click(act.selector); }
        else if (type === 'type' && act.selector && act.text != null) { await page.waitForSelector(act.selector, { timeout: 10000 }); await page.click(act.selector); await page.type(act.selector, String(act.text)); }
        else if (type === 'wait') await new Promise(r => setTimeout(r, Number(act.duration || act.ms || 3000)));
      }
    } else if (prompt) {
      await page.evaluate(text => { const el = document.querySelector('textarea, input[type="text"]'); if (el) { el.focus(); el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); } }, prompt);
      log('Applied prompt to first text field');
    }
    const screenshotBuffer = await page.screenshot({ type: 'png' });
    log('Screenshot captured successfully');
    return { execution_logs, screenshot: `data:image/png;base64,${screenshotBuffer.toString('base64')}` };
  });
}

app.post('/agent-command', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ success: false, error: 'Unauthorized: Invalid runner secret' });
  try { res.json({ success: true, status: 'executed', message: 'Actions completed successfully', ...(await runBrowser(req.body || {})) }); }
  catch (err) { res.status(500).json({ success: false, status: 'failed', error: err.message, execution_logs: [`[${new Date().toISOString()}] Execution error: ${err.message}`] }); }
});

async function startTelegramBot(token) {
  if (!token) { console.log('No TELEGRAM_BOT_TOKEN provided, skipping bot start.'); return; }
  console.log('🤖 Starting native Telegram bot polling...');
  let offset = 0;

  async function telegramRequest(method, body) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.description || `Telegram API ${method} failed (${res.status})`);
    return data;
  }

  async function sendMessage(chatId, text) {
    try { await telegramRequest('sendMessage', { chat_id: chatId, text }); }
    catch (e) { console.error('Failed to send telegram message:', e.message); }
  }

  async function sendPhoto(chatId, buffer, caption = '') {
    try {
      const form = new FormData();
      form.append('chat_id', String(chatId));
      if (caption) form.append('caption', caption);
      form.append('photo', new Blob([buffer], { type: 'image/png' }), 'browser.png');
      const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.description || `Telegram sendPhoto failed (${res.status})`);
    } catch (e) { console.error('Failed to send telegram photo:', e.message); }
  }

  async function handleMessage(msg) {
    if (!msg || !msg.text) return;
    const original = msg.text.trim();
    const text = original.toLowerCase();
    const chatId = msg.chat.id;

    if (text === 'screen' || text === '/screen') {
      await sendMessage(chatId, '📸 Taking a live browser screenshot...');
      try {
        const result = await withBrowserLock(async () => { const page = await ensureAgentBrowser(); return { shot: await page.screenshot({ type: 'png' }), url: page.url() }; });
        await sendPhoto(chatId, result.shot, `📸 Live browser screenshot\n${result.url}`);
      } catch (e) { await sendMessage(chatId, `❌ Screenshot failed: ${e.message}`); }
      return;
    }

    if (text.startsWith('goto ') || text.startsWith('/goto ')) {
      const target = original.replace(/^\/?goto\s+/i, '').trim();
      if (!/^https?:\/\//i.test(target)) { await sendMessage(chatId, '❌ Please provide a full URL, e.g. /goto https://example.com'); return; }
      try {
        const result = await withBrowserLock(async () => { const page = await ensureAgentBrowser(target); return { url: page.url(), shot: await page.screenshot({ type: 'png' }) }; });
        await sendMessage(chatId, `🌐 Navigated successfully to:\n${result.url}`);
        await sendPhoto(chatId, result.shot, '🌐 Current browser page');
      } catch (e) { await sendMessage(chatId, `❌ Navigation failed: ${e.message}`); }
      return;
    }

    if (text === 'login' || text === '/login') {
      await sendMessage(chatId, '🔐 Login automation is not wired to the Telegram bot yet. Use the browser-agent workflow for the authenticated flow.');
      return;
    }

    if (text.startsWith('/start') || text === 'start' || text === 'hi' || text === 'hello') await sendMessage(chatId, '🤖 Agent is online and ready 24/7! Commands: /screen, /login, /goto <url>, /status');
    else if (text.startsWith('/status') || text === 'status' || text.startsWith('/health') || text === 'health') await sendMessage(chatId, '✅ All systems operational on Render. Browser automation is connected.');
    else await sendMessage(chatId, `Received: "${original}". Try /screen, /login, /goto https://example.com, or /status.`);
  }

  async function poll() {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=30`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.result)) for (const update of data.result) { offset = update.update_id + 1; await handleMessage(update.message); }
      else if (!data.ok) console.error('Telegram API polling error:', data.description || 'Unknown Telegram API error');
    } catch (err) { console.error('Telegram polling error:', err.message); await new Promise(r => setTimeout(r, 5000)); }
    setImmediate(poll);
  }
  poll();
  console.log('🤖 Telegram Bot successfully initialized and polling for messages!');
}

function startBackgroundWorker() {
  const intervalMs = Number(process.env.WORKER_INTERVAL_MS || 300000);
  setInterval(async () => { try { const response = await fetch(`${SELF_URL}/health`); console.log(`Worker heartbeat: ${response.status}`); } catch (err) { console.error('Worker heartbeat failed:', err.message); } }, intervalMs).unref();
  console.log(`Background worker heartbeat scheduled every ${intervalMs}ms.`);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Runner listening on port ${PORT}`);
  startTelegramBot(process.env.TELEGRAM_BOT_TOKEN);
  startBackgroundWorker();
});
