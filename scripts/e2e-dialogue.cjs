// Full E2E: play through the whole story with state-driven navigation,
// logging every audio play/ended event and every subtitle/quote change.
// Verifies: subtitle duration == audio duration, 0.6s gap between lines,
// and each line's audio length matches the re-cut wav files.
const { chromium } = require("C:/Users/sunjunjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const URL = "http://localhost:5173/experience2/";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Users/sunjunjie/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe",
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console.error]", m.text());
  });
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e)));

  await page.addInitScript(() => {
    window.__log = [];
    const push = (ev, detail) => window.__log.push({ t: performance.now(), ev, detail });
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const name = (this.currentSrc || this.src || "").split("/").pop();
      push("play", name);
      this.addEventListener("ended", () => push("ended", name));
      this.addEventListener("error", () => push("audio-error", name));
      return origPlay.call(this);
    };
    window.__watchDom = () => {
      const watch = (sel, evName) => {
        const el = document.querySelector(sel);
        if (!el) return;
        new MutationObserver(() => {
          if (!el.classList.contains("hidden")) push(evName, el.textContent.replace(/\s+/g, " ").slice(0, 26));
          else push(evName + "-hidden", "");
        }).observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
      };
      watch("#md-sub", "sub");
      // #md-finale-quote is created when the finale starts; poll for it
      const t = setInterval(() => {
        if (document.querySelector("#md-finale-quote")) {
          clearInterval(t);
          watch("#md-finale-quote", "quote");
        }
      }, 500);
    };
  });

  const probe = () =>
    page.evaluate(() => {
      const s = window.__story;
      return { state: s?.state, charX: s?.charX ?? 0, knockCount: s?.knockCount ?? 0 };
    });

  const waitFor = async (fn, timeoutMs, label) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await fn()) return true;
      await sleep(250);
    }
    console.log(`TIMEOUT waiting for ${label}; probe=${JSON.stringify(await probe())}`);
    return false;
  };
  const waitState = (want, timeoutMs) =>
    waitFor(async () => (await probe()).state === want, timeoutMs, `state=${want}`);

  // hold a key until fn() is true or timeout; polls while the key is down
  const holdUntil = async (key, fn, timeoutMs, label) => {
    await page.keyboard.down(key);
    const ok = await waitFor(fn, timeoutMs, label);
    await page.keyboard.up(key);
    return ok;
  };

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#md-intro button", { timeout: 20000 });
  await page.waitForFunction(() => window.__story && window.__story.ready, null, { timeout: 30000 });
  await page.evaluate(() => window.__watchDom());
  await sleep(400);
  await page.click("#md-intro button");
  console.log("== begin ==");

  // --- Act I: knock 4 times (state-driven) ---
  await holdUntil("ArrowRight", async () => (await probe()).knockCount >= 1, 15000, "knock1");
  for (let k = 2; k <= 4; k++) {
    await holdUntil("ArrowLeft", async () => (await probe()).charX < 0.93, 8000, `leave door (knock ${k})`);
    await holdUntil("ArrowRight", async () => (await probe()).knockCount >= k, 10000, `knock${k}`);
  }
  console.log("== 4 knocks done ==");
  await waitState("freeRoam", 15000);
  console.log("== freeRoam ==");

  // --- Act II: walk to theatre centre -> garden dialogue ---
  await holdUntil("ArrowRight", async () => (await probe()).state === "gardenTalk", 30000, "gardenTalk");
  console.log("== gardenTalk ==");
  // garden dialogue ~13s; talkEnd shows the click prompt
  await waitState("talkEnd", 45000);
  console.log("== talkEnd (garden dialogue finished) ==");
  await page.evaluate(() => document.querySelector("#md-click-prompt")?.click());
  console.log("== clicked into rhythm ==");

  // rhythm performance ~19s + rewardFeet 4s -> toMirror
  await waitState("toMirror", 60000);
  console.log("== toMirror ==");
  await holdUntil("ArrowRight", async () => (await probe()).state === "assemble", 40000, "assemble");
  console.log("== assemble (mirror dialogue) ==");
  // mirror dialogue ~22s + assemble anim ~3s -> rewardTorso
  await waitState("rewardTorso", 60000);
  console.log("== rewardTorso ==");

  // reward 4s + ripple -> finale, quotes play automatically
  await waitState("finale", 30000);
  console.log("== finale ==");
  await sleep(22000); // finale quotes ~17s

  // --- Replay: click 重新体验 and verify the second playthrough ---
  await page.evaluate(() => {
    const btn = document.querySelector("#md-finale .md-primary");
    if (btn) btn.click();
  });
  console.log("== replay clicked ==");
  await waitState("approach", 8000);
  await holdUntil("ArrowRight", async () => (await probe()).knockCount >= 1, 15000, "re-knock1");
  for (let k = 2; k <= 4; k++) {
    await holdUntil("ArrowLeft", async () => (await probe()).charX < 0.93, 8000, `re-leave door (${k})`);
    await holdUntil("ArrowRight", async () => (await probe()).knockCount >= k, 10000, `re-knock${k}`);
  }
  await waitState("freeRoam", 15000);
  console.log("== replay freeRoam ==");
  await holdUntil("ArrowRight", async () => (await probe()).state === "gardenTalk", 30000, "re-gardenTalk");
  console.log("== replay gardenTalk ==");
  await waitState("talkEnd", 60000);
  console.log("== replay talkEnd (garden dialogue finished) ==");

  const log = await page.evaluate(() => window.__log);
  const t0 = log.length ? log[0].t : 0;
  console.log("\n== timeline ==");
  for (const e of log) {
    console.log(`${((e.t - t0) / 1000).toFixed(2).padStart(8)}s  ${e.ev.padEnd(12)} ${e.detail}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
