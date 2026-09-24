const express = require('express');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const RUNNER_SECRET = process.env.RUNNER_SECRET || 'my_agent_secret_12345';

// হেলথ চেক রুট
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// রিয়েল ব্রাউজার এক্সিকিউশন ও স্ক্রিনশট সহ /agent-command রুট
app.post('/agent-command', async (req, res) => {
  const authHeader = req.headers['authorization'] || req.headers['x-runner-secret'];
  
  if (RUNNER_SECRET && authHeader && !authHeader.includes(RUNNER_SECRET) && authHeader !== RUNNER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: Invalid runner secret' });
  }

  const { command, url, prompt } = req.body;
  const execution_logs = [];
  execution_logs.push(`[${new Date().toISOString()}] Received command: ${command || 'browse'}`);

  let browser = null;
  try {
    // Puppeteer লঞ্চ করা (Render ক্লাউড ফ্রেন্ডলি আর্গুমেন্টস)
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

    const targetUrl = url || (command && command.startsWith('http') ? command : 'https://lumalabs.ai/dream-machine');
    execution_logs.push(`[${new Date().toISOString()}] Navigating to: ${targetUrl}`);
    
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    execution_logs.push(`[${new Date().toISOString()}] Page loaded successfully: ${targetUrl}`);

    // যদি প্রম্পট বা ফর্ম ফিল থাকে
    if (prompt || (command && command.includes('fill'))) {
      execution_logs.push(`[${new Date().toISOString()}] Processing input automation...`);
      await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const fn = inputs.find(i => (i.placeholder && i.placeholder.toLowerCase().includes('first')) || i.name === 'firstName');
        const em = inputs.find(i => (i.placeholder && i.placeholder.toLowerCase().includes('email')) || i.type === 'email');
        if (fn) fn.value = 'Sagor';
        if (em) em.value = 'sagorhossen.official5@gmail.com';
      });
      execution_logs.push(`[${new Date().toISOString()}] Auto-fill completed.`);
    }

    // লাইভ স্ক্রিনশট Base64 ফরম্যাটে ক্যাপচার
    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 60 });
    const screenshotBase64 = screenshotBuffer.toString('base64');
    execution_logs.push(`[${new Date().toISOString()}] Screenshot captured.`);

    await browser.close();

    // Supabase ও n8n-এর উপযোগী ফুল রেসপন্স
    return res.json({
      success: true,
      status: 'executed',
      message: 'Command executed with real browser automation and screenshot',
      execution_logs: execution_logs,
      screenshot: `data:image/jpeg;base64,${screenshotBase64}`,
      data: { command, url: targetUrl, prompt },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    if (browser) await browser.close();
    execution_logs.push(`[${new Date().toISOString()}] Error: ${err.message}`);
    return res.status(500).json({
      success: false,
      status: 'failed',
      error: err.message,
      execution_logs: execution_logs
    });
  }
});

app.listen(PORT, () => {
  console.log(`Runner active on port ${PORT}`);
});
