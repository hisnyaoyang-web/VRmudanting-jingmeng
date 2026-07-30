/**
 * 素材预处理：白底/绿幕抠图 + 门扇裁剪
 * 用法：node scripts/cutout.mjs
 */
import { Jimp } from "jimp";
import { mkdirSync } from "node:fs";
import path from "node:path";

const SRC = "C:/Users/sunjunjie/Desktop/场景";
const OUT = path.resolve("public/scenes");
mkdirSync(OUT, { recursive: true });

/** 白底抠图：近白像素透明，边缘半透明去白边 */
function keyWhite(img, hi = 244, lo = 218) {
  const { data, width, height } = img.bitmap;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const m = Math.min(r, g, b);
    let a;
    if (m >= hi) a = 0;
    else if (m <= lo) a = 255;
    else a = Math.round(((hi - m) / (hi - lo)) * 255);
    if (a > 0 && a < 255) {
      // 去白底溢色：把颜色从白色中解混
      const k = a / 255;
      data[o] = Math.min(255, Math.max(0, Math.round((r - 255 * (1 - k)) / k)));
      data[o + 1] = Math.min(255, Math.max(0, Math.round((g - 255 * (1 - k)) / k)));
      data[o + 2] = Math.min(255, Math.max(0, Math.round((b - 255 * (1 - k)) / k)));
    }
    data[o + 3] = a;
  }
}

/** 绿幕抠图：高纯绿透明，去绿溢色 */
function keyGreen(img) {
  const { data, width, height } = img.bitmap;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    // 绿幕纯度：纯绿 g 高且 r/b 低；皮影里的暗绿 r/g 接近，不会被误杀
    const dominance = g - Math.max(r, b);
    let a = 255;
    if (g > 150 && dominance > 90) a = 0;
    else if (g > 130 && dominance > 55) a = Math.round(255 * (1 - (dominance - 55) / 35));
    if (a === 0) {
      data[o + 3] = 0;
      continue;
    }
    // 去绿溢色
    if (g > r && g > b && dominance > 12) {
      data[o + 1] = Math.max(r, b) + 12;
    }
    data[o + 3] = a;
  }
}

/** 统计背景色采样 */
function sample(img, label) {
  const { data, width, height } = img.bitmap;
  const pts = [
    [2, 2],
    [width - 3, 2],
    [2, height - 3],
    [width - 3, height - 3],
    [Math.floor(width / 2), 2],
  ];
  const colors = pts.map(([x, y]) => {
    const o = (y * width + x) * 4;
    return `(${data[o]},${data[o + 1]},${data[o + 2]})`;
  });
  console.log(`${label}: ${width}x${height} 边角采样 ${colors.join(" ")}`);
}

async function process(srcPath, outName, keyFn, downscaleW = 2048) {
  const img = await Jimp.read(srcPath);
  sample(img, outName);
  if (img.bitmap.width > downscaleW) img.scaleToFit({ w: downscaleW, h: 1e6 });
  keyFn(img);
  const out = path.join(OUT, outName);
  await img.write(out);
  console.log(`  -> ${out}`);
}

async function copy(srcPath, outName, downscaleW = 2048) {
  const img = await Jimp.read(srcPath);
  sample(img, outName);
  if (img.bitmap.width > downscaleW) img.scaleToFit({ w: downscaleW, h: 1e6 });
  const out = path.join(OUT, outName);
  await img.write(out);
  console.log(`  -> ${out}`);
}

/** 从场景1-前裁门扇（源图已带透明通道，无需抠图） */
async function cropDoor(srcPath) {
  const img = await Jimp.read(srcPath);
  const W = img.bitmap.width;
  const H = img.bitmap.height;
  // 左门：约 x 6%..21%, y 14%..84%；右门镜像（按 2048 宽的观察比例）
  const crops = [
    { name: "chamber-door-l.png", x0: 0.055, x1: 0.175, y0: 0.165, y1: 0.8 },
    { name: "chamber-door-r.png", x0: 0.825, x1: 0.945, y0: 0.165, y1: 0.8 },
  ];
  for (const c of crops) {
    const piece = img.clone();
    piece.crop({
      x: Math.round(c.x0 * W),
      y: Math.round(c.y0 * H),
      w: Math.round((c.x1 - c.x0) * W),
      h: Math.round((c.y1 - c.y0) * H),
    });
    const out = path.join(OUT, c.name);
    await piece.write(out);
    console.log(`  -> ${out} (${piece.bitmap.width}x${piece.bitmap.height})`);
  }
}

// 场景1：闺房（中后/前 已带透明通道，直接复制缩放）
await copy(`${SRC}/场景1/场景1-后.png`, "chamber-back.png", 1920);
await copy(`${SRC}/场景1/场景1-中后.png`, "chamber-mid.png");
await copy(`${SRC}/场景1/场景1-前.png`, "chamber-front.png");
await cropDoor(`${SRC}/场景1/场景1-前.png`);

// 场景2：花园
await copy(`${SRC}/场景2/场景2-后.png`, "garden-back.png", 1920);
await process(`${SRC}/场景2/场景2-中后.png`, "garden-mid.png", keyGreen);
await process(`${SRC}/场景2/场景2-前.png`, "garden-front.png", keyGreen);

console.log("全部完成");
