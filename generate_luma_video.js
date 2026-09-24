const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('--- 🚀 Starting Clean, Low-CPU Luma Video Generator ---');
  
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/usr/bin/google-chrome',
    userDataDir: '/workspaces/my-browser-agent/chrome_profile',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--start-maximized'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  console.log('Navigating directly to Luma Dream Machine App...');
  await page.goto('https://lumalabs.ai/dream-machine', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 6000));

  console.log('Page loaded:', await page.title());

  // Google Sign In / Try for Free বাটন হ্যান্ডেল করা
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('a, button, div[role="button"]'));
    const target = btns.find(b => {
      const txt = (b.innerText || '').toLowerCase();
      return txt.includes('try for free') || txt.includes('sign in') || txt.includes('continue with google') || txt.includes('log in');
    });
    if (target) {
      console.log('Triggering auth/start button:', target.innerText);
      target.click();
    }
  });

  await new Promise(r => setTimeout(r, 5000));
  
  // প্রম্পট বক্স খোঁজা ও বিজনেস প্রম্পট টাইপ করা
  const promptText = 'Cinematic corporate startup boardroom, diverse business innovators discussing holographic growth charts, ultra-realistic 4k lighting';
  
  const typed = await page.evaluate((text) => {
    const input = document.querySelector('textarea, input[type="text"], [contenteditable="true"]');
    if (input) {
      input.focus();
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }, promptText);

  if (typed) {
    console.log('✅ Business prompt typed successfully!');
    await new Promise(r => setTimeout(r, 1000));
    // এন্টার বা জেনারেট বাটন ক্লিক
    await page.keyboard.press('Enter');
    console.log('🚀 Generation command submitted!');
  } else {
    console.log('Interactive UI ready on vnc.html screen for confirmation.');
  }

  await page.screenshot({ path: '/workspaces/my-browser-agent/downloads/luma_current_screen.png' });
  console.log('Status preview saved. Check vnc.html to see live progress!');
})();
