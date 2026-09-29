const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the existing Luma sign-in automation against the caller's active Puppeteer page.
 * The browser/page lifecycle remains owned by runner-server.js.
 */
async function autoFillAndSubmit(page, options = {}) {
  const email = options.email || process.env.LOGIN_EMAIL || 'sagor.hossen.official5@gmail.com';
  const password = options.password || process.env.LOGIN_PASSWORD;

  if (!password) {
    throw new Error('LOGIN_PASSWORD is not configured');
  }

  page.setDefaultNavigationTimeout(20000);
  page.setDefaultTimeout(8000);

  console.log('Navigating to Luma sign-up...');
  await page.goto('https://auth.lumalabs.ai/sign-up', {
    waitUntil: 'domcontentloaded',
    timeout: 20000
  });
  await sleep(2000);

  console.log('Trying Google Sign-in...');
  const googleBtnFound = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
    const button = buttons.find((b) => {
      const text = (b.innerText || b.getAttribute('aria-label') || '').toLowerCase();
      return text.includes('google') || text.includes('continue with google') || text.includes('sign in with google');
    });
    if (button) {
      button.click();
      return true;
    }
    return false;
  }).catch(() => false);

  if (googleBtnFound) {
    await sleep(3000);
    const pages = await page.browser().pages();
    const targetPage = pages[pages.length - 1];
    try {
      await targetPage.waitForSelector('div[data-identifier], div[data-email], li[data-authuser]', { timeout: 5000 });
      await targetPage.click('div[data-identifier], div[data-email], li[data-authuser]');
      console.log('Google account selection was available.');
      return { page: targetPage, method: 'google', success: true };
    } catch {
      console.log('Google account selection not available; continuing with email/password.');
    }
  }

  console.log('Using email/password flow...');
  const emailInput = await page.$('input[type="email"], input[name="email"], input[placeholder*="email" i]');
  if (!emailInput) throw new Error('Luma email field not found');
  await emailInput.click({ clickCount: 3 });
  await emailInput.type(email, { delay: 30 });

  const continueButton = await page.$('button, input[type="submit"], a');
  if (continueButton) {
    const clicked = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('button, input[type="submit"], a'));
      const node = nodes.find((el) => /continue|next|sign in|log in/i.test((el.innerText || el.value || el.getAttribute('aria-label') || '').trim()));
      if (!node) return false;
      node.click();
      return true;
    }).catch(() => false);
    if (clicked) await sleep(1500);
  }

  const passwordInput = await page.waitForSelector('input[type="password"]', { timeout: 8000 });
  await passwordInput.click();
  await passwordInput.type(password, { delay: 30 });
  await page.keyboard.press('Enter');
  await sleep(4000);

  return { page, method: 'password', success: true };
}

module.exports = autoFillAndSubmit;
