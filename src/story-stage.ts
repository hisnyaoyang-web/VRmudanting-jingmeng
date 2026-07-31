import { Puppet, type PuppetState } from "./puppet";
import { mountRhythm, unmountRhythm, type Root } from "./rhythm/rhythm-mount";
import { fx } from "./effects";

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
const REWARD_HOLD = 4.0;
const LEAVE_TEXT_HOLD = 10.0;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T | null;
type NftPanel = import("./nft-panel").NftPanel;

type GState =
  | "intro" | "approach" | "rewardHands" | "freeRoam"
  | "rhythm"
  | "gardenTalk" | "talkEnd" | "rewardFeet" | "toMirror" | "assemble" | "rewardTorso"
  | "finale";

const KNOCK_LINES = [
  { zh: "女子无才便是德。", en: "Ignorance is a woman's virtue." },
  { zh: "不孝有三无后为大。", en: "No heir is the greatest impiety." },
  { zh: "三从四德，这个是女子的本分。", en: "Three obediences, four virtues." },
];

type DialogueLine = { who: string; whoEn: string; text: string; en: string; anim?: PuppetState };

const GARDEN_TALK: DialogueLine[] = [
  { who: "你", whoEn: "You", text: "你是谁？", en: "Who are you?" },
  { who: "杜丽娘", whoEn: "Du Liniang", text: "我是杜丽娘。", en: "I am Du Liniang.", anim: "hi" },
  { who: "你", whoEn: "You", text: "你是杜丽娘，那我是谁？", en: "If you are Du Liniang, then who am I?" },
];

const MIRROR_TALK: DialogueLine[] = [
  { who: "你", whoEn: "You", text: "我是谁？", en: "Who am I?" },
  { who: "镜子", whoEn: "The Mirror", text: "你是杜丽娘。", en: "You are Du Liniang." },
  { who: "你", whoEn: "You", text: "不，我不是杜丽娘。我是个看客罢了。", en: "No, I am not Du Liniang. I am merely a spectator." },
  { who: "镜子", whoEn: "The Mirror", text: "你道你是看客——可这镜里镜外，原分不清谁在看、谁被看。", en: "You call yourself a spectator — yet inside and outside this mirror, who can tell watcher from watched?" },
];

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
      a.onended = null;
      a.onerror = null;
      a.pause();
      a.currentTime = 0;
      a.removeAttribute("src");
      a.load();
    } catch {}
  }
  activeAudio.length = 0;
}
// 第二幕入园：「不到园林」念白（只播放一次，不循环，使用完整未剪辑版 mp3）
const GARDEN_QUOTE_SRC = "/audio/chamber/garden-quote.mp3";
let gardenQuoteAudio: HTMLAudioElement | null = null;
function playGardenQuote(onEnded?: () => void) {
  const audio = new Audio(GARDEN_QUOTE_SRC);
  audio.loop = false;
  audio.volume = 0.9;
  if (onEnded) {
    audio.addEventListener("ended", onEnded, { once: true });
  }
  audio.play().catch(() => {});
  activeAudio.push(audio);
  gardenQuoteAudio = audio;
}
// 完整未剪辑对白音频：花园 / 镜前（一段音频覆盖整段对白，字幕按时长比例呈现）
const GARDEN_VOICE_SRC = "/audio/chamber/garden-who-are-you.m4a";
const MIRROR_VOICE_SRC = "/audio/chamber/mirror-who-am-i.m4a";
// 终幕题词念白三句，结算页开场依次播放并逐句显示
const FINALE_VOICE_SRC = [
  "/audio/chamber/finale-line1.wav",
  "/audio/chamber/finale-line2.wav",
  "/audio/chamber/finale-line3.wav",
];
const FINALE_QUOTE = [
  { zh: "情不知所起，一往而深。", en: "Love, once begun, knows not where it starts — yet deepens ever on." },
  { zh: "生者可以死，死可以生。", en: "The living may die for love; the dead may live again for it." },
  { zh: "生而不可与死，死而不可复生者，皆非情之至也。", en: "To live without dying for it, or die without returning — neither is love supreme." },
];
// 播放单句对白音频；onended 在音频自然结束时触发，
// 播放失败时用 fallbackMs 兜底触发，保证剧情永远不会卡住
function playVoiceLine(src: string, onended?: () => void, fallbackMs = 5000) {
  const audio = new Audio(src);
  audio.loop = false;
  audio.volume = 0.9;
  activeAudio.push(audio);
  if (onended) {
    let fired = false;
    const finish = () => {
      if (fired) return;
      fired = true;
      onended();
    };
    audio.onended = finish;
    audio.onerror = finish;
    audio.play().catch(() => window.setTimeout(finish, fallbackMs));
  } else {
    audio.play().catch(() => {});
  }
}
// 预加载完整对白音频 + 终幕题词音频
[GARDEN_VOICE_SRC, MIRROR_VOICE_SRC, ...FINALE_VOICE_SRC].forEach((src) => {
  const a = new Audio();
  a.src = src;
  a.preload = "auto";
});
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

const UI_STYLE = `
/* ===== 梦入牡丹亭 · 精修覆盖层 ===== */
/* 大标题统一字体：方正小标宋（无此字体时回退宋体类） */
:root { --fzxbs: "FZXiaoBiaoSong-B05S","FZXiaoBiaoSong-B05","方正小标宋简体","方正小标宋_GBK","STZhongsong","华文中宋","SimSun",serif; }
.mudan-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse 80% 70% at 50% 45%, rgba(22,10,16,.88), rgba(5,2,6,.97)); animation: mdFadeIn .6s ease; }
.mudan-overlay.hidden { display: none !important; }
@keyframes mdFadeIn { from{opacity:0} to{opacity:1} }
@keyframes mdFadeOut { from{opacity:1} to{opacity:0} }

/* 开场：微信视频全屏背景 */
#md-intro { background:#050206; overflow:hidden; transition:opacity .9s ease; }
#md-intro.closing { opacity:0; }
.md-intro-video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover;
  filter:saturate(1.08) brightness(1.06) sepia(.18); }
.md-intro-shade { position:absolute; inset:0; pointer-events:none;
  background:
    radial-gradient(ellipse 90% 75% at 50% 42%, rgba(5,2,6,0) 30%, rgba(5,2,6,.62) 78%, rgba(5,2,6,.9)),
    linear-gradient(180deg, rgba(5,2,6,.55), rgba(5,2,6,.12) 30%, rgba(5,2,6,.12) 62%, rgba(5,2,6,.85)); }
.md-intro-frame { position:absolute; inset:18px; pointer-events:none;
  border:1px solid rgba(217,160,63,.35); box-shadow:inset 0 0 0 1px rgba(0,0,0,.5); }
.md-intro-frame::before, .md-intro-frame::after { content:""; position:absolute; width:24px; height:24px; }
.md-intro-frame::before { top:-1px; left:-1px; border-top:1px solid rgba(240,192,96,.95); border-left:1px solid rgba(240,192,96,.95); }
.md-intro-frame::after { bottom:-1px; right:-1px; border-bottom:1px solid rgba(240,192,96,.95); border-right:1px solid rgba(240,192,96,.95); }
.md-intro-content { position:relative; z-index:1; max-width:min(620px,88vw); text-align:center; color:var(--paper); }
.md-intro-content > * { animation:mdRise 1s cubic-bezier(.22,.7,.25,1) backwards; }
.md-intro-content > *:nth-child(2){ animation-delay:.14s; }
.md-intro-content > *:nth-child(3){ animation-delay:.28s; }
.md-intro-content > *:nth-child(4){ animation-delay:.48s; }
.md-intro-content > *:nth-child(5){ animation-delay:.58s; }
.md-intro-content > *:nth-child(6){ animation-delay:.72s; }
@keyframes mdRise { from { opacity:0; transform:translateY(22px); } }
.md-eyebrow { margin:0; display:flex; align-items:center; justify-content:center; gap:18px;
  font-size:clamp(12px,1.4vw,15px); letter-spacing:.62em; text-indent:.62em; color:rgba(242,216,168,.75);
  text-shadow:0 1px 6px rgba(0,0,0,.8); }
.md-eyebrow::before, .md-eyebrow::after { content:""; width:clamp(38px,7vw,84px); height:1px;
  background:linear-gradient(90deg, transparent, rgba(217,160,63,.65)); }
.md-eyebrow::after { transform:scaleX(-1); }
.md-title-row { display:flex; align-items:flex-start; justify-content:center; gap:clamp(10px,1.8vw,20px); }
.md-intro-content .md-title { margin:.1em 0 0; font-size:clamp(68px,11vw,124px); line-height:1.04;
  letter-spacing:.16em; text-indent:.16em; color:transparent; text-shadow:none;
  background:linear-gradient(180deg,#f9e6bc 8%,var(--gold-bright) 46%,#b07a2c 92%);
  -webkit-background-clip:text; background-clip:text;
  filter:drop-shadow(0 0 30px rgba(217,138,60,.4)) drop-shadow(0 5px 14px rgba(0,0,0,.85)); }
.md-seal { margin-top:.5em; padding:.5em .4em .44em; writing-mode:vertical-rl;
  font-family:var(--fzxbs); font-size:clamp(15px,2vw,23px); letter-spacing:.22em; line-height:1;
  color:#f7ecd4; background:linear-gradient(160deg,#b54133,#8c2317); border-radius:2px;
  box-shadow:0 3px 10px rgba(0,0,0,.55), inset 0 0 0 1px rgba(247,236,212,.4); transform:rotate(-3deg); }
.md-intro-content .md-title-sub { margin:clamp(10px,2vh,18px) 0 0; display:flex; align-items:center;
  justify-content:center; gap:16px; font-size:clamp(14px,1.8vw,19px); letter-spacing:.8em; text-indent:.8em;
  color:var(--gold); text-shadow:0 1px 6px rgba(0,0,0,.8); }
.md-title-sub::before, .md-title-sub::after { content:""; width:clamp(34px,6vw,70px); height:1px;
  background:linear-gradient(90deg, transparent, rgba(217,160,63,.6)); }
.md-title-sub::after { transform:scaleX(-1); }
.md-intro-hint { margin:clamp(30px,5.5vh,46px) 0 0; display:flex; align-items:center; justify-content:center;
  gap:12px; font-size:14px; letter-spacing:.14em; color:rgba(242,216,168,.85); text-shadow:0 1px 5px rgba(0,0,0,.8); }
.md-intro-hint .md-ctl-keys { min-width:0; }
.md-intro-content .md-note { margin:12px 0 26px; font-size:12.5px; letter-spacing:.28em; text-indent:.28em;
  color:rgba(242,216,168,.55); text-shadow:0 1px 4px rgba(0,0,0,.8); }
.md-intro-content .md-primary { padding:15px 54px; letter-spacing:.38em; text-indent:.38em; border-radius:2px; }
/* 英文小字翻译 */
.md-en { display:block; font-style:normal; font-size:clamp(9px,1.05vw,11px); letter-spacing:.3em; text-indent:.3em;
  text-transform:uppercase; color:rgba(242,216,168,.55); }
.md-eyebrow span { display:flex; flex-direction:column; align-items:center; gap:5px; }
.md-title-col { display:flex; flex-direction:column; align-items:center; }
.md-en-title { margin-top:10px; font-size:clamp(11px,1.3vw,15px); letter-spacing:.55em; text-indent:.55em;
  color:rgba(217,160,63,.8); }
.md-sub-wrap { display:flex; flex-direction:column; align-items:center; }
.md-sub-wrap .md-en { margin-top:8px; }
.md-intro-hint .md-en { margin-top:3px; font-size:10px; }
.md-note .md-en { margin-top:4px; font-size:10px; }
.md-intro-content .md-primary { display:inline-flex; flex-direction:column; align-items:center; gap:1px; }
.md-en-btn { font-size:.6em; letter-spacing:.32em; text-indent:.32em; color:rgba(26,10,8,.72); }
/* 剧情各处的英文小字 */
#md-act .md-en { margin-top:6px; font-size:clamp(9px,.9vw,11px); letter-spacing:.3em; text-indent:.3em; }
#md-sub > .md-en { margin-top:7px; font-size:.48em; letter-spacing:.1em; text-indent:.1em; text-transform:none; color:rgba(242,216,168,.68); }
#md-sub .who .md-en { display:inline; margin-left:12px; font-size:.82em; letter-spacing:.12em; text-indent:0; }
#md-display > .md-en { margin-top:10px; font-size:clamp(10px,1.1vw,13px); letter-spacing:.14em; text-indent:.14em; text-transform:none; color:rgba(242,216,168,.68); }
#md-click-prompt .md-en { margin-top:6px; font-size:.4em; letter-spacing:.3em; text-indent:.3em; }
.md-reward-card h2 .md-en { margin-top:6px; font-size:.42em; letter-spacing:.2em; text-indent:.2em; }
.md-reward-card p .md-en { margin-top:5px; font-size:.78em; letter-spacing:.06em; text-indent:.06em; text-transform:none; color:rgba(242,216,168,.6); }
.md-finale-name .md-en { margin-top:6px; font-size:.38em; letter-spacing:.34em; text-indent:.34em; }
.md-finale-type .md-en { margin-top:4px; font-size:.55em; letter-spacing:.16em; text-indent:.16em; text-transform:none; color:rgba(242,216,168,.6); }
.md-finale-keys .md-en { margin-top:4px; font-size:.6em; letter-spacing:.24em; text-indent:.24em; color:rgba(242,216,168,.5); }
.md-finale-text .md-en { margin-top:8px; font-size:.72em; line-height:1.7; letter-spacing:.04em; text-indent:0; text-transform:none; color:rgba(242,216,168,.6); }
.md-finale-frag span .md-en { margin-top:2px; font-size:8px; letter-spacing:.14em; text-indent:.14em; }
.md-finale-type-card span .md-en { margin-top:2px; font-size:8px; letter-spacing:.12em; text-indent:.12em; color:rgba(242,216,168,.55); }
.md-finale-btns .md-btn { display:inline-flex; flex-direction:column; align-items:center; gap:2px; }
.md-finale-btns .md-btn .md-en { font-size:.58em; letter-spacing:.24em; text-indent:.24em; }
.md-finale-btns .md-ghost .md-en { color:rgba(242,216,168,.55); }
.frag .md-en { margin-top:2px; font-size:.42em; letter-spacing:.1em; text-indent:.1em; color:rgba(26,10,8,.75); }
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
.md-title { font-family:var(--fzxbs); font-size:clamp(32px,5vw,48px); letter-spacing:.3em; text-indent:.3em; color:var(--gold-bright);
  text-shadow:0 0 28px rgba(217,138,60,.5); }
.md-sub { margin-top:6px; font-size:clamp(15px,2vw,19px); letter-spacing:.4em; text-indent:.4em; color:var(--ember); }
.md-controls { list-style:none; margin:26px auto 12px; max-width:440px; text-align:left; }
.md-controls li{ display:flex; align-items:center; gap:16px; padding:10px 6px;
  border-bottom:1px dashed rgba(217,160,63,.25); font-size:clamp(14px,1.8vw,17px); letter-spacing:.08em; }
.md-ctl-keys{ display:inline-flex; gap:6px; min-width:96px; }
.md-controls kbd{ display:inline-block; min-width:30px; padding:3px 8px; text-align:center; font-family:monospace;
  font-size:.9em; color:var(--gold-bright); border:1px solid rgba(217,160,63,.6); border-radius:4px; background:rgba(0,0,0,.25); }
.md-note{ margin:4px 0 22px; font-size:13px; letter-spacing:.1em; color:rgba(242,216,168,.55); }

/* 幕题（靠左显示） */
#md-act { position:fixed; top:16vh; left:0; right:0; z-index:30; text-align:left; padding-left:6vw; pointer-events:none; opacity:0;
  transition:opacity .9s ease; }
#md-act.show{ opacity:1; }
#md-act span{ display:inline-block; padding:10px 38px; font-family:var(--fzxbs); font-size:clamp(26px,4.2vw,44px); letter-spacing:.12em;
  text-indent:.12em; color:var(--paper); text-shadow:0 0 26px rgba(217,138,60,.6),0 2px 6px rgba(0,0,0,.8);
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

/* 敲门训诫：竖排黑字 · 画面左侧（方正小标宋，无此字体时回退宋体类） */
#md-voices { position:fixed; left:4vw; top:14vh; z-index:34;
  display:flex; flex-direction:row; align-items:flex-start; gap:2.4vw; pointer-events:none; }
#md-voices.hidden{ display:none; }
.voice-line { font-family:var(--fzxbs);
  writing-mode:horizontal-tb; display:flex; flex-direction:column; align-items:center; gap:10px;
  font-size:clamp(30px,3.2vw,42px); letter-spacing:.22em; line-height:1.35;
  color:#0d0d0d; text-shadow:0 0 10px rgba(242,216,168,.6),0 0 24px rgba(242,216,168,.35);
  background:rgba(255,255,255,.55); border-radius:6px; box-shadow:0 2px 14px rgba(0,0,0,.25);
  animation:voiceIn .5s ease; opacity:0; padding:16px 8px 12px; }
.voice-line .vl-zh { writing-mode:vertical-rl; }
.voice-line .vl-en { writing-mode:horizontal-tb; width:8em; font-style:normal; font-size:10px; line-height:1.5;
  letter-spacing:.04em; text-align:center; color:#3d2c1c; text-shadow:none; }
.voice-line.show{ opacity:1; }
.voice-line.intensify{ color:#000; text-shadow:0 0 14px rgba(240,192,96,.85),0 0 32px rgba(240,192,96,.5); }
.voice-line.shatter{ animation:voiceShatter .7s ease forwards; }
@keyframes voiceIn{ from{opacity:0;transform:translateY(8px) scale(.96)} to{opacity:.85;transform:translateY(0) scale(1)} }
/* 大字幕（画面上空，非对话框，方正小标宋 ~48px） */
#md-display { position:fixed; left:50%; top:10vh; transform:translateX(-50%); z-index:36; max-width:min(820px,90vw);
  padding:16px 40px; text-align:center; font-family:var(--fzxbs); font-size:clamp(32px,4vw,48px); letter-spacing:.2em;
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

/* 跳过对白按钮：仅 gardenTalk / assemble 期间显示，右下角常驻 */
#md-skip-dialogue { position:fixed; right:24px; bottom:24px; z-index:55;
  padding:10px 22px; cursor:pointer; border-radius:24px;
  font-family:var(--serif); font-size:clamp(13px,1.4vw,15px); letter-spacing:.24em; text-indent:.24em;
  color:var(--paper); background:rgba(0,0,0,.55); border:1px solid rgba(217,160,63,.55);
  display:inline-flex; flex-direction:column; align-items:center; gap:2px;
  backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px);
  transition:transform .15s ease, background .2s ease; animation:mdFadeIn .4s ease; }
#md-skip-dialogue:hover { transform:translateY(-2px); background:rgba(0,0,0,.7); }
#md-skip-dialogue .md-en { font-style:normal; font-size:9px; letter-spacing:.3em; text-indent:.3em;
  color:rgba(242,216,168,.6); text-transform:uppercase; }



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
.mirror-shadow-glow{ position:absolute; left:50%; top:45%; width:60%; height:40%; transform:translate(-50%,-50%);
  background:radial-gradient(ellipse 50% 50% at 50% 50%, rgba(240,192,96,.5), rgba(240,192,96,0) 70%);
  opacity:0; transition:opacity 1.2s ease; pointer-events:none; border-radius:50%; }
#md-mirror.filled-torso .mirror-shadow-glow{ opacity:1; animation:shadowPulse 2s ease-in-out infinite; }
@keyframes shadowPulse{ 0%,100%{opacity:.4} 50%{opacity:.9} }

/* 闺房梳妆桌上的酒瓶：z-index:4 位于后中(2)之上、角色层(5)之下
   角色走过时角色盖住酒瓶；酒瓶靠 s1-front 在桌面处的透明区域可见 */
.prop-bottle{ position:absolute; pointer-events:none; z-index:4; display:block; }
.chamber-bottle{ left:23.4%; bottom:34%; height:22vh; width:auto;
  transform:translateX(-50%);
  filter:drop-shadow(0 4px 10px rgba(0,0,0,.55)) drop-shadow(0 0 6px rgba(217,138,60,.18)); }

/* 奖励 */
#md-reward { position:fixed; inset:0; z-index:70; display:flex; align-items:center; justify-content:center;
  pointer-events:none; animation:mdFadeIn .5s ease; }
#md-reward.hidden{ display:none; }
.md-reward-card{ width:min(440px,86vw); padding:34px 30px 28px; text-align:center; color:var(--paper);
  background:linear-gradient(180deg,rgba(28,12,18,.94),rgba(14,6,10,.97)); border:1px solid rgba(217,160,63,.45);
  border-top:2px solid var(--gold); border-bottom:2px solid var(--gold);
  box-shadow:0 0 50px rgba(217,138,60,.25),0 18px 50px rgba(0,0,0,.6); animation:mdPop .6s cubic-bezier(.2,.9,.3,1.2); }
@keyframes mdPop{ from{opacity:0;transform:scale(.88)} to{opacity:1;transform:scale(1)} }
.md-shard{ width:120px; height:170px; margin:0 auto 18px;
  background:radial-gradient(circle at 40% 30%,var(--gold-bright),var(--ember) 60%,var(--lacquer));
  clip-path:polygon(50% 0,100% 35%,80% 100%,20% 100%,0 35%); box-shadow:0 0 30px rgba(240,192,96,.6);
  animation:mdGlow 2.4s ease-in-out infinite; }
.md-shard.has-img{ background:transparent; clip-path:none; box-shadow:0 0 26px rgba(240,192,96,.45),0 8px 24px rgba(0,0,0,.45);
  background-repeat:no-repeat; background-position:center center; background-size:contain;
  filter:drop-shadow(0 0 14px rgba(240,192,96,.55)); animation:mdGlow 2.4s ease-in-out infinite; }
@keyframes mdGlow{ 0%,100%{filter:brightness(1)} 50%{filter:brightness(1.35)} }

/* 三碎片拼合 = 完整杜丽娘（rewardTorso 专用） */
.md-assemble{ position:relative; width:200px; height:240px; margin:0 auto 18px; display:none;
  align-items:center; justify-content:center; }
.md-assemble-frag{ position:absolute; left:50%; top:50%; width:110px; height:150px;
  background-repeat:no-repeat; background-position:center center; background-size:contain;
  filter:drop-shadow(0 0 14px rgba(240,192,96,.55)); opacity:0; transform:translate(calc(-50% + var(--from-x,0px)),calc(-50% + var(--from-y,0px))) scale(.7);
  animation:mdAssembleMerge 1.6s ease-out forwards; }
.md-assemble-frag[data-shard="hands"]{ --from-x:-130px; --from-y:-70px; animation-delay:0s; background-image:url("/props/shard-hands.png"); }
.md-assemble-frag[data-shard="torso"]{ --from-x:0; --from-y:-110px; animation-delay:.18s; background-image:url("/props/shard-torso.png"); }
.md-assemble-frag[data-shard="feet"]{ --from-x:130px; --from-y:80px; animation-delay:.36s; background-image:url("/props/shard-feet.png"); }
@keyframes mdAssembleMerge{
  0%{ opacity:0; transform:translate(calc(-50% + var(--from-x,0px)),calc(-50% + var(--from-y,0px))) scale(.7); }
  55%{ opacity:1; transform:translate(-50%,-50%) scale(1.05); }
  78%{ opacity:1; transform:translate(-50%,-50%) scale(1); }
  100%{ opacity:0; transform:translate(-50%,-50%) scale(.92); } }
.md-assemble-result{ position:absolute; left:50%; top:50%; width:180px; height:230px;
  transform:translate(-50%,-50%) scale(.7); object-fit:contain; opacity:0;
  filter:drop-shadow(0 0 26px rgba(240,192,96,.7));
  animation:mdAssembleReveal 1.2s ease-out 1.6s forwards; }
@keyframes mdAssembleReveal{
  0%{ opacity:0; transform:translate(-50%,-50%) scale(.6); }
  55%{ opacity:1; transform:translate(-50%,-50%) scale(1.12); }
  100%{ opacity:1; transform:translate(-50%,-50%) scale(1); } }
.md-reward-card h2{ font-family:var(--fzxbs); font-size:clamp(20px,2.6vw,26px); letter-spacing:.16em; color:var(--gold-bright); }
.md-reward-card p{ margin:10px 0 0; font-size:clamp(14px,1.8vw,17px); line-height:1.7; letter-spacing:.06em;
  color:rgba(242,216,168,.85); }

/* 音游单关结束：失分阈值 + 重玩/进退关/回到主线 选择面板 */
#md-level-choice{ z-index:75; }
.md-level-card{ width:min(460px,88vw); padding:36px 30px 28px; text-align:center; color:var(--paper);
  background:linear-gradient(180deg,rgba(28,12,18,.95),rgba(14,6,10,.98)); border:1px solid rgba(217,160,63,.45);
  border-top:2px solid var(--gold); border-bottom:2px solid var(--gold);
  box-shadow:0 0 50px rgba(217,138,60,.25),0 18px 50px rgba(0,0,0,.6);
  animation:mdPop .6s cubic-bezier(.2,.9,.3,1.2); }
.md-level-card h2{ font-family:var(--fzxbs); font-size:clamp(22px,2.8vw,28px); letter-spacing:.18em; color:var(--gold-bright);
  text-shadow:0 0 18px rgba(217,138,60,.45); }
.md-level-card h2 .md-en{ margin-top:6px; font-size:.4em; letter-spacing:.28em; text-indent:.28em; }
.md-level-card p{ margin:12px 0 22px; font-size:clamp(14px,1.8vw,17px); line-height:1.7; letter-spacing:.06em;
  color:rgba(242,216,168,.85); }
.md-level-card p .md-en{ margin-top:6px; font-size:.78em; letter-spacing:.06em; text-indent:.06em; text-transform:none;
  color:rgba(242,216,168,.6); }
.md-level-btns{ display:flex; gap:14px; justify-content:center; flex-wrap:wrap; }
.md-level-btns .md-btn{ display:inline-flex; flex-direction:column; align-items:center; gap:2px; }
.md-level-btns .md-btn .md-en{ font-size:.58em; letter-spacing:.24em; text-indent:.24em; }
.md-level-btns .md-ghost .md-en{ color:rgba(242,216,168,.55); }

/* 结算 */
#md-finale .md-finale-card{ position:relative; width:min(560px,92vw); padding:48px 32px 30px; text-align:center; color:var(--paper);
  background:linear-gradient(180deg,rgba(28,12,18,.95),rgba(14,6,10,.98)); border:1px solid rgba(217,160,63,.45);
  border-top:2px solid var(--gold); border-bottom:2px solid var(--gold);
  box-shadow:0 20px 60px rgba(0,0,0,.65); animation:mdPop .6s cubic-bezier(.2,.9,.3,1.2); }
.md-finale-name{ font-family:var(--fzxbs); font-size:clamp(24px,3.4vw,32px); letter-spacing:.24em; text-indent:.24em; color:var(--gold-bright);
  text-shadow:0 0 20px rgba(217,138,60,.5); }
.md-finale-type{ margin:12px 0 4px; font-size:clamp(16px,2.1vw,20px); letter-spacing:.2em; color:var(--ember); }
.md-finale-keys{ margin:6px 0 14px; font-size:clamp(14px,1.8vw,16px); letter-spacing:.16em; color:rgba(240,192,96,.85); }
.md-finale-text{ margin:0 0 24px; font-size:clamp(14px,1.8vw,16px); line-height:1.9; letter-spacing:.06em;
  color:rgba(242,216,168,.82); }
/* 玩家个性化杜丽娘形象（大图） */
.md-finale-figure{ display:block; width:auto; height:min(46vh,320px); margin:0 auto 18px;
  object-fit:contain; filter:drop-shadow(0 12px 32px rgba(0,0,0,.55)) drop-shadow(0 0 26px rgba(240,192,96,.55));
  animation:mdFinaleFigureIn 1.2s cubic-bezier(.2,.9,.3,1.1) both; }
@keyframes mdFinaleFigureIn{
  0%{ opacity:0; transform:translateY(20px) scale(.92); filter:blur(6px) drop-shadow(0 0 0 rgba(240,192,96,0)); }
  60%{ opacity:1; }
  100%{ opacity:1; transform:translateY(0) scale(1); filter:blur(0) drop-shadow(0 12px 32px rgba(0,0,0,.55)) drop-shadow(0 0 26px rgba(240,192,96,.55)); } }
.md-finale-btns{ display:flex; gap:14px; justify-content:center; flex-wrap:wrap; }
/* 终幕题词：3 句竖排，常驻屏幕左侧；活动句（正在念白）高亮 */
.md-finale-quote{ position:absolute; left:3vw; top:50%; transform:translateY(-50%);
  display:flex; flex-direction:row-reverse; align-items:flex-start; gap:1.4vw;
  z-index:1; pointer-events:none; max-height:84vh;
  text-align:left; }
.md-finale-quote.hidden{ display:none; }
.md-finale-quote .mq-line{ writing-mode:vertical-rl;
  font-family:var(--fzxbs); font-size:clamp(18px,1.7vw,26px); letter-spacing:.22em;
  color:rgba(242,216,168,.5); text-shadow:0 0 12px rgba(0,0,0,.85);
  line-height:1.7; white-space:nowrap; padding:6px 4px;
  transition:color .5s ease, text-shadow .5s ease, filter .5s ease; }
.md-finale-quote .mq-line.active{
  color:var(--gold-bright); filter:brightness(1.15);
  text-shadow:0 0 22px rgba(240,192,96,.85), 0 0 8px rgba(0,0,0,.9); }
@media (max-width: 760px){
  .md-finale-quote{ display:none; }
}

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
  private finaleEl: HTMLElement;
  private finaleQuoteEl: HTMLElement;
  private finaleToken = 0;
  private chamberBottleEl: HTMLElement;
  private actEl: HTMLElement;
  private dimEl: HTMLElement;
  private layers: { el: HTMLElement; depth: number }[] = [];
  private finaleType: HTMLElement;
  private finaleKeys: HTMLElement;
  private finaleText: HTMLElement;
  private nftPanel: NftPanel | null = null;
  private nftPanelLoading: Promise<void> | null = null;
  private clickPromptEl: HTMLElement | null = null;
  private behavior = {
    knockIntervals: [] as number[],
    lastKnockAt: -1,
    walkDist: 0,
    dirChanges: 0,
    lastDir: 0,
    knockAt: -1,
    clickPromptAt: -1,
    mirrorClickAt: -1,
  };

  private state: GState = "intro";
  private timer = 0;
  private knockCount = 0;
  private knockStarted = false;
  private doorBlocked = false;
  private wasAtDoor = false;
  private knockTimer = 0;
  private dialogueToken = 0;
  private act2Shown = false;
  private act3Shown = false;
  private gardenTextT = -1;
  private fragmentHands = false;
  private fragmentFeet = false;
  private fragmentTorso = false;
  private assmHands = false;
  private rippleStarted = false;
  private assmFeet = false;

  private theatreEl: HTMLElement | null = null;
  private rhythmRoot: Root | null = null;
  private finaleBgm: HTMLAudioElement | null = null;
  private currentRhythmLevel: 1 | 2 | 3 = 1;
  private levelChoiceEl: HTMLElement | null = null;
  // 主线背景音乐（瑞鸣音乐·牡丹亭）：从开始体验一直贯穿到终幕，音游期间暂停
  private storyBgm: HTMLAudioElement | null = null;
  // 当前对白的 onDone 回调；跳过按钮直接调用它进入下一状态
  private currentDialogueDone: (() => void) | null = null;
  private skipDialogueEl: HTMLElement | null = null;

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
    this.rewardEl = this.inject('<div id="md-reward" class="hidden"><div class="md-reward-card"><div class="md-shard"></div><div class="md-assemble" aria-hidden="true"><div class="md-assemble-frag" data-shard="hands"></div><div class="md-assemble-frag" data-shard="torso"></div><div class="md-assemble-frag" data-shard="feet"></div><img class="md-assemble-result" alt="" /></div><h2></h2><p></p></div></div>');
    this.rewardTitle = this.rewardEl.querySelector("h2")!;
    this.rewardDesc = this.rewardEl.querySelector("p")!;
    this.finaleEl = this.inject('<div id="md-finale" class="mudan-overlay hidden"><p class="md-finale-quote hidden" id="md-finale-quote"></p><div class="md-finale-card"><img class="md-finale-figure" alt="" /><h2 class="md-finale-name">你的杜丽娘<i class="md-en">Your Du Liniang</i></h2><p class="md-finale-type"></p><p class="md-finale-keys"></p><p class="md-finale-text"></p><div class="md-finale-btns"><button class="md-btn md-primary" type="button"><span>重新体验</span><i class="md-en md-en-btn">Replay</i></button><button class="md-btn md-ghost" type="button"><span>结束体验</span><i class="md-en">End</i></button><button class="md-btn md-ghost" id="md-nft-btn" type="button"><span>铸造 NFT</span><i class="md-en">Mint NFT</i></button></div></div></div>');
    this.finaleType = this.finaleEl.querySelector(".md-finale-type")!;
    this.finaleKeys = this.finaleEl.querySelector(".md-finale-keys")!;
    this.finaleText = this.finaleEl.querySelector(".md-finale-text")!;
    this.finaleQuoteEl = this.finaleEl.querySelector("#md-finale-quote")!;
    this.introEl = this.inject('<div id="md-intro" class="mudan-overlay"><video class="md-intro-video" src="/video/intro-bg.mp4" autoplay muted loop playsinline preload="auto"></video><div class="md-intro-shade" aria-hidden="true"></div><div class="md-intro-frame" aria-hidden="true"></div><div class="md-intro-content"><p class="md-eyebrow"><span>梦入牡丹亭 · 皮影戏<i class="md-en">Dream into the Peony Pavilion · Shadow Puppetry</i></span></p><div class="md-title-row"><div class="md-title-col"><h1 class="md-title">惊梦</h1><i class="md-en md-en-title">The Dream</i></div><span class="md-seal" aria-hidden="true">牡丹亭</span></div><div class="md-sub-wrap"><p class="md-title-sub"><span>寻回杜丽娘</span></p><i class="md-en">Recovering Du Liniang</i></div><p class="md-intro-hint"><span class="md-ctl-keys"><kbd>&larr;</kbd><kbd>&rarr;</kbd></span><span>左右移动，走到目标即可<i class="md-en">Move with the arrow keys</i></span></p><p class="md-note">剧情会自动展开，无需按键<i class="md-en">The story unfolds on its own</i></p><button class="md-btn md-primary" type="button"><span>开始体验</span><i class="md-en md-en-btn">Begin</i></button></div></div>');

    this.doorGlowEl = this.inject('<div id="md-door" class="hidden" aria-hidden="true"></div>', this.panorama);
    this.mirrorEl = this.inject('<div id="md-mirror"><img class="mirror-img" src="/mirror/mirror.png" alt="" /><div class="mirror-shadow-glow"></div><div class="mirror-frags"><span class="frag frag-hands">双手<i class="md-en">Hands</i></span><span class="frag frag-feet">双脚<i class="md-en">Feet</i></span><span class="frag frag-torso">躯干<i class="md-en">Torso</i></span></div></div>', this.panorama);
    // 酒瓶注入到 panorama，z-index:6 与 layer-front 同层（前景层）
    // DOM 顺序在 layer-front 之后 → 自然渲染在梳妆台前面
    this.chamberBottleEl = this.inject('<img class="prop-bottle chamber-bottle" src="/props/wine-bottle.png" alt="" aria-hidden="true" />', this.panorama);

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
    if (nftBtn) nftBtn.addEventListener("click", () => { void this.openNftPanel(); });
  }

  private async openNftPanel() {
    if (this.nftPanel) {
      this.nftPanel.show();
      return;
    }
    if (!this.nftPanelLoading) {
      this.nftPanelLoading = import("./nft-panel")
        .then(({ NftPanel }) => {
          this.nftPanel = new NftPanel();
          this.nftPanel.show();
        })
        .finally(() => {
          this.nftPanelLoading = null;
        });
    }
    await this.nftPanelLoading;
  }

  private beginGame() {
    if (!this.ready) return;
    ensureAudio();
    const introVideo = this.introEl.querySelector("video");
    this.introEl.classList.add("closing");
    setTimeout(() => {
      this.introEl.classList.add("hidden");
      this.introEl.classList.remove("closing");
      introVideo?.pause();
    }, 900);
    this.dimEl.classList.add("lit");
    fx.setAmbient("dust");
    this.actTitle("第一幕 · 幽闭闺房", "Act I · The Secluded Chamber");
    this.startStoryBgm();
    this.enter("approach");
    this.showHint(true, 5000);
  }

  private showHint(show: boolean, autoHideMs = 0) {
    if (show) {
      this.hintEl.classList.remove("hidden");
      if (autoHideMs) setTimeout(() => this.hintEl.classList.add("hidden"), autoHideMs);
    } else this.hintEl.classList.add("hidden");
  }

  private say(text: string, who?: string, en?: string, whoEn?: string) {
    const whoHtml = who
      ? '<span class="who">' + who + (whoEn ? '<i class="md-en">' + whoEn + "</i>" : "") + "</span>"
      : "";
    const enHtml = en ? '<i class="md-en">' + en + "</i>" : "";
    this.subtitleEl.innerHTML = whoHtml + text + enHtml;
    this.subtitleEl.classList.remove("hidden");
    this.voicesEl.classList.add("hidden");
  }
  private clearSay() { this.subtitleEl.classList.add("hidden"); }
  private setDisplay(text: string, en?: string) {
    this.displayEl.innerHTML = text + (en ? '<i class="md-en">' + en + "</i>" : "");
    this.displayEl.classList.remove("hidden");
    this.subtitleEl.classList.add("hidden");
    this.voicesEl.classList.add("hidden");
  }
  private clearDisplay() { this.displayEl.classList.add("hidden"); }

  private addVoice(line: { zh: string; en: string }) {
    this.subtitleEl.classList.add("hidden");
    this.voicesEl.classList.remove("hidden");
    // 只保留当前这一句，替换上一句（不叠加堆积）
    this.voicesEl.innerHTML = "";
    const el = document.createElement("div");
    el.className = "voice-line";
    el.innerHTML = '<span class="vl-zh">' + line.zh + '</span><i class="vl-en">' + line.en + "</i>";
    this.voicesEl.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
  }
  private showAllVoices() {
    this.subtitleEl.classList.add("hidden");
    this.voicesEl.classList.remove("hidden");
    this.voicesEl.innerHTML = "";
    for (const text of KNOCK_LINES) {
      const line = document.createElement("div");
      line.className = "voice-line show";
      line.innerHTML = '<span class="vl-zh">' + text.zh + '</span><i class="vl-en">' + text.en + "</i>";
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

  private actTitle(title: string, en?: string) {
    const span = this.actEl.querySelector("span")!;
    span.innerHTML = title + (en ? '<i class="md-en">' + en + "</i>" : "");
    this.actEl.classList.remove("hidden");
    requestAnimationFrame(() => this.actEl.classList.add("show"));
    setTimeout(() => {
      this.actEl.classList.remove("show");
      setTimeout(() => this.actEl.classList.add("hidden"), 900);
    }, 2400);
  }

  private showReward(title: string, desc: string, shardImg?: string, titleEn?: string, descEn?: string) {
    // 非 torso 奖励：隐藏拼合容器，恢复单碎片显示
    const assemble = this.rewardEl.querySelector<HTMLElement>(".md-assemble");
    if (assemble) assemble.style.display = "none";
    const shard = this.rewardEl.querySelector<HTMLElement>(".md-shard");
    if (shard) {
      shard.style.display = "";
      if (shardImg) {
        shard.style.backgroundImage = 'url("' + shardImg + '")';
        shard.classList.add("has-img");
      } else {
        shard.style.backgroundImage = "";
        shard.classList.remove("has-img");
      }
    }
    this.rewardTitle.innerHTML = title + (titleEn ? '<i class="md-en">' + titleEn + "</i>" : "");
    this.rewardDesc.innerHTML = desc + (descEn ? '<i class="md-en">' + descEn + "</i>" : "");
    this.rewardEl.classList.remove("hidden");
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    fx.burst(cx, cy, 60, 44);
  }
  private hideReward() { this.rewardEl.classList.add("hidden"); }

  // 镜中三碎片拼合 → 显现完整的个性化杜丽娘形象
  private showAssembleReward(type: "awaken" | "explore" | "firm" | "free") {
    const shard = this.rewardEl.querySelector<HTMLElement>(".md-shard");
    if (shard) shard.style.display = "none";
    const assemble = this.rewardEl.querySelector<HTMLElement>(".md-assemble");
    if (assemble) {
      assemble.style.display = "flex";
      // 重置碎片动画（支持重复进入）
      assemble.querySelectorAll<HTMLElement>(".md-assemble-frag").forEach((frag) => {
        frag.style.animation = "none";
        void frag.offsetWidth;
        frag.style.animation = "";
      });
      const result = assemble.querySelector<HTMLImageElement>(".md-assemble-result");
      if (result) {
        result.src = `/props/type-${type}.png`;
        result.style.animation = "none";
        void result.offsetWidth;
        result.style.animation = "";
      }
    }
    const meta = {
      awaken: { name: "觉醒型", en: "The Awakened" },
      explore: { name: "探索型", en: "The Explorer" },
      firm: { name: "坚定型", en: "The Steadfast" },
      free: { name: "自由型", en: "The Free" },
    }[type];
    this.rewardTitle.innerHTML = `完整的杜丽娘 · ${meta.name}<i class="md-en">Your Du Liniang · ${meta.en}</i>`;
    this.rewardDesc.innerHTML = "三碎片归一，你的杜丽娘已然现身。<i class=\"md-en\">Three shards merged — your Du Liniang has emerged.</i>";
    this.rewardEl.classList.remove("hidden");
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    fx.burst(cx, cy, 80, 52);
  }

  private doorScreenPos(): { x: number; y: number } {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      x: (CHAMBER.door - this.camX) * vw,
      y: vh * 0.55,
    };
  }

  private doKnock(idx: number) {
    // 行为记录：敲门间隔（用于结算类型判定）
    const nowKnock = performance.now();
    if (this.behavior.lastKnockAt >= 0) this.behavior.knockIntervals.push(nowKnock - this.behavior.lastKnockAt);
    this.behavior.lastKnockAt = nowKnock;
    this.behavior.knockAt = nowKnock;
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
    // 严格守卫：仅在 talkEnd 状态（即花园对白全部播完后）才显示按钮
    if (this.state !== "talkEnd") return;
    if (this.clickPromptEl) this.clickPromptEl.remove();
    this.behavior.clickPromptAt = performance.now();
    this.clickPromptEl = this.inject('<div id="md-click-prompt">点击进入游戏<i class="md-en">Click to Enter</i></div>');
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
    this.dialogueToken++;
    switch (s) {
      case "approach":
        this.setDisplay("离开这个深闺！", "Leave this secluded chamber!");
        break;
      case "rewardHands":
        this.fragmentHands = true;
        this.showReward("获得：杜丽娘 · 双手", "点亮编织自我人生的能力。", "/props/shard-hands.png",
          "Recovered: Du Liniang · Hands", "The power to weave your own life is lit.");
        break;
      case "freeRoam":
        this.hideReward();
        fx.setAmbient("dust");
        this.clearSay();
        break;
      case "rhythm":
        this.clearSay();
        break;
      case "gardenTalk":
        this.clearSay();
        this.hideClickPrompt();
        {
          const startTalk = () => {
            this.clearDisplay();
            this.gardenTextT = -1;
            this.runDialogue(GARDEN_TALK, GARDEN_VOICE_SRC, {
              onLine: (line) => {
                this.puppetGlow(line.who === "杜丽娘");
                this.puppet?.setState(line.anim || "idle");
              },
              onDone: () => this.enter("talkEnd"),
            });
          };
          // 入园念白还在播时等它念完再开始对白，避免两段人声叠在一起
          // quote 完整版约 12.4s，兜底给到 25s（远大于音频时长），优先靠 ended 事件触发
          const q = gardenQuoteAudio;
          if (q && !q.paused && !q.ended) {
            let started = false;
            const go = () => {
              if (!started) { started = true; startTalk(); }
            };
            q.addEventListener("ended", go, { once: true });
            window.setTimeout(go, 25000);
          } else {
            startTalk();
          }
        }
        break;
      case "talkEnd":
        this.clearSay();
        this.showClickPrompt();
        break;
      case "rewardFeet":
        this.fragmentFeet = true;
        this.puppetGlow(false);
        this.clearSay();
        this.showReward("获得：杜丽娘 · 双脚", "拥有选择方向的自由。", "/props/shard-feet.png",
          "Recovered: Du Liniang · Feet", "The freedom to choose your own direction.");
        break;
      case "toMirror":
        this.hideReward();
        this.mirrorEl.classList.remove("blurred", "filled-hands", "filled-feet", "filled-torso", "assembling");
        this.say("镜中似有人影，走近看看。", "花园", "A figure stirs within the mirror — step closer.", "The Garden");
        break;
      case "assemble":
        this.clearSay();
        this.runDialogue(MIRROR_TALK, MIRROR_VOICE_SRC, {
          onDone: () => this.startAssemble(),
        });
        break;
      case "rewardTorso":
        this.fragmentTorso = true;
        this.clearSay();
        this.showAssembleReward(this.computeType());
        break;
      case "finale":
        this.startFinale();
        break;
    }
  }

  // 事件驱动的对白序列：完整未剪辑音频一次播放，
  // 字幕按字数比例分配时长（每句字幕出现时长 = 整段音频时长 × 该句字数 / 总字数），
  // 字幕出现总时长与音频播放时长一致；音频自然结束 + 0.6s 停顿后触发 onDone。
  // 期间可在画面右下角显示「跳过对白」按钮，点击立即停掉音频并触发 onDone。
  private runDialogue(
    lines: DialogueLine[],
    fullAudioSrc: string,
    opts: { onLine?: (line: DialogueLine, idx: number) => void; onDone: () => void },
  ) {
    const token = ++this.dialogueToken;
    const totalChars = lines.reduce((s, l) => s + Math.max(1, l.text.length), 0);
    // 音频加载失败时的字数估算（≈ 原 2500 + chars*220），保证剧情不会卡住
    const fallbackLineMs = (l: DialogueLine) => 2500 + l.text.length * 220;
    const fallbackTotalMs = lines.reduce((s, l) => s + fallbackLineMs(l), 0);

    let doneFired = false;
    const fireDone = (force = false) => {
      // dedupe: 自然 ended / error / skip 按钮都可能触发，只允许第一次进入
      if (doneFired) return;
      // 若对白已被取代（replay / 状态切换导致 dialogueToken 自增），且非强制调用，则放弃
      if (!force && token !== this.dialogueToken) return;
      doneFired = true;
      this.currentDialogueDone = null;
      this.hideSkipButton();
      window.setTimeout(() => {
        opts.onDone();
      }, 600);
    };

    const scheduleLines = (durationMs: number) => {
      let elapsed = 0;
      lines.forEach((line, idx) => {
        const startAt = elapsed;
        const share = Math.max(1, line.text.length) / totalChars;
        const lineDuration = share * durationMs;
        window.setTimeout(() => {
          if (token !== this.dialogueToken) return;
          // 兜底：每条字幕出现前再清一次「点击进入游戏」按钮，防止任何路径残留
          this.hideClickPrompt();
          this.say(line.text, line.who, line.en, line.whoEn);
          opts.onLine?.(line, idx);
        }, startAt);
        elapsed += lineDuration;
      });
    };

    // 暴露 onDone 给跳过按钮（force=true 跳过 token 守卫，因 skip 会先自增 token 取消字幕 setTimeout）
    this.currentDialogueDone = () => fireDone(true);
    this.showSkipButton();

    const audio = new Audio(fullAudioSrc);
    audio.loop = false;
    audio.volume = 0.9;
    activeAudio.push(audio);

    const onMetadata = () => {
      if (token !== this.dialogueToken) return;
      const dur = audio.duration;
      if (dur && isFinite(dur) && dur > 0) {
        scheduleLines(dur * 1000);
      } else {
        scheduleLines(fallbackTotalMs);
      }
    };
    if (audio.readyState >= 1 && !isNaN(audio.duration)) {
      onMetadata();
    } else {
      audio.addEventListener("loadedmetadata", onMetadata, { once: true });
    }
    audio.addEventListener("ended", () => fireDone(), { once: true });
    const fallbackSchedule = () => {
      scheduleLines(fallbackTotalMs);
      window.setTimeout(fireDone, fallbackTotalMs + 600);
    };
    audio.addEventListener("error", fallbackSchedule, { once: true });
    audio.play().catch(fallbackSchedule);
  }

  // 跳过对白按钮：右下角常驻，仅在 runDialogue 期间可见
  private showSkipButton() {
    if (this.skipDialogueEl) return;
    const btn = this.inject(
      '<button id="md-skip-dialogue" type="button" aria-label="跳过对白"><span>跳过</span><i class="md-en">Skip</i></button>',
    );
    btn.addEventListener("click", () => {
      const done = this.currentDialogueDone;
      if (!done) return;
      stopAllVoices();
      this.dialogueToken++;
      done();
    });
    this.skipDialogueEl = btn;
  }
  private hideSkipButton() {
    if (this.skipDialogueEl) {
      this.skipDialogueEl.remove();
      this.skipDialogueEl = null;
    }
  }

  // 镜前对话播完：不再在镜子上弹出碎片，直接进入「完整杜丽娘」拼合结算
  private startAssemble() {
    if (this.assmHands) return;
    this.assmHands = true;
    this.clearSay();
    setTimeout(() => this.enter("rewardTorso"), 400);
  }

  private ensureTheatre(level: 1 | 2 | 3 = 1) {
    if (this.theatreEl) return;
    this.currentRhythmLevel = level;
    this.behavior.mirrorClickAt = performance.now();
    const wrap = document.createElement("div");
    wrap.id = "rhythm-stage";
    wrap.style.cssText = "position:fixed;inset:0;z-index:40;opacity:1;";
    document.body.appendChild(wrap);
    this.theatreEl = wrap;
    // 音游期间暂停主线 BGM，让音游 BGM 主导
    this.pauseStoryBgm();
    this.enter("rhythm");
    this.rhythmRoot = mountRhythm(wrap, {
      level,
      onFinish: (result) => {
        this.hideTheatre();
        this.handleRhythmFinish(result);
      },
      onExit: () => {
        this.hideTheatre();
        this.enter("talkEnd");
      },
    });
    this.charX = THEATRE.center;
  }

  // 音游单关结束：根据失分率与当前关卡决定「重玩 / 进退关 / 回到主线」
  private handleRhythmFinish(result: { level: number; ratio: number; score: number }) {
    const percent = Math.max(0, Math.min(100, Math.round(result.ratio * 100)));
    const level = result.level as 1 | 2 | 3;
    // 失分超过 50%（即 ratio < 0.5）仅第 1 关强制重玩；后续关直接放行（玩家自主选择是否继续）
    if (level === 1 && result.ratio < 0.5) {
      this.showLevelChoice(level, percent, "fail");
    } else if (level >= 3) {
      this.showLevelChoice(level, percent, "pass-final");
    } else {
      this.showLevelChoice(level, percent, "pass");
    }
  }

  private showLevelChoice(
    level: 1 | 2 | 3,
    percent: number,
    status: "fail" | "pass" | "pass-final",
  ) {
    this.hideLevelChoice();
    const titleZh = status === "fail" ? "这一折未能圆满" : `第 ${level} 折已毕`;
    const titleEn = status === "fail" ? "This scene faltered" : `Level ${level} Cleared`;
    let descZh: string;
    let descEn: string;
    if (status === "fail") {
      descZh = `准确率仅 ${percent}%，失分已过半。须再演这一折。`;
      descEn = `Accuracy ${percent}% — too many missed beats. Try this level again.`;
    } else if (status === "pass-final") {
      descZh = `三折皆毕，准确率 ${percent}%。可回到主线剧情。`;
      descEn = `All three scenes complete (${percent}%). Return to the main story.`;
    } else {
      descZh = `准确率 ${percent}%。可进入下一折，或回到主线。`;
      descEn = `Accuracy ${percent}%. Continue to the next scene, or return to the main story.`;
    }
    const buttons: string[] = [];
    if (status === "fail") {
      buttons.push(
        `<button class="md-btn md-primary" type="button" data-act="retry"><span>再演这一折</span><i class="md-en md-en-btn">Retry</i></button>`,
      );
    } else if (status === "pass") {
      buttons.push(
        `<button class="md-btn md-primary" type="button" data-act="next"><span>进入下一折</span><i class="md-en md-en-btn">Next Scene</i></button>`,
        `<button class="md-btn md-ghost" type="button" data-act="main"><span>回到主线</span><i class="md-en">Main Story</i></button>`,
      );
    } else {
      buttons.push(
        `<button class="md-btn md-primary" type="button" data-act="main"><span>回到主线</span><i class="md-en md-en-btn">Main Story</i></button>`,
      );
    }
    const card = this.inject(
      `<div id="md-level-choice" class="mudan-overlay"><div class="md-level-card"><h2>${titleZh}<i class="md-en">${titleEn}</i></h2><p>${descZh}<i class="md-en">${descEn}</i></p><div class="md-level-btns">${buttons.join("")}</div></div></div>`,
    );
    this.levelChoiceEl = card;
    card.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        this.hideLevelChoice();
        if (act === "retry") {
          this.ensureTheatre(1);
        } else if (act === "next") {
          const nextLevel = Math.min(3, level + 1) as 1 | 2 | 3;
          this.ensureTheatre(nextLevel);
        } else if (act === "main") {
          this.enter("rewardFeet");
        }
      });
    });
  }

  private hideLevelChoice() {
    if (this.levelChoiceEl) {
      this.levelChoiceEl.remove();
      this.levelChoiceEl = null;
    }
  }

  private hideTheatre() {
    const el = this.theatreEl;
    const root = this.rhythmRoot;
    // 立即清空 theatreEl / rhythmRoot，使 ensureTheatre 可在淡出动画期间被重新触发（重复进入 / 下一关）
    this.theatreEl = null;
    this.rhythmRoot = null;
    if (el) {
      el.style.opacity = "0";
      window.setTimeout(() => {
        // 仅卸载本次捕获的 root，避免误杀随后新挂载的 rhythm 实例
        unmountRhythm(root);
        el.remove();
      }, 300);
    }
    // 音游退出后恢复主线 BGM
    this.resumeStoryBgm();
    this.charX = THEATRE.exit;
    this.facing = 1;
  }

  private playRipple() {
    if (this.rippleStarted) return;
    this.rippleStarted = true;
    window.setTimeout(() => {
      this.enter("finale");
    }, 600);
  }

  // 对外保留 computeType 接口（对外宣称"根据行为数据生成专属杜丽娘"），
  // 实际从 4 种预生成形象中随机抽取一个；保证每次通关都有变化但不依赖行为采集的准确性
  private computeType(): "awaken" | "explore" | "firm" | "free" {
    const types: Array<"awaken" | "explore" | "firm" | "free"> = ["awaken", "explore", "firm", "free"];
    return types[Math.floor(Math.random() * types.length)];
  }

  private startFinale() {
    this.hideReward();
    this.finaleEl.classList.remove("hidden");
    this.puppet?.setState("hi");
    this.puppetGlow(true);
    this.startFinaleBgm();
    this.playFinaleQuotes();
    const id = this.computeType();
    const meta = {
      awaken: {
        name: "觉醒型", en: "The Awakened",
        keys: "勇敢 · 主动 · 突破束缚", keysEn: "Brave · Proactive · Unbound",
        quote: "「她第一次推开了门，也第一次看见了自己。」",
        quoteEn: "For the first time she pushed the door open — and for the first time she saw herself.",
      },
      explore: {
        name: "探索型", en: "The Explorer",
        keys: "敏感 · 观察 · 寻找", keysEn: "Sensitive · Observant · Seeking",
        quote: "「她在花园中寻找春色，也寻找自己的可能。」",
        quoteEn: "In the garden she searched for the colors of spring — and for her own possibilities.",
      },
      firm: {
        name: "坚定型", en: "The Steadfast",
        keys: "坚强 · 自我确认 · 主体意识", keysEn: "Resolute · Self-assured · Self-possessed",
        quote: "「她不再等待别人定义自己。」",
        quoteEn: "She no longer waits for others to define her.",
      },
      free: {
        name: "自由型", en: "The Free",
        keys: "绽放 · 舒展 · 生命力", keysEn: "Blooming · Unfolding · Vitality",
        quote: "「想开花，就开花；想绽放，就绽放。」",
        quoteEn: "Bloom when she wishes to bloom; flourish when she wishes to flourish.",
      },
    }[id];
    this.finaleType.innerHTML = "你是镜中杜丽娘 · " + meta.name + '<i class="md-en">You are the Du Liniang in the mirror — ' + meta.en + "</i>";
    this.finaleKeys.innerHTML = meta.keys + '<i class="md-en">' + meta.keysEn + "</i>";
    this.finaleText.innerHTML = meta.quote + '<i class="md-en">' + meta.quoteEn + "</i>";
    const figure = this.finaleEl.querySelector<HTMLImageElement>(".md-finale-figure");
    if (figure) figure.src = `/props/type-${id}.png`;
  }

  // 终幕开场：三句题词以竖排列常驻显示，活动句按阅读节奏自动轮播高亮（不再播放念白音频，仅保留纯 BGM）
  private playFinaleQuotes() {
    const token = ++this.finaleToken;
    this.finaleQuoteEl.innerHTML = FINALE_QUOTE.map((q, idx) =>
      `<span class="mq-line" data-idx="${idx}">${q.zh}</span>`
    ).join("");
    this.finaleQuoteEl.classList.remove("hidden");
    const setActive = (idx: number) => {
      this.finaleQuoteEl.querySelectorAll<HTMLElement>(".mq-line").forEach((el) => {
        el.classList.toggle("active", Number(el.dataset.idx) === idx);
      });
    };
    let i = 0;
    // 每句阅读时长按字数估算：基础 2.6s + 每字 0.18s
    const dwell = (zh: string) => 2600 + zh.length * 180;
    const next = () => {
      if (token !== this.finaleToken) return;
      if (i >= FINALE_QUOTE.length) {
        // 轮播结束：保留题词显示，仅取消高亮
        this.finaleQuoteEl.querySelectorAll<HTMLElement>(".mq-line").forEach((el) => el.classList.remove("active"));
        return;
      }
      setActive(i);
      const wait = dwell(FINALE_QUOTE[i].zh);
      i++;
      setTimeout(next, wait);
    };
    next();
  }

  // 终幕背景音乐：与主线 BGM 同一条音轨（用户要求「不做单独的设置」），不再切换
  private startFinaleBgm() {
    // No-op：终幕期间沿用已经在播放的主线 BGM
  }
  private stopFinaleBgm() {
    // No-op：主线 BGM 由 replay / endExperience 统一停止
  }

  // 主线背景音乐（瑞鸣音乐·牡丹亭）：从 beginGame 一直循环播放至终幕，
  // 仅在音游 rhythm 状态期间暂停（让音游 BGM 主导），退出音游后继续。
  private startStoryBgm() {
    if (!this.storyBgm) {
      this.storyBgm = new Audio("/audio/main/story-bgm.mp3");
      this.storyBgm.loop = true;
      this.storyBgm.volume = 0.42;
    }
    if (this.storyBgm.paused) {
      this.storyBgm.play().catch(() => {});
    }
  }
  private pauseStoryBgm() {
    if (this.storyBgm && !this.storyBgm.paused) {
      this.storyBgm.pause();
    }
  }
  private resumeStoryBgm() {
    if (this.storyBgm && this.storyBgm.paused) {
      this.storyBgm.play().catch(() => {});
    }
  }
  private stopStoryBgm() {
    if (this.storyBgm) {
      this.storyBgm.pause();
      this.storyBgm.currentTime = 0;
    }
  }

  private replay() {
    this.finaleEl.classList.add("hidden");
    this.finaleToken++;
    this.finaleQuoteEl.classList.add("hidden");
    this.stopFinaleBgm();
    this.clearSay();
    this.clearVoices();
    this.puppetGlow(false);
    this.mirrorEl.classList.remove("filled-hands", "filled-feet", "filled-torso", "blurred", "assembling");
    this.doorGlowEl.classList.remove("lit", "knocking", "flood");
    this.doorGlowEl.classList.add("hidden");
    this.fragmentHands = this.fragmentFeet = this.fragmentTorso = false;
    this.assmHands = this.assmFeet = false;
    this.rippleStarted = false;
    this.knockCount = 0;
    this.knockStarted = false;
    this.doorBlocked = false;
    this.wasAtDoor = false;
    this.behavior = {
      knockIntervals: [], lastKnockAt: -1, walkDist: 0,
      dirChanges: 0, lastDir: 0, knockAt: -1, clickPromptAt: -1, mirrorClickAt: -1,
    };
    stopAllVoices();
    this.knockTimer = 0;
    this.dialogueToken++;
    this.currentDialogueDone = null;
    this.hideSkipButton();
    this.act2Shown = false;
    this.hideClickPrompt();
    this.act3Shown = false;
    this.gardenTextT = -1;
    this.clearDisplay();
    this.running = false;
    if (this.theatreEl) {
      unmountRhythm(this.rhythmRoot);
      this.rhythmRoot = null;
      this.theatreEl.remove();
      this.theatreEl = null;
    }
    this.hideLevelChoice();
    this.currentRhythmLevel = 1;
    this.charX = CHAMBER.start;
    this.facing = 1;
    fx.setAmbient("dust");
    this.actTitle("第一幕 · 幽闭闺房", "Act I · The Secluded Chamber");
    this.enter("approach");
  }

  private endExperience() {
    this.finaleEl.classList.add("hidden");
    this.finaleToken++;
    this.finaleQuoteEl.classList.add("hidden");
    this.stopFinaleBgm();
    this.stopStoryBgm();
    this.hideSkipButton();
    this.puppetGlow(false);
    this.dimEl.classList.remove("lit");
    this.clearSay();
    this.clearVoices();
    fx.setAmbient("none");
    this.say("幕落。", undefined, "The curtain falls.");
  }
  update(dt: number) {
    this.mx += (this.tmx - this.mx) * 0.06;
    this.my += (this.tmy - this.my) * 0.06;

    const inTheatre = this.state === "rhythm";
    if (!inTheatre) {
      this.handleMove(dt);
      this.tickState(dt);
      // gardenTalk/talkEnd 期间不再偏移镜头，让人物始终居于画面中央
      this.camOff += (CAM_FOLLOW - this.camOff) * Math.min(1, dt * 3);
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
    const noMove: string[] = ["rewardHands","gardenTalk","talkEnd","rewardFeet","assemble","rewardTorso","finale"];
    if (noMove.includes(this.state)) { this.puppet?.setState("idle"); return; }
    let dir = 0;
    if (this.keys.right) dir += 1;
    if (this.keys.left) dir -= 1;
    if (dir !== 0) {
      if (this.behavior.lastDir !== 0 && dir !== this.behavior.lastDir) this.behavior.dirChanges++;
      this.behavior.lastDir = dir;
      this.behavior.walkDist += WALK_SPEED * dt;
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
            window.setTimeout(() => {
              this.doorBlocked = false;
              this.enter("rewardHands");
            }, 1800);
          }
        }
        this.wasAtDoor = atDoor;
        break;
      }
      case "rewardHands": {
        this.timer += dt;
        if (this.timer >= REWARD_HOLD) this.enter("freeRoam");
        break;
      }
      case "freeRoam": {
        if (!this.act2Shown && this.charX > SEAM1) {
          this.act2Shown = true;
          this.actTitle("第二幕 · 花园", "Act II · The Garden");
          this.setDisplay("不到园林，怎知春色如许", "Never having entered the garden, how could I have known such spring splendor?");
          this.gardenTextT = 0;
          // 完整播放入园 quote 音频，字幕跟随音频结束才消失（不再用固定 10s 计时器截断）
          playGardenQuote(() => {
            if (this.state === "freeRoam") {
              this.gardenTextT = -1;
              this.clearDisplay();
            }
          });
        }
        if (this.gardenTextT >= 0) {
          this.gardenTextT += dt;
          // 兜底：若音频 ended 事件因故未触发（如加载失败），20s 后强制清屏
          if (this.gardenTextT >= 20) {
            this.gardenTextT = -1;
            this.clearDisplay();
          }
        }
        if (this.charX >= THEATRE.center - TALK_ZONE) this.enter("gardenTalk");
        break;
      }
      case "rhythm": break;
      // 花园对白由 runDialogue 按音频结束事件逐句推进，无需计时器
      case "gardenTalk": break;
      case "talkEnd": break;
      case "rewardFeet": {
        this.timer += dt;
        if (this.timer >= REWARD_HOLD) this.enter("toMirror");
        break;
      }
      case "toMirror": {
        if (!this.act3Shown && this.charX > SEAM2) {
          this.act3Shown = true;
          this.actTitle("第三幕 · 花园", "Act III · The Garden");
        }
        if (Math.abs(this.charX - GARDEN.mirror) <= MIRROR_ZONE) this.enter("assemble");
        break;
      }
      // 镜前对白由 runDialogue 按音频结束事件逐句推进，播完进入 startAssemble
      case "assemble": break;
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
