const { chromium } = require("C:/Users/sunjunjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: "C:/Users/sunjunjie/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe" });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto("http://localhost:5173/experience2/?finale=free", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const q = await page.evaluate(() => {
    const el = document.getElementById("md-finale-quote");
    return el ? { text: el.innerText, hidden: el.classList.contains("hidden") } : null;
  });
  console.log("finale quote:", JSON.stringify(q));
  await page.screenshot({ path: "shots/finale-quote-check.png" });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
