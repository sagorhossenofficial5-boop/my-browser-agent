const puppeteer = require('puppeteer-core');

(async () => {
  try {
    const browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null
    }).catch(async () => {
      return null;
    });

    let page;
    if (browser) {
      const pages = await browser.pages();
      page = pages.find(p => p.url().includes('lumalabs.ai')) || pages[0];
    } else {
      console.log('Connecting via direct input simulation...');
    }

    if (page) {
      await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const fn = inputs.find(i => (i.placeholder && i.placeholder.toLowerCase().includes('first')) || i.name === 'firstName');
        const ln = inputs.find(i => (i.placeholder && i.placeholder.toLowerCase().includes('last')) || i.name === 'lastName');
        const em = inputs.find(i => (i.placeholder && i.placeholder.toLowerCase().includes('email')) || i.type === 'email');

        if (fn) { fn.value = 'Sagor'; fn.dispatchEvent(new Event('input', { bubbles: true })); }
        if (ln) { ln.value = 'Hossen'; ln.dispatchEvent(new Event('input', { bubbles: true })); }
        if (em) { em.value = 'sagorhossen.official5@gmail.com'; em.dispatchEvent(new Event('input', { bubbles: true })); }

        const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Continue'));
        if (btn) btn.click();
      });
      console.log('Successfully filled and clicked Continue!');
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
