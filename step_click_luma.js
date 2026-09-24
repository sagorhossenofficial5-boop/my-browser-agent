const puppeteer = require('puppeteer-core');

(async () => {
  try {
    // চলমান ক্রোমের সাথে সরাসরি কানেক্ট হওয়া
    const browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null
    }).catch(async () => {
      // যদি রিমোট পোর্ট অন না থাকে, তবে পুরানো ক্রোম রিস্টার্ট করে নেওয়া
      const { execSync } = require('child_process');
      execSync('killall -9 chrome google-chrome 2>/dev/null; rm -f /workspaces/my-browser-agent/chrome_profile/Singleton* 2>/dev/null');
      return await puppeteer.launch({
        headless: false,
        executablePath: '/usr/bin/google-chrome',
        userDataDir: '/workspaces/my-browser-agent/chrome_profile',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--start-maximized', '--remote-debugging-port=9222']
      });
    });

    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();

    console.log("Current URL:", page.url());
    console.log("Clicking 'Try for free' / Sign In on Luma AI...");

    // Try for free বাটনে ক্লিক
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('a, button'));
      const target = buttons.find(b => b.innerText && (b.innerText.includes('Try for free') || b.innerText.includes('Sign in') || b.innerText.includes('Log in')));
      if (target) {
        target.click();
        return true;
      }
      return false;
    });

    console.log("Clicked! Waiting 4 seconds for Google Auth / App page to load...");
    await new Promise(r => setTimeout(r, 4000));

    // Google SSO বাটন থাকলে তাতেও ক্লিক করা
    await page.evaluate(() => {
      const gButtons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
      const gBtn = gButtons.find(b => b.innerText && (b.innerText.includes('Google') || b.innerText.includes('Continue with Google')));
      if (gBtn) {
        gBtn.click();
        console.log("Triggered Google Sign In button!");
      }
    });

    console.log("Done! Check your vnc.html screen.");
  } catch (err) {
    console.error("Action Error:", err.message);
  }
})();
