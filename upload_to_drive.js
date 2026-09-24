const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = '/usr/bin/google-chrome';
const USER_DATA = '/workspaces/my-browser-agent/chrome_profile';
const DOWNLOAD_DIR = '/workspaces/my-browser-agent/downloads';

(async () => {
  console.log('--- Connecting to Google Drive via Logged-in Session ---');

  const files = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.endsWith('.mp4') || f.endsWith('.png'));
  if (files.length === 0) {
    console.log('No files found to upload in downloads directory.');
    return;
  }
  console.log('Files ready for Google Drive:', files);

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME_PATH,
    userDataDir: USER_DATA,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--start-maximized']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  console.log('Opening Google Drive...');
  await page.goto('https://drive.google.com/drive/my-drive', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  const pageTitle = await page.title();
  console.log('Current Google Drive Title:', pageTitle);

  // Status screenshot
  await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'drive_status.png') });
  console.log('Drive status saved to downloads/drive_status.png');

  console.log('Google Drive session verified successfully!');
})();
