// Cut the three m4a dialogue files into per-line WAV clips (16-bit mono 24kHz)
// using Chromium's decodeAudioData (no ffmpeg required).
const fs = require("fs");
const path = require("path");
const { chromium } = require("C:/Users/sunjunjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "public", "audio", "chamber");
const TARGET_SR = 24000;

// Each source recording contains every line read TWICE (a repeated second
// take follows the first). The ranges below keep only the second take of
// each line, trimmed at the inter-take silence, so no clip ends with a
// repeated phrase. Boundaries were located by envelope/spectral analysis
// (RMS envelope + self-similarity of the decoded PCM).
const jobs = [
  {
    src: "public/audio/chamber/garden-quote.mp3",
    segs: [
      // 「不到园林，怎知春色如许」also read twice; keep the second take
      ["garden-quote.wav", 4.7, 10.95],
    ],
  },
  {
    src: "你是谁.m4a",
    segs: [
      ["garden-line1.wav", 3.88, 5.94],
      ["garden-line2.wav", 9.48, 12.25],
      ["garden-line3.wav", 17.55, 22.7],
    ],
  },
  {
    src: "我是谁.m4a",
    segs: [
      ["mirror-line1.wav", 3.98, 6.02],
      ["mirror-line2.wav", 9.28, 11.45],
      ["mirror-line3.wav", 18.3, 24.4],
      ["mirror-line4.wav", 37.35, 46.4],
    ],
  },
  {
    src: "情不知.m4a",
    segs: [
      ["finale-line1.wav", 5.15, 9.05],
      ["finale-line2.wav", 15.25, 20.05],
      ["finale-line3.wav", 29.35, 35.6],
    ],
  },
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Users/sunjunjie/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe",
  });
  const page = await browser.newPage();
  await page.goto("about:blank");

  for (const job of jobs) {
    const b64 = fs.readFileSync(path.join(ROOT, job.src)).toString("base64");
    const results = await page.evaluate(async ({ b64, segs, targetSr }) => {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const buf = await ctx.decodeAudioData(raw.buffer.slice(0));
      const sr = buf.sampleRate;
      const ch0 = buf.getChannelData(0);
      const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;

      const wavHeader = (dataLen) => {
        const h = new ArrayBuffer(44);
        const v = new DataView(h);
        const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        ws(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); ws(8, "WAVE");
        ws(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
        v.setUint16(22, 1, true); v.setUint32(24, targetSr, true);
        v.setUint32(28, targetSr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        ws(36, "data"); v.setUint32(40, dataLen, true);
        return new Uint8Array(h);
      };

      return segs.map(([name, start, end]) => {
        const s0 = Math.max(0, Math.floor(start * sr));
        const s1 = Math.min(buf.length, Math.ceil(end * sr));
        const n = s1 - s0;
        const outLen = Math.round((n / sr) * targetSr);
        const pcm = new Int16Array(outLen);
        // short fades to avoid clicks at the cut points
        const fadeIn = Math.min(Math.round(0.03 * targetSr), outLen >> 1);
        const fadeOut = Math.min(Math.round(0.12 * targetSr), outLen >> 1);
        for (let i = 0; i < outLen; i++) {
          const pos = (i / targetSr) * sr;
          const i0 = Math.min(n - 1, Math.floor(pos));
          const i1 = Math.min(n - 1, i0 + 1);
          const f = pos - i0;
          const a = ch1 ? (ch0[s0 + i0] + ch1[s0 + i0]) / 2 : ch0[s0 + i0];
          const b = ch1 ? (ch0[s0 + i1] + ch1[s0 + i1]) / 2 : ch0[s0 + i1];
          let v = Math.max(-1, Math.min(1, a + (b - a) * f));
          if (i < fadeIn) v *= i / fadeIn;
          if (i > outLen - fadeOut) v *= Math.max(0, (outLen - i) / fadeOut);
          pcm[i] = Math.round(v * 32767);
        }
        const data = new Uint8Array(pcm.buffer);
        const header = wavHeader(data.length);
        const full = new Uint8Array(44 + data.length);
        full.set(header, 0); full.set(data, 44);
        let bin = "";
        for (let i = 0; i < full.length; i += 8192)
          bin += String.fromCharCode.apply(null, full.subarray(i, i + 8192));
        return { name, b64: btoa(bin), dur: outLen / targetSr };
      });
    }, { b64, segs: job.segs, targetSr: TARGET_SR });

    for (const r of results) {
      fs.writeFileSync(path.join(OUT, r.name), Buffer.from(r.b64, "base64"));
      console.log(`${r.name}  ${r.dur.toFixed(2)}s`);
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
