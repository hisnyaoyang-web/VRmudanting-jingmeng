import { Puppet, type PuppetState } from "../src/puppet";
import { mountRhythm, unmountRhythm, type Root } from "../src/rhythm/rhythm-mount";
import { fx } from "./effects";
import { NftPanel } from "./nft-panel";

/**
 * 梦入牡丹亭 · 精修版故事舞台（S0-S12 完整状态机）
 *
 * 全程无强制按键：所有剧情靠「走到区域 + 计时」自动演完。
 * 唯一保留开场「开始体验」与结算的「重新/结束」按钮。
 * 叠加特效引擎（敲门粒子 / 文字震碎 / 碎片凝聚 / 水波 / 花瓣）。
 * 角色始终在最前层（z-index:5），不被任何背景遮挡。
 */

const CAM_FOLLOW = 0.42;
const SCENE_W = 1.4;
const SCROLL_MAX = 3 * SCENE_W - 1;

const CHAMBER = { left: 0.12 * SCENE_W, right: 0.9 * SCENE_W, door: 0.76 * SCENE_W, start: 0.3 * SCENE_W };
const SEAM1 = 1.0 * SCENE_W;
const SEAM2 = 2.0 * SCENE_W;
const THEATRE = { enter: 1.08 * SCENE_W, center: 1.5 * SCENE_W, exit: 1.92 * SCENE_W };
const GARDEN = { left: 2.08 * SCENE_W, right: 2.9 * SCENE_W, talk: 2.2 * SCENE_W, mirror: 2.67 * SCENE_W };
const WORLD_LEFT = 0.04;
const WORLD_RIGHT = 3 * SCENE_W - 0.04;

const DOOR_ZONE = 0.06;
const THEATRE_ZONE = 0.06;
const TALK_ZONE = 0.06;
const MIRROR_ZONE = 0.06;

const WALK_SPEED = 0.34;
const RUN_SPEED = 0.72;

const KNOCK_INTERVAL = 2.6;
const TALK_INTERVAL = 3.6;
const REWARD_HOLD = 4.0;
const LEAVE_TEXT_HOLD = 10.0;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T | null;

type GState =
  | "intro" | "approach" | "leaveText" | "rewardHands" | "freeRoam"
  | "rhythm"
  | "gardenTalk" | "talkEnd" | "rewardFeet" | "toMirror" | "assemble" | "rewardTorso"
  | "finale";

const KNOCK_LINES = [
  "女子无才便是德。",
  "不孝有三，无后为大。",
  "三从四德，女子当守其本分。",
];

const GARDEN_TALK: { who: string; text: string; anim?: PuppetState }[] = [
  { who: "玩家", text: "你是谁？" },
  { who: "杜丽娘", text: "我是杜丽娘。", anim: "hi" },
  { who: "玩家", text: "你是杜丽娘，那我是谁？" },
];

const ASSEMBLE_LINES = {
  start: { who: "玩家", text: "我是谁？" },
  placed: { who: "镜子", text: "你是杜丽娘。" },
  missing: { who: "玩家", text: "不，我不是杜丽娘。我是个看客罢了。" },
  shadow: { who: "镜子", text: "或许每个人的灵魂里都有一个杜丽娘。" },
};

let audioCtx: AudioContext | null = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)(); }
    catch { audioCtx = null; }
  }
  return audioCtx;
}
function knockSound() {
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(140, now);
  osc.frequency.exponentialRampToValueAtTime(45, now + 0.12);
  const g1 = ctx.createGain();
  g1.gain.setValueAtTime(0.35, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  osc.connect(g1).connect(ctx.destination);
  osc.start(now); osc.stop(now + 0.22);
  const len = Math.floor(ctx.sampleRate * 0.06);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.12, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  noise.connect(g2).connect(ctx.destination);
  noise.start(now);
}
// 三段真实音频（对应三次敲门台词），每段只播放一次，不循环
const KNOCK_AUDIO_SRC = [
  "/audio/chamber/knock1.mp3",
  "/audio/chamber/knock2.mp3",
  "/audio/chamber/knock3.mp3",
];
const activeAudio: HTMLAudioElement[] = [];
// 预加载：只设置 src 触发浏览器缓存，不创建播放实例
KNOCK_AUDIO_SRC.forEach((src) => {
  const a = new Audio();
  a.src = src;
  a.preload = "auto";
});
function playKnockVoice(idx: number) {
  const audio = new Audio(KNOCK_AUDIO_SRC[idx]);
  audio.loop = false;
  audio.volume = 0.85;
  audio.play().catch(() => {});
  activeAudio.push(audio);
}
function stopAllVoices() {
  for (const a of activeAudio) {
    try {
      a.pause();
      a.currentTime = 0;
      a.removeAttribute("src");
      a.load();
    } catch {}
  }
  activeAudio.length = 0;
}
// 第四次：三声同时叠加播放（各播放一次）
function playAllVoices() {
  stopAllVoices();
  for (let i = 0; i < 3; i++) {
    const audio = new Audio(KNOCK_AUDIO_SRC[i]);
    audio.loop = false;
    audio.volume = 0.7;
    audio.play().catch(() => {});
    activeAudio.push(audio);
  }
}

function chimeSound() {
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  [523, 659, 784].forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(f, now + i * 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now + i * 0.08);
    g.gain.linearRampToValueAtTime(0.15, now + i * 0.08 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.6);
    osc.connect(g).connect(ctx.destination);
    osc.start(now + i * 0.08); osc.stop(now + i * 0.08 + 0.7);
  });
}
const UI_STYLE = `
/* ===== 梦入牡丹亭 · 精修覆盖层 ===== */
.mudan-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse 80% 70% at 50% 45%, rgba(22,10,16,.88), rgba(5,2,6,.97)); animation: mdFadeIn .6s ease; }
.mudan-overlay.hidden { display: none !important; }
@keyframes mdFadeIn { from{opacity:0} to{opacity:1} }
.md-btn { font-family: var(--serif); letter-spacing:.18em; text-indent:.18em; cursor:pointer; border-radius:4px;
  transition: transform .12s ease, box-shadow .2s ease, background .2s ease; border:none; }
.md-primary { padding:14px 34px; font-size:clamp(16px,2vw,20px); color:#1a0a08;
  background:linear-gradient(180deg,var(--gold-bright),var(--ember)); border:1px solid var(--gold-bright);
  box-shadow:0 6px 18px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.4); }
.md-primary:hover{ transform:translateY(-2px); box-shadow:0 10px 26px rgba(217,138,60,.4); }
.md-ghost { padding:12px 26px; font-size:clamp(15px,1.8vw,18px); color:var(--paper); background:transparent;
  border:1px solid rgba(217,160,63,.55); }
.md-ghost:hover{ background:rgba(217,160,63,.12); }

/* 开场 */
#md-intro .md-card { max-width:min(580px,88vw); padding:42px 36px 32px; text-align:center; color:var(--paper);
  background:linear-gradient(180deg,rgba(28,12,18,.92),rgba(14,6,10,.96)); border:1px solid rgba(217,160,63,.4);
  border-top:2px solid var(--gold); border-bottom:2px solid var(--gold); box-shadow:0 20px 60px rgba(0,0,0,.6); }
.md-title { font-size:clamp(32px,5vw,48px); letter-spacing:.3em; text-indent:.3em; color:var(--gold-bright);
  text-shadow:0 0 28px rgba(217,138,60,.5); }
.md-sub { margin-top:6px; font-size:clamp(15px,2vw,19px); letter-spacing:.4em; text-indent:.4em; color:var(--ember); }
.md-controls { list-style:none; margin:26px auto 12px; max-width:440px; text-align:left; }
.md-controls li{ display:flex; align-items:center; gap:16px; padding:10px 6px;
  border-bottom:1px dashed rgba(217,160,63,.25); font-size:clamp(14px,1.8vw,17px); letter-spacing:.08em; }
.md-ctl-keys{ display:inline-flex; gap:6px; min-width:96px; }
.md-controls kbd{ display:inline-block; min-width:30px; padding:3px 8px; text-align:center; font-family:monospace;
  font-size:.9em; color:var(--gold-bright); border:1px solid rgba(217,160,63,.6); border-radius:4px; background:rgba(0,0,0,.25); }
.md-note{ margin:4px 0 22px; font-size:13px; letter-spacing:.1em; color:rgba(242,216,168,.55); }

/* 幕题 */
#md-act { position:fixed; top:16vh; left:0; right:0; z-index:30; text-align:center; pointer-events:none; opacity:0;
  transition:opacity .9s ease; }
#md-act.show{ opacity:1; }
#md-act span{ display:inline-block; padding:10px 38px; font-size:clamp(26px,4.2vw,44px); letter-spacing:.35em;
  text-indent:.35em; color:var(--paper); text-shadow:0 0 26px rgba(217,138,60,.6),0 2px 6px rgba(0,0,0,.8);
  border-top:1px solid rgba(217,160,63,.5); border-bottom:1px solid rgba(217,160,63,.5);
  background:linear-gradient(90deg,transparent,rgba(22,10,16,.72) 18%,rgba(22,10,16,.72) 82%,transparent); }

/* 字幕 */
#md-sub { position:fixed; left:50%; bottom:17vh; transform:translateX(-50%); z-index:35; max-width:min(720px,84vw);
  padding:12px 28px; text-align:center; font-size:clamp(17px,2.4vw,24px); letter-spacing:.12em; line-height:1.7;
  color:var(--paper); text-shadow:0 0 14px rgba(217,138,60,.55),0 2px 6px rgba(0,0,0,.85);
  background:linear-gradient(90deg,transparent,rgba(14,6,10,.72) 14%,rgba(14,6,10,.72) 86%,transparent);
  border-top:1px solid rgba(217,160,63,.35); border-bottom:1px solid rgba(217,160,63,.35); animation:mdSubIn .4s ease; }
#md-sub.hidden{ display:none; }
#md-sub .who{ display:block; margin-bottom:4px; font-size:.62em; letter-spacing:.3em; color:var(--gold-bright); }
@keyframes mdSubIn{ from{opacity:0;transform:translate(-50%,10px)} to{opacity:1;transform:translate(-50%,0)} }

/* 累积声音（敲门台词叠加） */
#md-voices { position:fixed; left:50%; top:22vh; transform:translateX(-50%); z-index:34;
  display:flex; flex-direction:column; align-items:center; gap:16px; pointer-events:none; }
#md-voices.hidden{ display:none; }
.voice-line { font-family:var(--song); font-size:clamp(22px,2.6vw,32px); letter-spacing:.16em; line-height:1.6;
  color:rgba(242,216,168,.7); text-shadow:0 0 12px rgba(217,138,60,.4),0 2px 6px rgba(0,0,0,.8);
  animation:voiceIn .5s ease; opacity:0; padding:2px 20px; }
.voice-line.show{ opacity:1; }
.voice-line.intensify{ color:var(--paper); text-shadow:0 0 16px rgba(217,138,60,.7); }
.voice-line.shatter{ animation:voiceShatter .7s ease forwards; }
@keyframes voiceIn{ from{opacity:0;transform:translateY(8px) scale(.96)} to{opacity:.85;transform:translateY(0) scale(1)} }
/* 大字幕（画面上空，非对话框，方正小标宋 ~48px） */
#md-display { position:fixed; left:50%; top:10vh; transform:translateX(-50%); z-index:36; max-width:min(820px,90vw);
  padding:16px 40px; text-align:center; font-family:var(--song); font-size:clamp(32px,4vw,48px); letter-spacing:.2em;
  line-height:1.6; color:var(--paper); text-shadow:0 0 20px rgba(217,138,60,.6),0 4px 10px rgba(0,0,0,.85);
  background:linear-gradient(90deg,transparent,rgba(14,6,10,.68) 16%,rgba(14,6,10,.68) 84%,transparent);
  border-top:1px solid rgba(217,160,63,.4); border-bottom:1px solid rgba(217,160,63,.4);
  animation:mdDispIn .8s ease; pointer-events:none; }
#md-display.hidden{ display:none; }
@keyframes mdDispIn{ from{opacity:0;transform:translate(-50%,-16px) scale(.96)} to{opacity:1;transform:translate(-50%,0) scale(1)} }

@keyframes voiceShatter{
  0%{opacity:1;filter:blur(0)}
  30%{transform:translate(4px,-3px) skewX(-4deg);filter:blur(1px)}
  60%{opacity:.6;filter:blur(2px)}
  100%{opacity:0;transform:translate(-30px,20px) scale(.7);filter:blur(4px)}
}

/* 点击进入游戏提示 */
#md-click-prompt { position:fixed; left:50%; bottom:14vh; transform:translateX(-50%); z-index:38;
  padding:16px 40px; text-align:center; font-family:var(--song); font-size:clamp(20px,2.4vw,28px);
  letter-spacing:.2em; color:var(--gold-bright); cursor:pointer;
  background:linear-gradient(180deg,rgba(28,12,18,.9),rgba(14,6,10,.94));
  border:1px solid var(--gold); border-radius:6px;
  box-shadow:0 0 24px rgba(217,138,60,.3),0 8px 30px rgba(0,0,0,.5);
  animation:promptPulse 2s ease-in-out infinite; transition:transform .2s; }
#md-click-prompt:hover { transform:translateX(-50%) translateY(-3px); }
#md-click-prompt.hidden { display:none; }
@keyframes promptPulse { 0%,100%{box-shadow:0 0 24px rgba(217,138,60,.3),0 8px 30px rgba(0,0,0,.5)} 50%{box-shadow:0 0 40px rgba(217,138,60,.5),0 8px 30px rgba(0,0,0,.5)} }



/* 门暖光 + 震动 */
#md-door { position:absolute; bottom:9%; left:38%; width:9%; height:64%; z-index:6;
  background:radial-gradient(ellipse 60% 80% at 50% 45%, rgba(245,201,107,.55), rgba(245,201,107,0) 70%);
  opacity:0; transition:opacity 1.1s ease; pointer-events:none; filter:blur(2px); mix-blend-mode:screen; }
#md-door.lit{ opacity:1; }
#md-door.knocking{ animation:doorShake .25s ease; }
#md-door.flood{ opacity:1; animation:doorFlood 1.2s ease forwards; }
#md-door.hidden{ display:none; }
@keyframes doorShake{ 0%,100%{transform:translateX(0)} 25%{transform:translateX(-3px)} 50%{transform:translateX(3px)} 75%{transform:translateX(-2px)} }
@keyframes doorFlood{ from{opacity:.6} to{opacity:0} }

/* 镜子 */
#md-mirror { position:absolute; bottom:9%; left:89%; height:46%; aspect-ratio:466/626; transform:translateX(-50%) translateY(-27%); z-index:4;
  transition:opacity 1.2s ease; }
#md-mirror.hidden{ display:none; }
.mirror-img{ width:100%; height:100%; display:block; object-fit:contain;
  filter:drop-shadow(0 6px 28px rgba(0,0,0,.55)) drop-shadow(0 0 14px rgba(217,138,60,.3)); transition:filter .5s ease; }
.mirror-frags{ position:absolute; inset:-10% -40%; pointer-events:none; }
.frag{ position:absolute; font-family:var(--serif); font-size:clamp(14px,1.2vw,20px); letter-spacing:.2em; text-indent:.2em; color:var(--paper);
  padding:6px 18px; border-radius:4px; background:linear-gradient(180deg,rgba(217,138,60,.85),rgba(180,100,40,.85));
  border:1px solid var(--gold-bright); box-shadow:0 0 16px rgba(240,192,96,.7); opacity:0; transform:scale(.6);
  transition:opacity .8s ease,transform .8s ease,left .8s ease,top .8s ease; }
.frag-hands{ left:0; top:30%; }
.frag-feet{ right:0; top:60%; }
.frag-torso{ left:50%; top:45%; transform:translate(-50%,-50%) scale(0); }
#md-mirror.blurred .mirror-img{ filter:blur(4px) brightness(.7); }
#md-mirror.assembling .frag-hands{ opacity:1; transform:scale(1); left:35%; top:38%; }
#md-mirror.filled-hands .frag-hands{ opacity:1; transform:scale(1); left:35%; top:38%; }
#md-mirror.filled-feet .frag-feet{ opacity:1; transform:scale(1); right:35%; top:55%; }
#md-mirror.filled-torso .frag-torso{ opacity:1; transform:translate(-50%,-50%) scale(1); }
.mirror-silhouette { position:absolute; inset:0; pointer-events:none; opacity:0; transition:opacity .8s ease; }
.mirror-shadow-glow{ position:absolute; left:50%; top:45%; width:60%; height:40%; transform:translate(-50%,-50%);
  background:radial-gradient(ellipse 50% 50% at 50% 50%, rgba(240,192,96,.5), rgba(240,192,96,0) 70%);
  opacity:0; transition:opacity 1.2s ease; pointer-events:none; border-radius:50%; }
#md-mirror.filled-torso .mirror-shadow-glow{ opacity:1; animation:shadowPulse 2s ease-in-out infinite; }
@keyframes shadowPulse{ 0%,100%{opacity:.4} 50%{opacity:.9} }
#md-mirror.assembling .mirror-silhouette{ opacity:.85; }

/* 奖励 */
#md-reward { position:fixed; inset:0; z-index:70; display:flex; align-items:center; justify-content:center;
  pointer-events:none; animation:mdFadeIn .5s ease; }
#md-reward.hidden{ display:none; }
.md-reward-card{ width:min(440px,86vw); padding:34px 30px 28px; text-align:center; color:var(--paper);
  background:linear-gradient(180deg,rgba(28,12,18,.94),rgba(14,6,10,.97)); border:1px solid rgba(217,160,63,.45);
  border-top:2px solid var(--gold); border-bottom:2px solid var(--gold);
  box-shadow:0 0 50px rgba(217,138,60,.25),0 18px 50px rgba(0,0,0,.6); animation:mdPop .6s cubic-bezier(.2,.9,.3,1.2); }
@keyframes mdPop{ from{opacity:0;transform:scale(.88)} to{opacity:1;transform:scale(1)} }
.md-shard{ width:76px; height:100px; margin:0 auto 18px;
  background:radial-gradient(circle at 40% 30%,var(--gold-bright),var(--ember) 60%,var(--lacquer));
  clip-path:polygon(50% 0,100% 35%,80% 100%,20% 100%,0 35%); box-shadow:0 0 30px rgba(240,192,96,.6);
  animation:mdGlow 2.4s ease-in-out infinite; }
@keyframes mdGlow{ 0%,100%{filter:brightness(1)} 50%{filter:brightness(1.35)} }
.md-reward-card h2{ font-size:clamp(20px,2.6vw,26px); letter-spacing:.16em; color:var(--gold-bright); }
.md-reward-card p{ margin:10px 0 0; font-size:clamp(14px,1.8vw,17px); line-height:1.7; letter-spacing:.06em;
  color:rgba(242,216,168,.85); }

/* 水波 */
#md-ripple{ position:fixed; inset:0; z-index:65; pointer-events:none;
  background:radial-gradient(circle at 50% 60%,rgba(217,160,63,.5) 0 2px,transparent 3px),
    radial-gradient(circle at 50% 60%,rgba(217,160,63,.35) 0 40px,transparent 42px),
    radial-gradient(circle at 50% 60%,rgba(217,138,60,.25) 0 120px,transparent 122px),rgba(8,4,6,0);
  animation:mdRipple 2.4s ease forwards; }
#md-ripple.hidden{ display:none; }
@keyframes mdRipple{ 0%{opacity:0;transform:scale(.2)} 30%{opacity:1}
  100%{opacity:0;transform:scale(2.4);background-color:rgba(8,4,6,.85)} }

/* 结算 */
#md-finale .md-finale-card{ width:min(500px,88vw); padding:36px 32px 30px; text-align:center; color:var(--paper);
  background:linear-gradient(180deg,rgba(28,12,18,.95),rgba(14,6,10,.98)); border:1px solid rgba(217,160,63,.45);
  border-top:2px solid var(--gold); border-bottom:2px solid var(--gold);
  box-shadow:0 0 50px rgba(217,138,60,.3),0 20px 60px rgba(0,0,0,.65); animation:mdPop .6s cubic-bezier(.2,.9,.3,1.2); }
.md-finale-name{ font-size:clamp(24px,3.4vw,32px); letter-spacing:.24em; text-indent:.24em; color:var(--gold-bright);
  text-shadow:0 0 20px rgba(217,138,60,.5); }
.md-finale-type{ margin:12px 0 4px; font-size:clamp(16px,2.1vw,20px); letter-spacing:.2em; color:var(--ember); }
.md-finale-keys{ margin:6px 0 14px; font-size:clamp(14px,1.8vw,16px); letter-spacing:.16em; color:rgba(240,192,96,.85); }
.md-finale-text{ margin:0 0 24px; font-size:clamp(14px,1.8vw,16px); line-height:1.9; letter-spacing:.06em;
  color:rgba(242,216,168,.82); }
.md-finale-frags{ display:flex; gap:20px; justify-content:center; margin:0 auto 20px; }
.md-finale-frag{ width:52px; height:66px; clip-path:polygon(50% 0,100% 35%,80% 100%,20% 100%,0 35%);
  background:radial-gradient(circle at 40% 30%,var(--gold-bright),var(--ember) 60%,var(--lacquer));
  box-shadow:0 0 18px rgba(240,192,96,.5); display:flex; align-items:center; justify-content:center;
  font-size:11px; letter-spacing:.1em; color:#1a0a08; font-weight:bold; }
.md-finale-btns{ display:flex; gap:14px; justify-content:center; flex-wrap:wrap; }

/* 角色高亮辉光（杜丽娘说话时） */
#puppet-layer.glowing { filter:drop-shadow(0 16px 20px rgba(5,2,4,.5)) drop-shadow(0 0 18px rgba(240,192,96,.55)); }
`;

export class StoryStage {
  private stage: HTMLElement;
  private panorama: HTMLElement;
  private puppetLayer: HTMLElement;
  private puppet!: Puppet;
  private ready = false;

  private introEl: HTMLElement;
  private subtitleEl: HTMLElement;
  private voicesEl: HTMLElement;
  private displayEl: HTMLElement;
  private hintEl: HTMLElement;
  private rewardEl: HTMLElement;
  private rewardTitle: HTMLElement;
  private rewardDesc: HTMLElement;
  private mirrorEl: HTMLElement;
  private doorGlowEl: HTMLElement;
  private rippleEl: HTMLElement;
  private finaleEl: HTMLElement;
  private actEl: HTMLElement;
  private dimEl: HTMLElement;
  private layers: { el: HTMLElement; depth: number }[] = [];
  private finaleType: HTMLElement;
  private finaleKeys: HTMLElement;
  private finaleText: HTMLElement;
  private nftPanel: NftPanel | null = null;
  private clickPromptEl: HTMLElement | null = null;

  private state: GState = "intro";
  private timer = 0;
  private knockCount = 0;
  private knockStarted = false;
  private doorBlocked = false;
  private wasAtDoor = false;
  private knockTimer = 0;
  private talkIndex = 0;
  private act2Shown = false;
  private act3Shown = false;
  private fragmentHands = false;
  private fragmentFeet = false;
  private fragmentTorso = false;
  private assmHands = false;
  private assmFeet = false;

  private theatreEl: HTMLElement | null = null;
  private rhythmRoot: Root | null = null;

  private charX = CHAMBER.start;
  private facing = 1;
  private camX = 0;
  private camOff = CAM_FOLLOW;
  private keys = { left: false, right: false };
  private mx = 0; private my = 0; private tmx = 0; private tmy = 0;
  private running = false;

  constructor(stage: HTMLElement) {
    this.stage = stage;
    this.panorama = $$(".panorama", stage) || stage;
    this.puppetLayer = $$("#puppet-layer", stage) || stage;
    this.dimEl = $$("#stage-dim") || stage;
    this.hintEl = $$("#hint") || (() => { const d = document.createElement("div"); d.id = "hint"; document.body.appendChild(d); return d; })();

    const styleEl = document.createElement("style");
    styleEl.id = "mudan-ui-style";
    styleEl.textContent = UI_STYLE;
    document.head.appendChild(styleEl);

    this.actEl = this.inject('<div id="md-act" class="hidden"><span></span></div>');
    this.subtitleEl = this.inject('<div id="md-sub" class="hidden"></div>');
    this.displayEl = this.inject('<div id="md-display" class="hidden"></div>');
    this.voicesEl = this.inject('<div id="md-voices" class="hidden"></div>');
    this.rewardEl = this.inject('<div id="md-reward" class="hidden"><div class="md-reward-card"><div class="md-shard"></div><h2></h2><p></p></div></div>');
    this.rewardTitle = this.rewardEl.querySelector("h2")!;
    this.rewardDesc = this.rewardEl.querySelector("p")!;
    this.rippleEl = this.inject('<div id="md-ripple" class="hidden" aria-hidden="true"></div>');
    this.finaleEl = this.inject('<div id="md-finale" class="mudan-overlay hidden"><div class="md-finale-card"><h2 class="md-finale-name">你的杜丽娘</h2><p class="md-finale-type"></p><p class="md-finale-keys"></p><p class="md-finale-text"></p><div class="md-finale-frags"><div class="md-finale-frag">双手</div><div class="md-finale-frag">双脚</div><div class="md-finale-frag">躯干</div></div><div class="md-finale-btns"><button class="md-btn md-primary" type="button">重新体验</button><button class="md-btn md-ghost" type="button">结束体验</button><button class="md-btn md-ghost" id="md-nft-btn" type="button">铸造 NFT</button></div></div></div>');
    this.finaleType = this.finaleEl.querySelector(".md-finale-type")!;
    this.finaleKeys = this.finaleEl.querySelector(".md-finale-keys")!;
    this.finaleText = this.finaleEl.querySelector(".md-finale-text")!;
    this.introEl = this.inject('<div id="md-intro" class="mudan-overlay"><div class="md-card"><h1 class="md-title">梦入牡丹亭</h1><p class="md-sub">寻回杜丽娘</p><ul class="md-controls"><li><span class="md-ctl-keys"><kbd>&larr;</kbd><kbd>&rarr;</kbd></span><span>左右移动，走到目标即可</span></li></ul><p class="md-note">剧情会自动展开，无需按键。</p><button class="md-btn md-primary" type="button">开始体验</button></div></div>');

    this.doorGlowEl = this.inject('<div id="md-door" class="hidden" aria-hidden="true"></div>', this.panorama);
    this.mirrorEl = this.inject('<div id="md-mirror"><img class="mirror-img" src="/mirror/mirror.png" alt="" /><svg class="mirror-silhouette" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid meet"><g fill="none" stroke="rgba(240,192,96,.6)" stroke-width="1"><circle cx="50" cy="20" r="12"/><path d="M50 32 L50 80 M50 48 L30 58 M50 48 L70 58 M50 80 L38 120 M50 80 L62 120"/></g></svg><div class="mirror-shadow-glow"></div><div class="mirror-frags"><span class="frag frag-hands">双手</span><span class="frag frag-feet">双脚</span><span class="frag frag-torso">躯干</span></div></div>', this.panorama);

    for (const layer of this.panorama.querySelectorAll<HTMLElement>(".layer")) {
      this.layers.push({ el: layer, depth: parseFloat(layer.dataset.depth || "0.03") });
    }

    this.bindParallax();
    this.bindInput();
  }

  private inject(html: string, parent: HTMLElement = document.body): HTMLElement {
    const wrap = document.createElement("template");
    wrap.innerHTML = html.trim();
    const node = wrap.content.firstElementChild as HTMLElement;
    parent.appendChild(node);
    return node;
  }

  async initPuppet() {
    this.puppet = new Puppet(this.puppetLayer);
    await this.puppet.load();
    await this.initScenes();
    this.ready = true;
    this.charX = CHAMBER.start;
    this.camX = clamp(this.charX - CAM_FOLLOW, 0, SCROLL_MAX);
    this.facing = 1;
    this.applyCamera();
    this.puppet.setState("idle");
  }
  private bindParallax() {
    const onMove = (cx: number, cy: number) => {
      this.tmx = (cx / window.innerWidth) * 2 - 1;
      this.tmy = (cy / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", (e) => onMove(e.clientX, e.clientY));
    window.addEventListener("touchmove", (e) => {
      if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
  }

  private bindInput() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      switch (e.code) {
        case "ArrowLeft": case "KeyA": this.keys.left = true; e.preventDefault(); break;
        case "ArrowRight": case "KeyD": this.keys.right = true; e.preventDefault(); break;
      }
    });
    window.addEventListener("keyup", (e) => {
      switch (e.code) {
        case "ArrowLeft": case "KeyA": this.keys.left = false; break;
        case "ArrowRight": case "KeyD": this.keys.right = false; break;
      }
    });
    this.stage.addEventListener("pointerdown", (e) => {
      const rel = e.clientX / window.innerWidth;
      if (rel < 0.5) { this.keys.left = true; this.keys.right = false; }
      else { this.keys.right = true; this.keys.left = false; }
    });
    const release = () => { this.keys.left = false; this.keys.right = false; };
    this.stage.addEventListener("pointerup", release);
    this.stage.addEventListener("pointerleave", release);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", () => { if (document.hidden) release(); });

    this.introEl.querySelector("button")!.addEventListener("click", () => this.beginGame());
    this.finaleEl.querySelectorAll("button")[0].addEventListener("click", () => this.replay());
    this.finaleEl.querySelectorAll("button")[1].addEventListener("click", () => this.endExperience());
    const nftBtn = this.finaleEl.querySelector("#md-nft-btn");
    if (nftBtn) nftBtn.addEventListener("click", () => {
      if (!this.nftPanel) this.nftPanel = new NftPanel();
      this.nftPanel.show();
    });
  }

  private beginGame() {
    if (!this.ready) return;
    ensureAudio();
    this.introEl.classList.add("hidden");
    this.dimEl.classList.add("lit");
    fx.setAmbient("dust");
    this.actTitle("第一幕 · 幽闭闺房");
    this.enter("approach");
    this.showHint(true, 5000);
  }

  private showHint(show: boolean, autoHideMs = 0) {
    if (show) {
      this.hintEl.classList.remove("hidden");
      if (autoHideMs) setTimeout(() => this.hintEl.classList.add("hidden"), autoHideMs);
    } else this.hintEl.classList.add("hidden");
  }

  private say(text: string, who?: string) {
    const whoHtml = who ? '<span class="who">' + who + "</span>" : "";
    this.subtitleEl.innerHTML = whoHtml + text;
    this.subtitleEl.classList.remove("hidden");
    this.voicesEl.classList.add("hidden");
  }
  private clearSay() { this.subtitleEl.classList.add("hidden"); }
  private setDisplay(text: string) {
    this.displayEl.textContent = text;
    this.displayEl.classList.remove("hidden");
    this.subtitleEl.classList.add("hidden");
    this.voicesEl.classList.add("hidden");
  }
  private clearDisplay() { this.displayEl.classList.add("hidden"); }

  private addVoice(text: string) {
    this.subtitleEl.classList.add("hidden");
    this.voicesEl.classList.remove("hidden");
    // 只保留当前这一句，替换上一句（不叠加堆积）
    this.voicesEl.innerHTML = "";
    const line = document.createElement("div");
    line.className = "voice-line";
    line.textContent = text;
    this.voicesEl.appendChild(line);
    requestAnimationFrame(() => line.classList.add("show"));
  }
  private showAllVoices() {
    this.subtitleEl.classList.add("hidden");
    this.voicesEl.classList.remove("hidden");
    this.voicesEl.innerHTML = "";
    for (const text of KNOCK_LINES) {
      const line = document.createElement("div");
      line.className = "voice-line show";
      line.textContent = text;
      this.voicesEl.appendChild(line);
    }
  }
  private intensifyVoices() {
    this.voicesEl.querySelectorAll(".voice-line").forEach((l) => l.classList.add("intensify"));
  }
  private shatterVoices() {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight * 0.28;
    fx.shatter(cx, cy, 50, 380);
    this.voicesEl.querySelectorAll(".voice-line").forEach((l) => l.classList.add("shatter"));
    setTimeout(() => this.voicesEl.classList.add("hidden"), 800);
  }
  private clearVoices() {
    this.voicesEl.innerHTML = "";
    this.voicesEl.classList.add("hidden");
  }

  private actTitle(title: string) {
    const span = this.actEl.querySelector("span")!;
    span.textContent = title;
    this.actEl.classList.remove("hidden");
    requestAnimationFrame(() => this.actEl.classList.add("show"));
    setTimeout(() => {
      this.actEl.classList.remove("show");
      setTimeout(() => this.actEl.classList.add("hidden"), 900);
    }, 2400);
  }

  private showReward(title: string, desc: string) {
    this.rewardTitle.textContent = title;
    this.rewardDesc.textContent = desc;
    this.rewardEl.classList.remove("hidden");
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    fx.burst(cx, cy, 60, 44);
    chimeSound();
  }
  private hideReward() { this.rewardEl.classList.add("hidden"); }

  private doorScreenPos(): { x: number; y: number } {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      x: (CHAMBER.door - this.camX) * vw,
      y: vh * 0.55,
    };
  }

  private doKnock(idx: number) {
    const pos = this.doorScreenPos();
    fx.knock(pos.x, pos.y, 1 + idx * 0.3);
    this.doorGlowEl.classList.remove("knocking");
    void this.doorGlowEl.offsetWidth;
    this.doorGlowEl.classList.add("knocking");
    knockSound();
    // 停止上一段，播放当前台词对应的真实音频（循环）
    stopAllVoices();
    playKnockVoice(idx);
    this.addVoice(KNOCK_LINES[idx]);
  }

  private showClickPrompt() {
    if (this.clickPromptEl) this.clickPromptEl.remove();
    this.clickPromptEl = this.inject('<div id="md-click-prompt">点击进入游戏</div>');
    this.clickPromptEl.addEventListener("click", () => {
      this.hideClickPrompt();
      this.ensureTheatre();
    });
  }
  private hideClickPrompt() {
    if (this.clickPromptEl) { this.clickPromptEl.remove(); this.clickPromptEl = null; }
  }

  private puppetGlow(on: boolean) {
    if (on) this.puppetLayer.classList.add("glowing");
    else this.puppetLayer.classList.remove("glowing");
  }
  private enter(s: GState) {
    this.state = s;
    this.timer = 0;
    switch (s) {
      case "approach":
        this.setDisplay("向右走去");
        break;
      case "leaveText":
        this.clearSay();
        stopAllVoices();
        this.setDisplay("不到园林，怎知春色如许");
        this.puppet?.setState("idle");
        break;
      case "rewardHands":
        this.fragmentHands = true;
        this.showReward("获得：杜丽娘 · 双手", "点亮编织自我人生的能力。");
        break;
      case "freeRoam":
        this.hideReward();
        fx.setAmbient("dust");
        this.say("穿过屏柱，前方似有戏台……");
        break;
      case "rhythm":
        this.clearSay();
        break;
      case "gardenTalk":
        this.clearSay();
        this.talkIndex = 0;
        this.say(GARDEN_TALK[0].text, GARDEN_TALK[0].who);
        this.puppetGlow(GARDEN_TALK[0].who === "杜丽娘");
        this.puppet?.setState(GARDEN_TALK[0].anim || "idle");
        this.talkIndex = 1;
        break;
      case "talkEnd":
        this.clearSay();
        this.showClickPrompt();
        break;
      case "rewardFeet":
        this.fragmentFeet = true;
        this.puppetGlow(false);
        this.clearSay();
        this.showReward("获得：杜丽娘 · 双脚", "拥有选择方向的自由。");
        break;
      case "toMirror":
        this.hideReward();
        this.mirrorEl.classList.remove("blurred", "filled-hands", "filled-feet", "filled-torso", "assembling");
        this.say("镜中似有人影，走近看看。", "花园");
        break;
      case "assemble":
        this.clearSay();
        this.mirrorEl.classList.add("blurred", "assembling");
        this.say(ASSEMBLE_LINES.start.text, ASSEMBLE_LINES.start.who);
        break;
      case "rewardTorso":
        this.fragmentTorso = true;
        this.clearSay();
        this.showReward("获得：杜丽娘 · 躯干", "你的影子，终成了她自己。");
        break;
      case "finale":
        this.startFinale();
        break;
    }
  }

  private ensureTheatre() {
    if (this.theatreEl) return;
    const wrap = document.createElement("div");
    wrap.id = "rhythm-stage";
    wrap.style.cssText = "position:fixed;inset:0;z-index:40;opacity:1;";
    document.body.appendChild(wrap);
    this.theatreEl = wrap;
    this.enter("rhythm");
    this.rhythmRoot = mountRhythm(wrap, {
      onFinish: () => {
        this.hideTheatre();
        this.enter("rewardFeet");
      },
    });
    this.charX = THEATRE.center;
  }

  private hideTheatre() {
    const el = this.theatreEl;
    if (el) {
      el.style.opacity = "0";
      window.setTimeout(() => {
        unmountRhythm(this.rhythmRoot);
        this.rhythmRoot = null;
        el.remove();
        this.theatreEl = null;
      }, 300);
    }
    this.charX = THEATRE.exit;
    this.facing = 1;
  }

  private playRipple() {
    this.rippleEl.classList.remove("hidden");
    this.rippleEl.style.animation = "none";
    void this.rippleEl.offsetWidth;
    this.rippleEl.style.animation = "";
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight * 0.6;
    fx.ripple(cx, cy);
    window.setTimeout(() => {
      this.rippleEl.classList.add("hidden");
      this.enter("finale");
    }, 2400);
  }

  private startFinale() {
    this.hideReward();
    this.finaleEl.classList.remove("hidden");
    this.puppet?.setState("hi");
    this.puppetGlow(true);
    fx.burst(window.innerWidth / 2, window.innerHeight / 2, 80, 44);
    chimeSound();
    this.finaleType.textContent = "你是镜中杜丽娘";
    this.finaleKeys.textContent = "寻回 · 觉醒 · 自由";
    this.finaleText.textContent = "双手织梦，双脚择路，躯干里盛着看客的影子。你寻回的杜丽娘，从来都住在你自己身上。";
  }

  private replay() {
    this.finaleEl.classList.add("hidden");
    this.clearSay();
    this.clearVoices();
    this.puppetGlow(false);
    this.mirrorEl.classList.remove("filled-hands", "filled-feet", "filled-torso", "blurred", "assembling");
    this.doorGlowEl.classList.remove("lit", "knocking", "flood");
    this.doorGlowEl.classList.add("hidden");
    this.fragmentHands = this.fragmentFeet = this.fragmentTorso = false;
    this.assmHands = this.assmFeet = false;
    this.knockCount = 0;
    this.knockStarted = false;
    this.doorBlocked = false;
    this.wasAtDoor = false;
    stopAllVoices();
    this.knockTimer = 0;
    this.talkIndex = 0;
    this.act2Shown = false;
    this.hideClickPrompt();
    this.act3Shown = false;
    this.running = false;
    if (this.theatreEl) {
      unmountRhythm(this.rhythmRoot);
      this.rhythmRoot = null;
      this.theatreEl.remove();
      this.theatreEl = null;
    }
    this.charX = CHAMBER.start;
    this.facing = 1;
    fx.setAmbient("dust");
    this.actTitle("第一幕 · 幽闭闺房");
    this.enter("approach");
  }

  private endExperience() {
    this.finaleEl.classList.add("hidden");
    this.puppetGlow(false);
    this.dimEl.classList.remove("lit");
    this.clearSay();
    this.clearVoices();
    fx.setAmbient("none");
    this.say("幕落。");
  }
  update(dt: number) {
    this.mx += (this.tmx - this.mx) * 0.06;
    this.my += (this.tmy - this.my) * 0.06;

    const inTheatre = this.state === "rhythm";
    if (!inTheatre) {
      this.handleMove(dt);
      this.tickState(dt);
      const camTarget = this.state === "gardenTalk" ? 0.78 : CAM_FOLLOW;
      this.camOff += (camTarget - this.camOff) * Math.min(1, dt * 3);
      const targetCam = clamp(this.charX - this.camOff, 0, SCROLL_MAX);
      this.camX += (targetCam - this.camX) * Math.min(1, dt * 6);
      this.applyCamera();
      if (this.puppet) {
        this.puppet.setFacing(this.facing);
        this.puppet.render();
      }
    } else {
      this.tickState(dt);
      if (this.theatreEl) {
        const targetCam = clamp(THEATRE.center - CAM_FOLLOW, 0, SCROLL_MAX);
        this.camX += (targetCam - this.camX) * Math.min(1, dt * 6);
        this.applyCamera();
      }
    }
  }

  private handleMove(dt: number) {
    if (this.running) {
      this.charX += RUN_SPEED * dt;
      this.charX = clamp(this.charX, WORLD_LEFT, WORLD_RIGHT);
      this.puppet?.setState("run");
      this.puppet?.setMoveRate(RUN_SPEED);
      return;
    }
    const noMove: string[] = ["leaveText","rewardHands","gardenTalk","talkEnd","rewardFeet","assemble","rewardTorso","finale"];
    if (noMove.includes(this.state)) { this.puppet?.setState("idle"); return; }
    let dir = 0;
    if (this.keys.right) dir += 1;
    if (this.keys.left) dir -= 1;
    if (dir !== 0) {
      this.facing = dir;
      this.charX += dir * WALK_SPEED * dt;
      const rightLimit = this.doorBlocked ? CHAMBER.door - DOOR_ZONE * 0.5 : WORLD_RIGHT;
      this.charX = clamp(this.charX, WORLD_LEFT, rightLimit);
      this.puppet?.setState("walk");
      this.puppet?.setMoveRate(WALK_SPEED);
    } else {
      this.puppet?.setState("idle");
    }
  }

  private tickState(dt: number) {
    switch (this.state) {
      case "approach": {
        const atDoor = Math.abs(this.charX - CHAMBER.door) <= DOOR_ZONE;
        // 撞门：从"不在门口"变为"在门口"的那一刻才算一次撞击
        if (atDoor && !this.wasAtDoor) {
          if (!this.knockStarted) {
            // 第一次撞门
            this.knockStarted = true;
            this.doorBlocked = true;
            this.knockCount = 0;
            this.doKnock(0);
            this.knockCount = 1;
            this.showHint(false);
          } else if (this.knockCount === 1) {
            // 第二次
            this.doKnock(1);
            this.knockCount = 2;
          } else if (this.knockCount === 2) {
            // 第三次
            this.doKnock(2);
            this.knockCount = 3;
          } else if (this.knockCount === 3) {
            // 第四次：三声叠加爆发，震碎文字，门打开，角色通过
            this.knockCount = 4;
            stopAllVoices();
            this.showAllVoices();
            this.intensifyVoices();
            const pos = this.doorScreenPos();
            fx.knock(pos.x, pos.y, 3);
            fx.lightShaft(pos.x, pos.y);
            fx.burst(pos.x, pos.y, 50, 44);
            knockSound();
            setTimeout(() => knockSound(), 120);
            setTimeout(() => knockSound(), 280);
            setTimeout(() => this.shatterVoices(), 600);
            this.doorGlowEl.classList.remove("hidden");
            this.doorGlowEl.classList.add("lit", "flood");
            window.setTimeout(() => this.enter("leaveText"), 1800);
          }
        }
        this.wasAtDoor = atDoor;
        break;
      }
      case "leaveText": {
        this.timer += dt;
        if (this.timer >= LEAVE_TEXT_HOLD) {
          this.clearDisplay();
          stopAllVoices();
          this.doorBlocked = false;
          this.running = true;
          this.facing = 1;
          this.timer = 0;
          this.enter("rewardHands");
        }
        break;
      }
      case "rewardHands": {
        if (this.running) {
          if (this.charX >= CHAMBER.right) {
            this.running = false;
          }
        }
        this.timer += dt;
        if (this.timer >= REWARD_HOLD && !this.running) this.enter("freeRoam");
        break;
      }
      case "freeRoam": {
        if (!this.act2Shown && this.charX > SEAM1) {
          this.act2Shown = true;
          this.actTitle("第二幕 · 戏台");
        }
        if (this.charX >= THEATRE.center - TALK_ZONE) this.enter("gardenTalk");
        break;
      }
      case "rhythm": break;
      case "gardenTalk": {
        this.timer += dt;
        if (this.talkIndex < GARDEN_TALK.length && this.timer >= TALK_INTERVAL) {
          this.timer = 0;
          const line = GARDEN_TALK[this.talkIndex];
          this.say(line.text, line.who);
          this.puppetGlow(line.who === "杜丽娘");
          this.puppet?.setState(line.anim || "idle");
          this.talkIndex++;
        } else if (this.talkIndex >= GARDEN_TALK.length && this.timer >= TALK_INTERVAL) {
          this.enter("talkEnd");
        }
        break;
      }
      case "talkEnd": break;
      case "rewardFeet": {
        this.timer += dt;
        if (this.timer >= REWARD_HOLD) this.enter("toMirror");
        break;
      }
      case "toMirror": {
        if (!this.act3Shown && this.charX > SEAM2) {
          this.act3Shown = true;
          this.actTitle("第三幕 · 花园");
        }
        if (Math.abs(this.charX - GARDEN.mirror) <= MIRROR_ZONE) this.enter("assemble");
        break;
      }
      case "assemble": {
        this.timer += dt;
        if (this.timer >= 1.2 && !this.assmHands) {
          this.assmHands = true;
          this.mirrorEl.classList.add("filled-hands");
          fx.burst(window.innerWidth * 0.78, window.innerHeight * 0.42, 30, 44);
          chimeSound();
        } else if (this.timer >= 2.4 && !this.assmFeet) {
          this.assmFeet = true;
          this.mirrorEl.classList.add("filled-feet");
          this.say(ASSEMBLE_LINES.placed.text, ASSEMBLE_LINES.placed.who);
          fx.burst(window.innerWidth * 0.78, window.innerHeight * 0.52, 30, 44);
          chimeSound();
        } else if (this.timer >= 4.6 && this.mirrorEl.classList.contains("blurred")) {
          this.mirrorEl.classList.remove("blurred");
          this.say(ASSEMBLE_LINES.missing.text, ASSEMBLE_LINES.missing.who);
        } else if (this.timer >= 6.8 && !this.fragmentTorso) {
          this.fragmentTorso = true;
          this.mirrorEl.classList.add("filled-torso");
          this.say(ASSEMBLE_LINES.shadow.text, ASSEMBLE_LINES.shadow.who);
          fx.burst(window.innerWidth * 0.78, window.innerHeight * 0.45, 40, 44);
          chimeSound();
        } else if (this.timer >= 9.0) {
          this.enter("rewardTorso");
        }
        break;
      }
      case "rewardTorso": {
        this.timer += dt;
        if (this.timer >= REWARD_HOLD) { this.hideReward(); this.playRipple(); }
        break;
      }
    }
  }

  private applyCamera() {
    const vw = window.innerWidth;
    this.panorama.style.transform = "translate3d(" + (-this.camX * vw).toFixed(2) + "px,0,0)";
    this.puppetLayer.style.left = (this.charX * vw).toFixed(2) + "px";
    this.puppetLayer.style.transform = "translateX(-50%)";
    for (const { el, depth } of this.layers) {
      const ox = -this.mx * depth * 60;
      const oy = -this.my * depth * 40;
      el.style.transform = "translate3d(" + ox.toFixed(2) + "px," + oy.toFixed(2) + "px,0)";
    }
  }

  private async initScenes() {
    const halves = this.panorama.querySelectorAll<HTMLElement>("[data-chroma]");
    await Promise.all(Array.from(halves).map((half) => this.chromaKeyLayer(half)));
  }

  private async chromaKeyLayer(half: HTMLElement) {
    const src = half.dataset.chroma;
    if (!src) return;
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      let a = d[i + 3];
      if (g >= 240 && r < 50 && b < 50) a = 0;
      else if (g >= 214 && r < 50 && b < 50) a = (a * (240 - g)) / 26;
      d[i + 3] = a;
    }
    ctx.putImageData(id, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) half.style.backgroundImage = 'url("' + URL.createObjectURL(blob) + '")';
  }
}
