/**
 * 素材预处理：
 * 1) ef814bbd...jpg（白底酒瓶）→ 抠白底 + 裁剪到内容 bbox → public/props/wine-bottle.png
 * 2) 碎片-*.png / *型.png（已带透明通道）→ 裁剪到内容 bbox → public/props/*.png
 * 用法：node scripts/prepare-props.mjs
 */
import { Jimp } from "jimp";
import { mkdirSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve("public/props");
mkdirSync(OUT, { recursive: true });

/** 判断像素是否为近白（用于白底抠图） */
function isWhite(r, g, b, hi = 244) {
  return r >= hi && g >= hi && b >= hi;
}

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
      const k = a / 255;
      data[o] = Math.min(255, Math.max(0, Math.round((r - 255 * (1 - k)) / k)));
      data[o + 1] = Math.min(255, Math.max(0, Math.round((g - 255 * (1 - k)) / k)));
      data[o + 2] = Math.min(255, Math.max(0, Math.round((b - 255 * (1 - k)) / k)));
    }
    data[o + 3] = a;
  }
}

/** 找非透明内容的 bbox（alpha >= 阈值） */
function contentBBox(img, alphaThr = 16) {
  const { data, width, height } = img.bitmap;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (data[o + 3] >= alphaThr) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** 裁剪到内容 bbox（带少量内缩边距以去毛边），并可选最大宽度缩放 */
async function process(img, outName, opts = {}) {
  const { doKeyWhite = false, downscaleW = 0, pad = 2 } = opts;
  if (doKeyWhite) keyWhite(img);
  const bbox = contentBBox(img);
  if (!bbox) {
    console.log("  !! 无内容，跳过 " + outName);
    return;
  }
  const px = Math.max(0, pad);
  const cx = Math.max(0, bbox.x - px);
  const cy = Math.max(0, bbox.y - px);
  const cw = Math.min(img.bitmap.width - cx, bbox.w + px * 2);
  const ch = Math.min(img.bitmap.height - cy, bbox.h + px * 2);
  img.crop({ x: cx, y: cy, w: cw, h: ch });
  if (downscaleW > 0 && img.bitmap.width > downscaleW) {
    img.scaleToFit({ w: downscaleW, h: 1e6 });
  }
  const out = path.join(OUT, outName);
  await img.write(out);
  console.log("  -> " + out + " (" + img.bitmap.width + "x" + img.bitmap.height + ")");
}

// 1) 酒瓶：白底抠图 + 裁剪
{
  const img = await Jimp.read("ef814bbd06902eeb02c3bf9574067330.jpg");
  // 先把白底转透明（注意 JPG 无 alpha，keyWhite 会写出 alpha 通道）
  // Jimp 默认读 JPG 是 RGB，需要转成 RGBA 后写 alpha
  await process(img, "wine-bottle.png", { doKeyWhite: true, downscaleW: 600, pad: 4 });
}

// 2) 碎片图（已透明，仅裁剪到内容）
const shards = [
  ["碎片-双手.png", "shard-hands.png"],
  ["碎片-双腿.png", "shard-feet.png"],
  ["碎片-头和躯干.png", "shard-torso.png"],
];
for (const [src, out] of shards) {
  const img = await Jimp.read(src);
  await process(img, out, { downscaleW: 700, pad: 4 });
}

// 3) 四种性格类型图（已透明，仅裁剪到内容）
const types = [
  ["坚定型.png", "type-firm.png"],
  ["探索型.png", "type-explore.png"],
  ["自由型.png", "type-free.png"],
  ["觉醒型.png", "type-awaken.png"],
];
for (const [src, out] of types) {
  const img = await Jimp.read(src);
  await process(img, out, { downscaleW: 800, pad: 4 });
}

console.log("全部完成");
