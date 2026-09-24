import { chromium } from "playwright";

async function run() {
  console.log("Starting browser...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  console.log("Navigating to Google...");
  await page.goto("https://google.com");

  const title = await page.title();
  console.log("SUCCESS! Page title is:", title);

  await browser.close();
}

run();
