const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = '/usr/bin/google-chrome';
const USER_DATA = '/workspaces/my-browser-agent/chrome_profile';
const OUTPUT_DIR = '/workspaces/my-browser-agent/generated_videos';

const sites = [
  {
    name: 'Haiper AI',
    url: 'https://haiper.ai',
    prompt: 'Cinematic corporate startup team meeting, ultra-modern tech office, professional 4k lighting'
  },
  {
    name: 'Luma Dream Machine',
    url: 'https://lumalabs.ai/dream-machine',
    prompt: 'Futuristic business growth graph transitioning into real city skyscrapers, cinematic depth'
  }
];

(async () => {
  console.log('--- Launching Autonomous Video Pipeline ---');
  
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

  for (const site of sites) {
    console.log(`\nNavigating to ${site.name}: ${site.url}`);
    try {
      await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await new Promise(r => setTimeout(r, 5000));

      const screenshotFile = path.join(OUTPUT_DIR, `${site.name.toLowerCase().replace(/\s+/g, '_')}_home.png`);
      await page.screenshot({ path: screenshotFile, fullPage: false });
      console.log(`Saved preview: ${screenshotFile}`);
      console.log(`Current page title: ${await page.title()}`);
    } catch (err) {
      console.error(`Error loading ${site.name}:`, err.message);
    }
  }

  console.log('\nInitial navigation step complete! Browser is live on display.');
})();
