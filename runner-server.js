const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const RUNNER_SECRET = process.env.RUNNER_SECRET || 'my_agent_secret_12345';

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/agent-command', async (req, res) => {
  const secret = req.headers['x-runner-secret'] || req.headers['authorization'];
  if (RUNNER_SECRET && secret !== RUNNER_SECRET && !String(secret).includes(RUNNER_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid runner secret' });
  }

  const { actions, url, command, prompt } = req.body;
  const execution_logs = [];
  const log = (msg) => execution_logs.push(`[${new Date().toISOString()}] ${msg}`);

  log(`Command received: ${JSON.stringify(req.body)}`);

  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    const targetUrl = url || (command && command.startsWith('http') ? command : 'https://example.com');
    log(`Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    log(`Navigation complete: ${targetUrl}`);

    if (Array.isArray(actions)) {
      for (const act of actions) {
        log(`Executing action: ${act.type || act.action}`);
        if (act.type === 'click' && act.selector) {
          await page.waitForSelector(act.selector, { timeout: 10000 });
          await page.click(act.selector);
        } else if (act.type === 'type' && act.selector && act.text) {
          await page.waitForSelector(act.selector, { timeout: 10000 });
          await page.type(act.selector, act.text);
        } else if (act.type === 'wait') {
          await new Promise(r => setTimeout(r, act.duration || 3000));
        }
      }
    } else {
      if (prompt) {
        log(`Typing prompt: ${prompt}`);
        await page.evaluate((text) => {
          const el = document.querySelector('textarea, input[type="text"]');
          if (el) {
            el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, prompt);
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    const screenshotBuffer = await page.screenshot({ type: 'png' });
    const screenshotBase64 = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;
    log('Screenshot captured successfully');

    await browser.close();

    return res.json({
      success: true,
      status: 'executed',
      message: 'Actions completed successfully',
      execution_logs,
      screenshot: screenshotBase64
    });

  } catch (err) {
    log(`Execution error: ${err.message}`);
    if (browser) await browser.close();
    return res.status(500).json({
      success: false,
      status: 'failed',
      error: err.message,
      execution_logs
    });
  }
});

app.listen(PORT, () => {
  console.log(`Runner listening on port ${PORT}`);
});
