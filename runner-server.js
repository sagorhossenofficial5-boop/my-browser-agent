const express = require('express');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' }));

let browser = null;
let page = null;

const PROFILE_PATH = path.join(__dirname, 'chrome_profile');
if (!fs.existsSync(PROFILE_PATH)) {
  fs.mkdirSync(PROFILE_PATH, { recursive: true });
}

async function getBrowserPage() {
  const isAlive = browser && (typeof browser.isConnected === 'function' ? browser.isConnected() : browser.connected);
  if (!isAlive) {
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome',
      headless: "new",
      userDataDir: PROFILE_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--start-maximized'
      ]
    });
  }
  const pages = await browser.pages();
  page = pages.length > 0 ? pages[0] : await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  return page;
}

app.get('/health', (req, res) => res.json({ status: 'ok', session: 'persistent' }));

app.post('/agent-step', async (req, res) => {
  const { action, params } = req.body;
  try {
    const p = await getBrowserPage();
    let stepLog = '';

    if (action === 'navigate') {
      await p.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      stepLog = `Navigated to ${params.url}`;
    } else if (action === 'type') {
      if (params.selector) {
        await p.waitForSelector(params.selector, { timeout: 10000 });
        await p.type(params.selector, params.text, { delay: 50 });
      } else {
        await p.keyboard.type(params.text, { delay: 50 });
      }
      stepLog = `Typed text: ${params.text}`;
    } else if (action === 'wait') {
      await new Promise(r => setTimeout(r, params.duration || 2000));
      stepLog = `Waited ${params.duration || 2000}ms`;
    }

    const screenshot = await p.screenshot({ encoding: 'base64' });

    return res.json({
      success: true,
      log: stepLog,
      screenshot: `data:image/png;base64,${screenshot}`
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Runner active on ${PORT}`));
