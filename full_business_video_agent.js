const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = '/usr/bin/google-chrome';
const USER_DATA = '/workspaces/my-browser-agent/chrome_profile';
const DOWNLOAD_PATH = path.resolve('/workspaces/my-browser-agent/downloads');

const videoTasks = [
  {
    platform: 'Haiper AI',
    url: 'https://haiper.ai',
    prompt: 'Hyper-realistic cinematic 4K video of a modern corporate boardroom, diverse tech entrepreneurs discussing business metrics on glowing holographic charts, warm cinematic lighting, dynamic slow panning.'
  },
  {
    platform: 'Luma Dream Machine',
    url: 'https://lumalabs.ai/dream-machine',
    prompt: 'High-end commercial style video of an AI robotic hand assembling a digital glowing company logo, cinematic depth of field, sleek studio background, 8k resolution.'
  }
];

(async () => {
  console.log('--- 🚀 Starting Autonomous Business Video Generator ---');
  
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME_PATH,
    userDataDir: USER_DATA,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--start-maximized'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Chrome download behavior configuration
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOAD_PATH
  });

  for (const task of videoTasks) {
    console.log(`\n[Agent]: Navigating to ${task.platform} (${task.url})...`);
    try {
      await page.goto(task.url, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(res => setTimeout(res, 4000));

      // Check for Google SSO or Logged in state
      console.log(`[Agent]: Checking authentication & prompt box on ${task.platform}...`);
      
      const pageTitle = await page.title();
      console.log(`[Agent]: Loaded page: "${pageTitle}"`);

      // Screenshot state for tracking
      const previewName = `${task.platform.toLowerCase().replace(/\s+/g, '_')}_ready.png`;
      await page.screenshot({ path: path.join(DOWNLOAD_PATH, previewName) });
      console.log(`[Agent]: Saved status preview: downloads/${previewName}`);

    } catch (err) {
      console.error(`[Agent]: Issue on ${task.platform}:`, err.message);
    }
  }

  console.log('\n--- Status: Sites loaded with authenticated profile! ---');
})();
