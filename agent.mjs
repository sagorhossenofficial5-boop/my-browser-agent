import puppeteer from 'puppeteer';

export async function runAgent(targetUrl = 'https://example.com') {
  console.log('Automation started for:', targetUrl);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    const pageTitle = await page.title();
    console.log('Task Success! Page Title:', pageTitle);
    return { success: true, title: pageTitle };
  } catch (err) {
    console.error('Automation Error:', err.message);
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}

// Direct run test
runAgent();
