/**
 * VR Layer for experience2 — composites the game DOM + FX canvas onto a VR screen.
 * Mode toggle button is positioned at bottom-left.
 * Cinema (flat) + Immersive (curved panorama) modes. VR thumbstick -> left/right.
 */
import * as THREE from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";

const CAPTURE_W = 1920;
const CAPTURE_H = 1080;
const THUMBSTICK_THRESHOLD = 0.35;

const captureCanvas = document.createElement("canvas");
captureCanvas.width = CAPTURE_W;
captureCanvas.height = CAPTURE_H;
const captureCtx = captureCanvas.getContext("2d")!;
const scaleX = CAPTURE_W / window.innerWidth;
const scaleY = CAPTURE_H / window.innerHeight;

const imgCache = new Map<string, HTMLImageElement>();
function preload(url: string) {
  if (imgCache.has(url)) return;
  const img = new Image();
  img.onload = () => imgCache.set(url, img);
  img.src = url;
}
[
  "/scenes/s1-back.png", "/scenes/s1-mid.png", "/scenes/s1-front.png",
  "/scenes/s2-back.png", "/scenes/s2-mid.png", "/scenes/s2-front.png",
  "/stage/moongate-backdrop.webp", "/mirror/mirror.png",
].forEach(preload);

function bgUrl(el: HTMLElement): string | null {
  const bg = getComputedStyle(el).backgroundImage;
  const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
  return m ? m[1] : null;
}
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement | HTMLCanvasElement,
  dx: number, dy: number, dw: number, dh: number) {
  const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width;
  const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height;
  if (!iw || !ih) return;
  const ir = iw / ih, br = dw / dh;
  let sx = 0, sy = 0, sw = iw, sh = ih;
  if (ir > br) { sw = ih * br; sx = (iw - sw) / 2; }
  else { sh = iw / br; sy = (ih - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function captureFrame() {
  const ctx = captureCtx;
  ctx.fillStyle = "#0a0608";
  ctx.fillRect(0, 0, CAPTURE_W, CAPTURE_H);
  for (const sel of [".layer-back", ".layer-mid", ".layer-front"]) {
    const layer = document.querySelector(sel);
    if (!layer) continue;
    for (const half of layer.querySelectorAll<HTMLElement>(".half")) {
      const url = bgUrl(half);
      if (!url) continue;
      const img = imgCache.get(url);
      if (!img) continue;
      const r = half.getBoundingClientRect();
      if (r.right < 0 || r.left > window.innerWidth) continue;
      drawCover(ctx, img, r.left * scaleX, r.top * scaleY, r.width * scaleX, r.height * scaleY);
    }
  }
  const door = document.getElementById("md-door");
  if (door && !door.classList.contains("hidden")) {
    const r = door.getBoundingClientRect();
    const cx = (r.left + r.width / 2) * scaleX, cy = (r.top + r.height * 0.45) * scaleY;
    const rad = Math.max(r.width, r.height) * 0.5 * scaleX;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, "rgba(245,201,107,0.5)");
    g.addColorStop(0.7, "rgba(245,201,107,0)");
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = g;
    ctx.fillRect(r.left * scaleX, r.top * scaleY, r.width * scaleX, r.height * scaleY);
    ctx.restore();
  }
  const mirror = document.getElementById("md-mirror");
  if (mirror && !mirror.classList.contains("hidden")) {
    const mi = mirror.querySelector("img");
    if (mi && mi.complete && mi.naturalWidth) {
      const r = mirror.getBoundingClientRect();
      drawCover(ctx, mi, r.left * scaleX, r.top * scaleY, r.width * scaleX, r.height * scaleY);
    }
  }
  const pc = document.querySelector<HTMLCanvasElement>("#puppet-layer canvas");
  if (pc) {
    const r = pc.getBoundingClientRect();
    ctx.drawImage(pc, r.left * scaleX, r.top * scaleY, r.width * scaleX, r.height * scaleY);
  }
  const rs = document.getElementById("rhythm-stage");
  if (rs) {
    for (const c of rs.querySelectorAll<HTMLCanvasElement>("canvas")) {
      const r = c.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        ctx.drawImage(c, r.left * scaleX, r.top * scaleY, r.width * scaleX, r.height * scaleY);
    }
  }
  // FX canvas overlay (particles, shatter, ripple)
  const fxc = document.getElementById("fx-canvas") as HTMLCanvasElement | null;
  if (fxc) {
    ctx.drawImage(fxc, 0, 0, CAPTURE_W, CAPTURE_H);
  }
  // Subtitle text
  const sub = document.getElementById("md-sub");
  if (sub && !sub.classList.contains("hidden")) {
    const text = sub.textContent?.replace(/\s+/g, " ").trim() || "";
    if (text) {
      ctx.save();
      ctx.font = Math.round(32 * scaleY) + 'px "Kaiti SC","KaiTi",serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const cx = CAPTURE_W / 2, cy = CAPTURE_H * 0.83, tw = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(14,6,10,0.75)";
      ctx.fillRect(cx - tw / 2 - 24, cy - 28, tw + 48, 56);
      ctx.fillStyle = "#f2d8a8";
      ctx.shadowColor = "rgba(217,138,60,0.6)";
      ctx.shadowBlur = 8;
      ctx.fillText(text, cx, cy);
      ctx.restore();
    }
  }
  // Accumulating voices
  const voices = document.getElementById("md-voices");
  if (voices && !voices.classList.contains("hidden")) {
    const lines = voices.querySelectorAll<HTMLElement>(".voice-line");
    lines.forEach((line, i) => {
      const text = line.textContent?.trim() || "";
      if (!text) return;
      const opacity = parseFloat(getComputedStyle(line).opacity);
      if (opacity < 0.05) return;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.font = Math.round(26 * scaleY) + 'px "Kaiti SC","KaiTi",serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const cx = CAPTURE_W / 2;
      const cy = CAPTURE_H * (0.18 + i * 0.06);
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(14,6,10,0.5)";
      ctx.fillRect(cx - tw / 2 - 16, cy - 18, tw + 32, 36);
      ctx.fillStyle = "#f2d8a8";
      ctx.fillText(text, cx, cy);
      ctx.restore();
    });
  }
}

// === VR renderer ===
const vrRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
vrRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
vrRenderer.setSize(window.innerWidth, window.innerHeight);
vrRenderer.outputColorSpace = THREE.SRGBColorSpace;
vrRenderer.toneMapping = THREE.ACESFilmicToneMapping;
vrRenderer.xr.enabled = true;
vrRenderer.domElement.style.position = "fixed";
vrRenderer.domElement.style.inset = "0";
vrRenderer.domElement.style.zIndex = "1";
vrRenderer.domElement.style.pointerEvents = "none";
vrRenderer.domElement.style.opacity = "0";
document.body.appendChild(vrRenderer.domElement);

const vrScene = new THREE.Scene();
vrScene.background = new THREE.Color("#050307");
const vrCamera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.05, 200);
vrScene.add(new THREE.AmbientLight("#3a2a20", 0.6));

const screenTex = new THREE.CanvasTexture(captureCanvas);
screenTex.colorSpace = THREE.SRGBColorSpace;
screenTex.minFilter = THREE.LinearFilter;
screenTex.magFilter = THREE.LinearFilter;

// Cinema
const CINEMA_DIST = 6, CINEMA_H = 4.2;
const cinemaW = CINEMA_H * (CAPTURE_W / CAPTURE_H);
const cinemaScreen = new THREE.Mesh(
  new THREE.PlaneGeometry(cinemaW, CINEMA_H),
  new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }),
);
cinemaScreen.position.set(0, 0, -CINEMA_DIST);
const cinemaFrame = new THREE.Mesh(
  new THREE.PlaneGeometry(cinemaW + 0.3, CINEMA_H + 0.3),
  new THREE.MeshBasicMaterial({ color: "#1a0e08", toneMapped: false }),
);
cinemaFrame.position.set(0, 0, -CINEMA_DIST - 0.02);
const cinemaFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: "#0a0608", roughness: 0.4, metalness: 0.3 }),
);
cinemaFloor.rotation.x = -Math.PI / 2;
cinemaFloor.position.y = -CINEMA_H / 2 - 0.3;
const cinemaGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(cinemaW + 2, CINEMA_H + 2),
  new THREE.MeshBasicMaterial({ color: "#d98a3c", transparent: true, opacity: 0.08, toneMapped: false }),
);
cinemaGlow.position.set(0, 0, -CINEMA_DIST - 0.05);
const cinemaLight = new THREE.PointLight("#d98a3c", 8, 15, 1.5);
cinemaLight.position.set(0, 0, -CINEMA_DIST + 1);

// Immersive
const IMMERSE_RADIUS = 3.5;
const IMMERSE_HEIGHT = 5;
const IMMERSE_ARC = Math.PI * 1.6;
function buildImmerseGeometry() {
  const geo = new THREE.CylinderGeometry(IMMERSE_RADIUS, IMMERSE_RADIUS, IMMERSE_HEIGHT, 96, 1, true, -IMMERSE_ARC / 2, IMMERSE_ARC);
  const pos = geo.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const angle = Math.atan2(x, -z);
    uvs[i * 2] = (angle + IMMERSE_ARC / 2) / IMMERSE_ARC;
    uvs[i * 2 + 1] = pos.getY(i) < 0 ? 0 : 1;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  return geo;
}
const immerseScreen = new THREE.Mesh(
  buildImmerseGeometry(),
  new THREE.MeshBasicMaterial({ map: screenTex, side: THREE.BackSide, toneMapped: false }),
);
const immerseFloor = new THREE.Mesh(
  new THREE.CircleGeometry(20, 64),
  new THREE.MeshStandardMaterial({ color: "#0a0608", roughness: 0.3, metalness: 0.5 }),
);
immerseFloor.rotation.x = -Math.PI / 2;
immerseFloor.position.y = -IMMERSE_HEIGHT / 2 + 0.1;
const immerseLight1 = new THREE.PointLight("#ff8c40", 6, 12, 1.8);
immerseLight1.position.set(0, 1, 0);
const immerseLight2 = new THREE.PointLight("#d98a3c", 3, 8, 2);
immerseLight2.position.set(IMMERSE_RADIUS * 0.5, -0.5, 0);
const immerseSky = new THREE.Mesh(
  new THREE.SphereGeometry(30, 32, 16, 0, Math.PI * 1.6, 0, Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: "#0a0608", side: THREE.BackSide, toneMapped: false }),
);

let immersive = false;
const cinemaGroup = new THREE.Group();
cinemaGroup.add(cinemaScreen, cinemaFrame, cinemaFloor, cinemaGlow, cinemaLight);
const immerseGroup = new THREE.Group();
immerseGroup.add(immerseScreen, immerseFloor, immerseLight1, immerseLight2, immerseSky);
vrScene.add(cinemaGroup);
immerseGroup.visible = false;
vrScene.add(immerseGroup);

const hud = document.getElementById("vr-hud");
function setMode(imm: boolean) {
  immersive = imm;
  cinemaGroup.visible = !imm;
  immerseGroup.visible = imm;
  if (hud) hud.textContent = imm
    ? "\u6c89\u6d78\u6a21\u5f0f \u00b7 \u5de6\u53f3\u6447\u6746\u79fb\u52a8 \u00b7 \u73af\u987e\u56db\u5468"
    : "\u5f71\u9662\u6a21\u5f0f \u00b7 \u5de6\u53f3\u6447\u6746\u79fb\u52a8 \u00b7 \u6234\u4e0a\u5934\u663e\u8fdb\u5165 VR";
}

let leftHeld = false, rightHeld = false;
function key(code: string, type: "keydown" | "keyup") {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
}
function pollControllers() {
  const session = vrRenderer.xr.getSession();
  if (!session) return;
  let totalX = 0, count = 0;
  for (const s of session.inputSources) {
    if (!s.gamepad) continue;
    const axes = s.gamepad.axes;
    const x = axes.length > 2 ? axes[2] : axes[0];
    if (typeof x === "number" && Math.abs(x) > 0.01) { totalX += x; count++; }
  }
  const avg = count > 0 ? totalX / count : 0;
  if (avg > THUMBSTICK_THRESHOLD) {
    if (!rightHeld) { rightHeld = true; key("ArrowRight", "keydown"); }
    if (leftHeld) { leftHeld = false; key("ArrowLeft", "keyup"); }
  } else if (avg < -THUMBSTICK_THRESHOLD) {
    if (!leftHeld) { leftHeld = true; key("ArrowLeft", "keydown"); }
    if (rightHeld) { rightHeld = false; key("ArrowRight", "keyup"); }
  } else {
    if (leftHeld) { leftHeld = false; key("ArrowLeft", "keyup"); }
    if (rightHeld) { rightHeld = false; key("ArrowRight", "keyup"); }
  }
}

const vrBtn = VRButton.createButton(vrRenderer);
(vrBtn as HTMLElement).style.zIndex = "999";
(vrBtn as HTMLElement).style.pointerEvents = "auto";
document.body.appendChild(vrBtn);

// Mode toggle button — BOTTOM-LEFT corner
const modeBtn = document.createElement("button");
modeBtn.textContent = "\u8fdb\u5165\u5168\u666f\u6c89\u6d78";
modeBtn.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:999;" +
  'font-family:"Kaiti SC","KaiTi",serif;font-size:16px;letter-spacing:.15em;color:#f2d8a8;' +
  "background:linear-gradient(180deg,rgba(217,138,60,.9),rgba(180,100,40,.9));border:1px solid #f0c060;" +
  "border-radius:6px;padding:10px 24px;cursor:pointer;box-shadow:0 4px 18px rgba(217,138,60,.4);" +
  "pointer-events:auto;transition:transform .2s ease,box-shadow .2s ease;";
modeBtn.onmouseenter = () => { modeBtn.style.transform = "translateY(-2px)"; modeBtn.style.boxShadow = "0 8px 24px rgba(217,138,60,.5)"; };
modeBtn.onmouseleave = () => { modeBtn.style.transform = "translateY(0)"; modeBtn.style.boxShadow = "0 4px 18px rgba(217,138,60,.4)"; };
modeBtn.onclick = () => {
  setMode(!immersive);
  modeBtn.textContent = immersive ? "\u8fd4\u56de\u5f71\u9662\u6a21\u5f0f" : "\u8fdb\u5165\u5168\u666f\u6c89\u6d78";
};
document.body.appendChild(modeBtn);

if (hud) hud.textContent = "\u5f71\u9662\u6a21\u5f0f \u00b7 \u5de6\u53f3\u6447\u6746\u79fb\u52a8 \u00b7 \u6234\u4e0a\u5934\u663e\u8fdb\u5165 VR";

vrRenderer.xr.addEventListener("sessionstart", () => {
  document.body.classList.add("vr-active");
  vrRenderer.domElement.style.opacity = "1";
});
vrRenderer.xr.addEventListener("sessionend", () => {
  document.body.classList.remove("vr-active");
  vrRenderer.domElement.style.opacity = "0";
});

vrRenderer.setAnimationLoop(() => {
  captureFrame();
  screenTex.needsUpdate = true;
  pollControllers();
  vrRenderer.render(vrScene, vrCamera);
});

window.addEventListener("resize", () => {
  vrCamera.aspect = window.innerWidth / window.innerHeight;
  vrCamera.updateProjectionMatrix();
  vrRenderer.setSize(window.innerWidth, window.innerHeight);
});

console.log("[VR2] WebXR layer ready - button bottom-left - cinema + immersive modes");
