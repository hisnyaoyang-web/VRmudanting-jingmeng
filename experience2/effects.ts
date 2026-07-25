/**
 * 梦入牡丹亭 · 特效引擎
 * 全屏 canvas 覆盖层（z-index:80），独立于长卷。
 *   敲门冲击粒子 / 文字震碎 / 碎片凝聚 / 光柱 / 水波 / 飘落花瓣
 * VR 捕获层会把本 canvas 也 drawImage 进 VR 画面。
 */
type Particle = {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
  hue: number; sat: number; light: number;
  alpha: number;
  gravity: number;
  drag: number;
  shape: "spark" | "shard" | "mote" | "petal" | "ring";
  rot: number; vr: number;
};

class FXEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private raf = 0;
  private lastT = 0;
  private ambient: "none" | "dust" | "petals" = "none";
  private ambientTimer = 0;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "fx-canvas";
    this.canvas.style.cssText = "position:fixed;inset:0;z-index:80;pointer-events:none;";
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    const resize = () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);
  }

  start() {
    if (this.raf) return;
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }
  stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  setAmbient(mode: "none" | "dust" | "petals") { this.ambient = mode; }

  private loop = (now: number) => {
    const dt = Math.min((now - this.lastT) / 1000, 0.05);
    this.lastT = now;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);

    if (this.ambient !== "none") {
      this.ambientTimer += dt;
      if (this.ambient === "dust" && this.ambientTimer > 0.18) { this.ambientTimer = 0; this.spawnDust(); }
      if (this.ambient === "petals" && this.ambientTimer > 0.35) { this.ambientTimer = 0; this.spawnPetal(); }
    }

    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.alpha = Math.min(1, p.life / (p.maxLife * 0.35));
      this.drawParticle(p);
      alive.push(p);
    }
    this.particles = alive;
    this.raf = requestAnimationFrame(this.loop);
  };

  private drawParticle(p: Particle) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    const color = "hsl(" + p.hue + "," + p.sat + "%," + p.light + "%)";
    if (p.shape === "spark") {
      ctx.fillStyle = color;
      ctx.shadowBlur = 12; ctx.shadowColor = color;
      ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill();
    } else if (p.shape === "shard") {
      ctx.fillStyle = color;
      ctx.shadowBlur = 8; ctx.shadowColor = color;
      ctx.beginPath();
      ctx.moveTo(0, -p.size); ctx.lineTo(p.size * 0.6, p.size * 0.4); ctx.lineTo(-p.size * 0.6, p.size * 0.4);
      ctx.closePath(); ctx.fill();
    } else if (p.shape === "mote") {
      ctx.fillStyle = color;
      ctx.globalAlpha = p.alpha * 0.5;
      ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill();
    } else if (p.shape === "petal") {
      ctx.fillStyle = color;
      ctx.shadowBlur = 6; ctx.shadowColor = "rgba(240,180,120,0.4)";
      ctx.beginPath(); ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    } else if (p.shape === "ring") {
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.shadowBlur = 16; ctx.shadowColor = color;
      ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  private spawnDust() {
    const w = this.canvas.width;
    this.particles.push({
      x: Math.random() * w, y: this.canvas.height + 10,
      vx: (Math.random() - 0.5) * 8, vy: -10 - Math.random() * 14,
      life: 6 + Math.random() * 4, maxLife: 10, size: 1 + Math.random() * 1.5,
      hue: 38 + Math.random() * 14, sat: 55, light: 60 + Math.random() * 20,
      alpha: 0, gravity: -0.5, drag: 0.15, shape: "mote", rot: 0, vr: 0,
    });
  }
  private spawnPetal() {
    const w = this.canvas.width;
    this.particles.push({
      x: Math.random() * w, y: -20,
      vx: (Math.random() - 0.5) * 18, vy: 20 + Math.random() * 26,
      life: 10 + Math.random() * 6, maxLife: 16, size: 3 + Math.random() * 4,
      hue: 340 + Math.random() * 20, sat: 50 + Math.random() * 20, light: 65 + Math.random() * 15,
      alpha: 0, gravity: 4, drag: 0.3, shape: "petal", rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 3,
    });
  }

  knock(x: number, y: number, intensity = 1) {
    const count = Math.round(18 * intensity);
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
      const speed = 60 + Math.random() * 140 * intensity;
      this.particles.push({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 0.5 + Math.random() * 0.4, maxLife: 0.9, size: 1.5 + Math.random() * 2.5,
        hue: 40 + Math.random() * 12, sat: 85 + Math.random() * 15, light: 60 + Math.random() * 20,
        alpha: 1, gravity: 180, drag: 2.5, shape: "spark", rot: 0, vr: 0,
      });
    }
    this.expandRing(x, y, 0.4, 70);
  }
  shatter(x: number, y: number, count = 40, spread = 360) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const speed = spread * (0.4 + Math.random() * 0.6);
      this.particles.push({
        x: x + (Math.random() - 0.5) * 80, y: y + (Math.random() - 0.5) * 30,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 60,
        life: 1.2 + Math.random() * 0.8, maxLife: 2, size: 3 + Math.random() * 5,
        hue: 38 + Math.random() * 16, sat: 60 + Math.random() * 30, light: 55 + Math.random() * 25,
        alpha: 1, gravity: 200, drag: 1.2, shape: "shard",
        rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 8,
      });
    }
  }
  burst(x: number, y: number, count = 50, hue = 44) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const speed = 80 + Math.random() * 120;
      this.particles.push({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 0.8 + Math.random() * 0.6, maxLife: 1.4, size: 2 + Math.random() * 3,
        hue: hue + (Math.random() - 0.5) * 10, sat: 90, light: 60 + Math.random() * 20,
        alpha: 1, gravity: 30, drag: 1.8, shape: "spark", rot: 0, vr: 0,
      });
    }
    this.expandRing(x, y, 0.6, 130);
  }
  lightShaft(x: number, y: number) {
    for (let i = 0; i < 28; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 220, y,
        vx: (Math.random() - 0.5) * 20, vy: 30 + Math.random() * 50,
        life: 1.5 + Math.random(), maxLife: 2.5, size: 2 + Math.random() * 3,
        hue: 44, sat: 80, light: 70, alpha: 1, gravity: 10, drag: 0.3, shape: "spark", rot: 0, vr: 0,
      });
    }
  }
  ripple(x: number, y: number) {
    this.expandRing(x, y, 2.2, 480);
    this.expandRing(x, y, 1.8, 340);
    this.expandRing(x, y, 1.4, 200);
  }
  private expandRing(x: number, y: number, life: number, maxR: number) {
    const grow = maxR / life;
    const ring: Particle = {
      x, y, vx: 0, vy: 0, life, maxLife: life, size: 2,
      hue: 42, sat: 80, light: 62, alpha: 1, gravity: 0, drag: 0, shape: "ring", rot: 0, vr: 0,
    };
    this.particles.push(ring);
    const startSize = ring.size;
    const start = performance.now();
    const growLoop = () => {
      const elapsed = (performance.now() - start) / 1000;
      ring.size = startSize + grow * elapsed;
      if (elapsed < life) requestAnimationFrame(growLoop);
    };
    requestAnimationFrame(growLoop);
  }
  clear() { this.particles = []; }
  get element() { return this.canvas; }
}

export const fx = new FXEngine();
fx.start();
