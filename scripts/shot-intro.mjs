import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:5173/experience2/", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.screenshot({ path: "shots/exp2-intro-final.png" });
await page.click("#md-intro button");
await page.waitForTimeout(1400);
await page.screenshot({ path: "shots/exp2-intro-entered.png" });
await browser.close();
