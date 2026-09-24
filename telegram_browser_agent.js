const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

process.env.DISPLAY = ':99';
const bot = new Telegraf('8841756038:AAE5esHCQD3lGiH0qQ40W0e-_9ZAs85qVNE');

let browser = null;
let page = null;

async function getPage() {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      headless: false,
      executablePath: '/usr/bin/google-chrome',
      userDataDir: '/workspaces/my-browser-agent/chrome_profile',
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--js-flags=--max-old-space-size=256',
        '--renderer-process-limit=1',
        '--start-maximized'
      ]
    });
    const pages = await browser.pages();
    page = pages[0] || await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
  }
  return page;
}

bot.start((ctx) => {
  ctx.reply('👋 Sagor ভাই, বট লাইভ আছে! "screen", "fill", বা "video" লিখে পাঠান।');
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const cmd = text.toLowerCase();

  if (cmd === 'screen') {
    try {
      const p = await getPage();
      const scPath = path.resolve('/tmp/tg_screen.jpg');
      await p.screenshot({ path: scPath, quality: 60, type: 'jpeg' });
      return await ctx.replyWithPhoto({ source: scPath }, { caption: '📸 বর্তমান ব্রাউজার স্ক্রিন' });
    } catch (e) {
      return ctx.reply('স্ক্রিনশট এরর: ' + e.message);
    }
  }

  await ctx.reply(`⏳ কমান্ড প্রসেস হচ্ছে: "${text}"...`);

  try {
    const p = await getPage();

    if (cmd.includes('fill') || cmd.includes('form') || cmd.includes('sign')) {
      await p.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const fn = inputs.find(i => (i.placeholder && i.placeholder.toLowerCase().includes('first')) || i.name === 'firstName');
        const ln = inputs.find(i => (i.placeholder && i.placeholder.toLowerCase().includes('last')) || i.name === 'lastName');
        const em = inputs.find(i => (i.placeholder && i.placeholder.toLowerCase().includes('email')) || i.type === 'email');

        if (fn) { fn.value = 'Sagor'; fn.dispatchEvent(new Event('input', { bubbles: true })); }
        if (ln) { ln.value = 'Hossen'; ln.dispatchEvent(new Event('input', { bubbles: true })); }
        if (em) { em.value = 'sagorhossen.official5@gmail.com'; em.dispatchEvent(new Event('input', { bubbles: true })); }

        const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.toLowerCase().includes('continue'));
        if (btn) btn.click();
      });

      await new Promise(r => setTimeout(r, 4000));
      const scPath = path.resolve('/tmp/tg_screen.jpg');
      await p.screenshot({ path: scPath, quality: 60, type: 'jpeg' });
      return await ctx.replyWithPhoto({ source: scPath }, { caption: '✅ ফর্ম অটো-পূরণ সম্পন্ন!' });
    }

    if (cmd.includes('video') || cmd.includes('luma')) {
      if (!p.url().includes('lumalabs.ai')) {
        await p.goto('https://lumalabs.ai/dream-machine', { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 5000));
      }
      const promptText = 'Cinematic startup corporate team, 4k ultra-realistic';
      await p.evaluate((val) => {
        const input = document.querySelector('textarea, input[type="text"], [contenteditable="true"]');
        if (input) {
          input.value = val;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, promptText);
      await p.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 4000));
      const scPath = path.resolve('/tmp/tg_screen.jpg');
      await p.screenshot({ path: scPath, quality: 60, type: 'jpeg' });
      return await ctx.replyWithPhoto({ source: scPath }, { caption: '🎬 ভিডিও সাবমিট হয়েছে!' });
    }

    if (text.startsWith('http')) {
      await p.goto(text, { waitUntil: 'domcontentloaded' });
      await new Promise(r => setTimeout(r, 4000));
      const scPath = path.resolve('/tmp/tg_screen.jpg');
      await p.screenshot({ path: scPath, quality: 60, type: 'jpeg' });
      return await ctx.replyWithPhoto({ source: scPath }, { caption: '🌐 সাইট লোড হয়েছে!' });
    }
  } catch (err) {
    ctx.reply('⚠️ এরর: ' + err.message);
  }
});

bot.launch().then(() => console.log('>>> BOT_ONLINE_STABLE <<<'));
