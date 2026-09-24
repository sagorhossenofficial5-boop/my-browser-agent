const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/usr/bin/google-chrome',
    userDataDir: './saved_session',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--start-maximized'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  console.log('Navigating to Luma...');
  await page.goto('https://auth.lumalabs.ai/sign-up', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 4000));

  // স্টেপ ১: গুগল সাইন-ইন চেষ্টা করা
  console.log('Trying Google Sign-in...');
  const googleBtnFound = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
    const gBtn = btns.find(b => {
      const txt = (b.innerText || '').toLowerCase();
      return txt.includes('google') || txt.includes('continue with google') || txt.includes('sign in with google');
    });
    if (gBtn) {
      gBtn.click();
      return true;
    }
    return false;
  });

  await new Promise(r => setTimeout(r, 4000));

  // যদি গুগল উইন্ডো ওপেন হয় তবে অ্যাকাউন্ট ক্লিক করা
  const pages = await browser.pages();
  const targetPage = pages[pages.length - 1];

  let googleSuccess = false;
  try {
    const accSelector = 'div[data-identifier], div[data-email], li[data-authuser]';
    await targetPage.waitForSelector(accSelector, { timeout: 5000 });
    await targetPage.click(accSelector);
    console.log('Google account selected!');
    googleSuccess = true;
  } catch (e) {
    console.log('Google auto-select not triggered or blocked.');
  }

  // স্টেপ ২: যদি গুগল না হয়, তবে ইমেইল + পাসওয়ার্ড অপশন দিয়ে ঢুকবে
  if (!googleSuccess) {
    console.log('Switching to email & password entry...');

    // ইমেইল ইনপুট
    await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const emailInput = inputs.find(i => i.type === 'email' || (i.placeholder && i.placeholder.toLowerCase().includes('email')) || i.name === 'email');
      if (emailInput) {
        emailInput.focus();
        emailInput.value = 'sagor.hossen.official5@gmail.com';
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
        emailInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    // Continue / Next বাটন ক্লিক
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const nextBtn = btns.find(b => {
        const txt = (b.innerText || '').toLowerCase();
        return txt.includes('continue') || txt.includes('next') || txt.includes('sign in') || txt.includes('log in');
      });
      if (nextBtn) nextBtn.click();
    });

    // পাসওয়ার্ড ফিল্ড আসা পর্যন্ত অপেক্ষা করা
    console.log('Waiting for password input field...');
    try {
      await page.waitForSelector('input[type="password"]', { timeout: 8000 });
      await page.type('input[type="password"]', 'Ami@sagor321?#&*.', { delay: 100 });
      console.log('Password entered!');
      await page.keyboard.press('Enter');
    } catch (e) {
      console.log('Direct password input not found yet, checking current state...');
    }
  }

  await new Promise(r => setTimeout(r, 7000));
  await page.screenshot({ path: '/workspaces/my-browser-agent/downloads/after_submit.png' });
  console.log('Updated screenshot captured at downloads/after_submit.png');
})();
