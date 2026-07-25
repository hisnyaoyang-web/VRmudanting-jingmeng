import * as THREE from "three";
import { Puppet, PuppetState } from "./puppet";

/** 节奏时间轴（取自 VRmudanting-jingmeng 的 story.json，单位毫秒）。 */
type RhythmCue = { atMs: number; action: PuppetState; label: string; windowMs: number; points: number };
type NarrationLine = { atMs: number; speaker: string; text: string };

const NARRATION: NarrationLine[] = [
  { atMs: 0, speaker: "旁白", text: "月照空庭，武生推门而入。" },
  { atMs: 3200, speaker: "掌柜", text: "一方月门隔尘梦，半盏孤灯照故人。" },
  { atMs: 7600, speaker: "旁白", text: "忽闻桥外马蹄急，衣袖破风，影过寒潭。" },
  { atMs: 12300, speaker: "掌柜", text: "来时问月，去时不留名。" },
  { atMs: 15800, speaker: "旁白", text: "灯影渐收，一礼谢幕。" },
];

const CUES: RhythmCue[] = [
  { atMs: 1800, action: "hi", label: "入门见礼", windowMs: 700, points: 100 },
  { atMs: 4800, action: "walk", label: "向右过桥", windowMs: 800, points: 80 },
  { atMs: 8200, action: "run", label: "疾追灯火", windowMs: 650, points: 120 },
  { atMs: 11100, action: "flying", label: "临水飞袖", windowMs: 750, points: 150 },
  { atMs: 14300, action: "walk", label: "回身归园", windowMs: 800, points: 80 },
  { atMs: 16700, action: "hi", label: "谢幕留白", windowMs: 700, points: 100 },
];

const DURATION_MS = 18000;
const NOTE_TRAVEL_MS = 2200;
const GRADE_THRESHOLDS = [
  { id: "excellent", minScoreRatio: 0.82 },
  { id: "good", minScoreRatio: 0.55 },
  { id: "bad", minScoreRatio: 0 },
] as const;

export type RhythmResult = {
  grade: "excellent" | "good" | "bad";
  score: number;
  maxScore: number;
  combo: number;
};

const LANE_ACTIONS: PuppetState[] = ["hi", "walk", "run", "flying"];

export class RhythmStage {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private puppet: Puppet;
  private notes: THREE.Mesh[] = [];
  private noteGlows: THREE.Mesh[] = [];
  private railGroup = new THREE.Group();
  private clockMs = 0;
  private started = false;
  private finished = false;
  private score = 0;
  private maxScore = 0;
  private combo = 0;
  private bestCombo = 0;
  private playedIdx = new Set<number>();
  private audioCtx: AudioContext | null = null;
  private lastBeat = -1;
  private onLine?: (line: NarrationLine) => void;
  private onJudgment?: (text: string, combo: number) => void;
  private onEnd?: (result: RhythmResult) => void;
  private lineIdx = 0;
  private hudEl: HTMLElement;
  private comboEl: HTMLElement;
  private judgeEl: HTMLElement;
  private judgeTimer = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.maxScore = CUES.reduce((s, c) => s + c.points, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.domElement.style.position = "absolute";
    this.renderer.domElement.style.inset = "0";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.pointerEvents = "none";
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 60);
    this.camera.position.set(0, 2.3, 9.4);
    this.camera.lookAt(0, 1.7, 0);

    this.buildLighting();
    this.buildTheatre();
    this.buildLanes();

    const puppetLayer = document.createElement("div");
    puppetLayer.style.position = "absolute";
    puppetLayer.style.left = "50%";
    puppetLayer.style.bottom = "14%";
    puppetLayer.style.height = "56%";
    puppetLayer.style.aspectRatio = "2 / 3";
    puppetLayer.style.transform = "translateX(-50%)";
    puppetLayer.style.pointerEvents = "none";
    container.appendChild(puppetLayer);
    this.puppet = new Puppet(puppetLayer);

    this.hudEl = document.createElement("div");
    this.hudEl.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:10;";
    this.hudEl.innerHTML =
      '<div style="position:absolute;top:14%;left:50%;transform:translateX(-50%);text-align:center;">' +
      '<div id="rhythm-judge" style="font-size:clamp(28px,4vw,44px);letter-spacing:.2em;color:#f0c060;text-shadow:0 0 18px rgba(217,138,60,.7),0 2px 6px rgba(0,0,0,.8);min-height:1.4em;opacity:0;transition:opacity .2s ease;"></div>' +
      '<div id="rhythm-combo" style="margin-top:6px;font-size:clamp(16px,2.2vw,22px);letter-spacing:.3em;color:#f2d8a8;text-shadow:0 0 12px rgba(217,138,60,.5);min-height:1.2em;"></div></div>';
    container.appendChild(this.hudEl);
    this.judgeEl = this.hudEl.querySelector("#rhythm-judge") as HTMLElement;
    this.comboEl = this.hudEl.querySelector("#rhythm-combo") as HTMLElement;

    const onResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    };
    onResize();
    window.addEventListener("resize", onResize);
  }

  async load() {
    await this.puppet.load();
    this.puppet.setState("idle");
  }

  setCallbacks(opts: {
    onLine?: (line: NarrationLine) => void;
    onJudgment?: (text: string, combo: number) => void;
    onEnd?: (result: RhythmResult) => void;
  }) {
    this.onLine = opts.onLine;
    this.onJudgment = opts.onJudgment;
    this.onEnd = opts.onEnd;
  }

  private buildLighting() {
    this.scene.add(new THREE.AmbientLight("#7a6450", 0.7));
    this.scene.add(new THREE.HemisphereLight("#6f8790", "#17100c", 0.6));
    const dir = new THREE.DirectionalLight("#ffd08a", 2.0);
    dir.position.set(-3, 6, 4);
    this.scene.add(dir);
    const spot = new THREE.SpotLight("#ffb45d", 90, 16, 0.6, 0.85, 1.2);
    spot.position.set(0, 5.5, 3.5);
    spot.target.position.set(0, 0.5, 0);
    this.scene.add(spot, spot.target);
  }

  private buildTheatre() {
    const mat = (color: string, rough = 0.8, metal = 0) =>
      new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const box = (
      x: number, y: number, z: number, w: number, h: number, d: number,
      material: THREE.Material,
    ) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      m.position.set(x, y, z);
      this.scene.add(m);
      return m;
    };

    box(0, -0.42, 0, 11.7, 0.68, 5.1, mat("#171b1b"));
    box(0, -0.05, 2.25, 11.9, 0.32, 0.56, mat("#6d291f"));
    box(0, -0.12, 2.55, 10.9, 0.18, 0.68, mat("#b08a4e", 0.7, 0.12));

    for (const x of [-5.15, 5.15]) {
      box(x, 2.15, -0.12, 0.5, 5.1, 0.6, mat("#3c211b"));
      box(x, 2.15, -0.12, 0.26, 4.84, 0.78, mat("#842e20"));
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.24, 8), mat("#a98248", 0.6, 0.18));
      cap.position.set(x, 4.78, -0.12);
      this.scene.add(cap);
    }

    box(0, 4.58, -0.18, 10.9, 0.56, 0.84, mat("#3a201a"));
    box(0, 4.47, 0.25, 9.5, 0.22, 0.22, mat("#b28a4c", 0.7, 0.12));
    box(0, 5.02, -0.26, 12.1, 0.34, 1.64, mat("#101719"));
    box(0, 5.18, -0.62, 10.9, 0.22, 1.24, mat("#24302e"));

    for (const x of [-4.1, 4.1]) this.addLantern(x);

    const texLoader = new THREE.TextureLoader();
    texLoader.load("/stage/moongate-backdrop.webp", (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const backdrop = new THREE.Mesh(
        new THREE.PlaneGeometry(9.6, 5.4),
        new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
      );
      backdrop.position.set(0, 2.08, -2.42);
      this.scene.add(backdrop);
    });
  }

  private addLantern(x: number) {
    const g = new THREE.Group();
    const mat = (c: string, rough = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: rough });
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.78, 6), mat("#7c5b31"));
    rope.position.y = 0.78;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.31, 0.62, 10),
      new THREE.MeshStandardMaterial({ color: "#9f321f", emissive: "#ff6b2d", emissiveIntensity: 1.15, roughness: 0.7 }),
    );
    const cap2 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 6), mat("#b58a4d"));
    cap2.position.y = -0.45;
    const light = new THREE.PointLight("#ff7b32", 7, 2.6, 2);
    g.add(rope, body, cap2, light);
    g.position.set(x, 3.15, 0.7);
    this.scene.add(g);
  }

  private buildLanes() {
    this.scene.add(this.railGroup);
    const LANE_X = [-1.86, -0.62, 0.62, 1.86];
    const LANE_COLORS = ["#68b3a3", "#e2b85f", "#dc875d", "#c478a7"];
    const HIT_Y = 1.4;
    const FAR_Y = 5.0;
    const Z = -0.3;

    for (let i = 0; i < 4; i++) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.022, FAR_Y - HIT_Y, 0.02),
        new THREE.MeshBasicMaterial({ color: LANE_COLORS[i], transparent: true, opacity: 0.35, toneMapped: false }),
      );
      rail.position.set(LANE_X[i], (HIT_Y + FAR_Y) / 2, Z);
      this.railGroup.add(rail);

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.26, 0.035, 10, 28),
        new THREE.MeshBasicMaterial({ color: LANE_COLORS[i], transparent: true, opacity: 0.85, toneMapped: false }),
      );
      ring.position.set(LANE_X[i], HIT_Y, Z);
      this.railGroup.add(ring);
    }

    const laneBuckets: THREE.Mesh[][] = [[], [], [], []];
    const laneGlows: THREE.Mesh[][] = [[], [], [], []];
    for (const cue of CUES) {
      const lane = LANE_ACTIONS.indexOf(cue.action);
      if (lane < 0) continue;
      const note = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.22, 0),
        new THREE.MeshStandardMaterial({
          color: LANE_COLORS[lane], emissive: LANE_COLORS[lane], emissiveIntensity: 1.4, roughness: 0.4, toneMapped: false,
        }),
      );
      note.position.set(LANE_X[lane], FAR_Y, Z);
      note.visible = false;
      this.railGroup.add(note);
      laneBuckets[lane].push(note);
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 12, 10),
        new THREE.MeshBasicMaterial({ color: LANE_COLORS[lane], transparent: true, opacity: 0.18, toneMapped: false }),
      );
      glow.position.copy(note.position);
      glow.visible = false;
      this.railGroup.add(glow);
      laneGlows[lane].push(glow);
    }
    this.notes = [];
    this.noteGlows = [];
    const laneCounters = [0, 0, 0, 0];
    for (const cue of CUES) {
      const lane = LANE_ACTIONS.indexOf(cue.action);
      if (lane < 0) continue;
      this.notes.push(laneBuckets[lane][laneCounters[lane]]);
      this.noteGlows.push(laneGlows[lane][laneCounters[lane]]);
      laneCounters[lane]++;
    }
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.clockMs = 0;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.playedIdx = new Set<number>();
    this.lineIdx = 0;
    this.notes.forEach((n) => (n.visible = false));
    this.noteGlows.forEach((g) => (g.visible = false));
    this.puppet.setState("idle");
    try {
      this.audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      void this.audioCtx.resume();
    } catch {
      this.audioCtx = null;
    }
  }

  private beat(time: number) {
    if (!this.audioCtx) return;
    const ctx = this.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(Math.floor(time) % 4 === 0 ? 92 : 128, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(Math.floor(time) % 4 === 0 ? 0.06 : 0.032, ctx.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.14);
  }

  private strike(cue: RhythmCue) {
    if (!this.audioCtx) return;
    const ctx = this.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(cue.action === "flying" ? 320 : 260, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  }

  private autoJudge(idx: number) {
    if (this.playedIdx.has(idx)) return;
    this.playedIdx.add(idx);
    const cue = CUES[idx];
    this.score += cue.points;
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.strike(cue);
    this.puppet.setState(cue.action);
    const txt = "完美 · " + cue.label;
    if (this.onJudgment) this.onJudgment(txt, this.combo);
    this.flashJudge(txt);
  }

  private flashJudge(text: string) {
    this.judgeEl.textContent = text;
    this.judgeEl.style.opacity = "1";
    this.comboEl.textContent = this.combo > 1 ? "连击 ×" + this.combo : "";
    this.judgeTimer = 1.1;
  }

  private endShow() {
    if (this.finished) return;
    this.finished = true;
    const ratio = this.maxScore ? this.score / this.maxScore : 0;
    const grade = [...GRADE_THRESHOLDS]
      .sort((a, b) => b.minScoreRatio - a.minScoreRatio)
      .find((g) => ratio >= g.minScoreRatio)?.id ?? "bad";
    if (this.audioCtx) {
      try { void this.audioCtx.close(); } catch { /* ignore */ }
      this.audioCtx = null;
    }
    if (this.onEnd) this.onEnd({ grade, score: this.score, maxScore: this.maxScore, combo: this.bestCombo });
  }

  update(dt: number) {
    if (!this.started) return;
    const prev = this.clockMs;
    this.clockMs += dt * 1000;
    const now = this.clockMs;

    if (this.judgeTimer > 0) {
      this.judgeTimer -= dt;
      if (this.judgeTimer <= 0) this.judgeEl.style.opacity = "0";
    }

    const beatPeriod = 0.45;
    const prevBeat = Math.floor(prev / 1000 / beatPeriod);
    const curBeat = Math.floor(now / 1000 / beatPeriod);
    if (curBeat !== prevBeat && curBeat > this.lastBeat) {
      this.lastBeat = curBeat;
      this.beat(curBeat);
    }

    while (this.lineIdx < NARRATION.length && now >= NARRATION[this.lineIdx].atMs) {
      if (this.onLine) this.onLine(NARRATION[this.lineIdx]);
      this.lineIdx++;
    }

    const HIT_Y = 1.4;
    const FAR_Y = 5.0;
    for (let i = 0; i < CUES.length; i++) {
      const cue = CUES[i];
      const appearAt = cue.atMs - NOTE_TRAVEL_MS;
      if (now < appearAt) continue;
      const note = this.notes[i];
      const glow = this.noteGlows[i];
      if (note && !this.playedIdx.has(i)) {
        note.visible = true;
        if (glow) glow.visible = true;
        const progress = (now - appearAt) / NOTE_TRAVEL_MS;
        const y = FAR_Y + (HIT_Y - FAR_Y) * Math.min(1, Math.max(0, progress));
        note.position.y = y;
        note.rotation.y += dt * 2.2;
        if (glow) glow.position.y = y;
      }
      if (now >= cue.atMs && !this.playedIdx.has(i)) {
        this.autoJudge(i);
      }
    }

    if (now >= DURATION_MS && !this.finished) {
      this.puppet.setState("idle");
      this.endShow();
    }

    this.puppet.render();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    try {
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.hudEl.remove();
      if (this.audioCtx) void this.audioCtx.close();
    } catch { /* ignore */ }
  }
}
