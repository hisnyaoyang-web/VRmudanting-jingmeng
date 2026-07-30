import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShadowStage, { type PuppetAction, type PuppetCommand } from "./shadow-stage";
import {
  gradeScore,
  loadHistory,
  recordGrade,
  resolveAsset,
  resolveBranch,
  validateStory,
  type DialogueBeat,
  type StoryAction,
  type StoryBranch,
  type StoryGrade,
  type StoryPackage,
} from "./story-runtime";
import { DIFFICULTIES, playableCues, type Difficulty, type RunInput } from "./game-rules";

// Faithful port of the original non-VR rhythm experience.
// Gameplay (falling notes, keyboard timing, perfect/good/miss scoring) is preserved
// verbatim from the reference game; only the Web3 (wallet/NFT/leaderboard) and
// WebSpatial/XR reward layers are removed so it embeds into the long-scroll show.

const DEFAULT_STORY_URL = "/stories/moongate-night/story.json";
const PERFORMANCE_LEAD_IN_MS = 3000;
const RHYTHM_DROP_MS = 3000;
const LEVEL_DURATION_MS = 45000; // 每关 45s（与 BGM 切片一致）
const RHYTHM_LANES = ["W", "A", "S", "D", "J", "K", "L"] as const;

// 三关 BGM（来自王璐·牡丹亭·游园·皂罗袍 不同片段）
const LEVEL_BGM: Record<number, string> = {
  1: "/audio/rhythm/level1.mp3",
  2: "/audio/rhythm/level2.mp3",
  3: "/audio/rhythm/level3.mp3",
};

// 把基础 chart 循环延展到目标时长，保持 note 密度
function extendCues<R extends { atMs: number; id: string }>(base: R[], durationMs: number): R[] {
  if (base.length === 0) return [];
  const sorted = [...base].sort((a, b) => a.atMs - b.atMs);
  const lastAt = sorted[sorted.length - 1].atMs;
  const cycleLength = Math.max(lastAt + 2000, 16000);
  const result: R[] = [];
  let cycle = 0;
  while (cycle * cycleLength < durationMs) {
    for (const cue of sorted) {
      const at = cue.atMs + cycle * cycleLength;
      if (at >= durationMs - 500) break;
      result.push({ ...cue, id: `${cue.id}_c${cycle}`, atMs: at });
    }
    cycle++;
    if (cycle > 10) break;
  }
  return result;
}
const CONTROL_KEYS: Array<{ key: (typeof RHYTHM_LANES)[number]; command: PuppetCommand; label: string; hint: string }> = [
  { key: "W", command: "up", label: "上移", hint: "杜丽娘向上抬步" },
  { key: "A", command: "left", label: "左移", hint: "杜丽娘向左移步" },
  { key: "S", command: "down", label: "下移", hint: "杜丽娘向下沉身" },
  { key: "D", command: "right", label: "右移", hint: "杜丽娘向右移步" },
  { key: "J", command: "hi", label: "见礼", hint: "杜丽娘敛衽揖拜" },
  { key: "K", command: "run", label: "疾行", hint: "杜丽娘碎步疾行" },
  { key: "L", command: "flying", label: "飞袖", hint: "杜丽娘挥袖起舞" },
];

function toPuppetCommand(action: StoryAction): PuppetCommand {
  return action === "salute" ? "hi" : action;
}

function actionControlKey(action: StoryAction) {
  return {
    left: "A", right: "D", up: "W", down: "S",
    salute: "J", run: "K", flying: "L",
  }[action];
}

export type RhythmExperienceProps = {
  /** Current rhythm level (1/2/3). Each level uses its own 45s BGM clip. */
  level?: 1 | 2 | 3;
  /** Called once the level finishes (45s elapsed). */
  onFinish?: (result: { level: number; grade: StoryGrade; score: number; ratio: number }) => void;
  /** Called when the player taps the in-game exit button. */
  onExit?: () => void;
  /** Initial difficulty. */
  difficulty?: Difficulty;
};

export function RhythmExperience({ level = 1, onFinish, onExit, difficulty: initialDifficulty = "stage" }: RhythmExperienceProps) {
  const bgmUrl = LEVEL_BGM[level] ?? LEVEL_BGM[1];
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const [story, setStory] = useState<StoryPackage | null>(null);
  const [storyUrl, setStoryUrl] = useState(DEFAULT_STORY_URL);
  const [loadError, setLoadError] = useState("");
  const [phase, setPhase] = useState<"loading" | "intro" | "performance" | "outro">("loading");
  const [activeKey, setActiveKey] = useState("");
  const [dialogueIndex, setDialogueIndex] = useState(0);
  const [dialogueChars, setDialogueChars] = useState(0);
  const [outro, setOutro] = useState<StoryBranch | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [progress, setProgress] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [judgment, setJudgment] = useState("");
  const [grade, setGrade] = useState<StoryGrade>("bad");
  const [judged, setJudged] = useState<boolean[]>([]);
  const judgedRef = useRef(new Set<number>());
  const scoreRef = useRef(0);
  const heldDirections = useRef(new Set<PuppetCommand>());
  const [puppet, setPuppet] = useState<{ x: number; y: number; action: PuppetAction; nonce: number }>({
    x: 0, y: 0, action: "walk", nonce: 0,
  });
  const [difficulty, setDifficulty] = useState<Difficulty>(initialDifficulty);
  const runEventsRef = useRef<RunInput[]>([]);
  const [endingReady, setEndingReady] = useState(false);
  // 防止 outro 谢幕期间多次触发 onFinish（按空格 + 自动 timer 去重）
  const endingFiredRef = useRef(false);
  // 花园三层视差背景：mid / front 为绿幕图，需 chroma key 去绿后才能使用
  const [bgMid, setBgMid] = useState<string | null>(null);
  const [bgFront, setBgFront] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    async function chromaKeyLayer(src: string): Promise<string | null> {
      try {
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          let a = d[i + 3];
          if (g >= 240 && r < 50 && b < 50) a = 0;
          else if (g >= 214 && r < 50 && b < 50) a = (a * (240 - g)) / 26;
          d[i + 3] = a;
        }
        ctx.putImageData(imageData, 0, 0);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob || cancelled) return null;
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        return url;
      } catch {
        return null;
      }
    }
    Promise.all([
      chromaKeyLayer("/scenes/s2-mid.png"),
      chromaKeyLayer("/scenes/s2-front.png"),
    ]).then(([mid, front]) => {
      if (cancelled) return;
      if (mid) setBgMid(mid);
      if (front) setBgFront(front);
    });
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadStory() {
      try {
        const response = await fetch(DEFAULT_STORY_URL);
        if (!response.ok) throw new Error(`剧本加载失败：${response.status}`);
        const value: unknown = await response.json();
        const next = validateStory(value);
        if (cancelled) return;
        setStoryUrl(DEFAULT_STORY_URL);
        setStory(next);
        setJudged(next.performance.cues.map(() => false));
        // 跳过 intro（掌柜/罗夫人情境对话），保持 loading 直到 startPerformance 触发
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "剧本地址无效");
      }
    }
    void loadStory();
    return () => { cancelled = true; };
  }, []);

  const dialogueBeats: DialogueBeat[] = phase === "outro" ? outro?.beats ?? [] : story?.intro.beats ?? [];
  const dialogueBeat = dialogueBeats[Math.min(dialogueIndex, Math.max(0, dialogueBeats.length - 1))];
  const dialogueContent = dialogueBeat?.text ?? "";
  const dialogueCps = phase === "intro" ? story?.intro.textPlayback.charsPerSecond ?? 6 : 7;
  const dialogueVisible = dialogueContent.slice(0, dialogueChars);
  const dialogueComplete = dialogueChars >= dialogueContent.length;

  useEffect(() => {
    if (!dialogueContent || dialogueComplete) return;
    const interval = window.setInterval(
      () => setDialogueChars((value) => Math.min(dialogueContent.length, value + 1)),
      Math.max(24, 1000 / Math.max(1, dialogueCps)),
    );
    return () => window.clearInterval(interval);
  }, [dialogueComplete, dialogueContent, dialogueCps]);

  const startPerformance = useCallback(() => {
    if (!story) return;
    runEventsRef.current = [];
    setDialogueIndex(0);
    setDialogueChars(0);
    setPhase("performance");
    setProgress(0);
    setScore(0);
    scoreRef.current = 0;
    setCombo(0);
    setGrade("bad");
    setJudgment("");
    setJudged(extendCues(playableCues(story, difficulty), LEVEL_DURATION_MS).map(() => false));
    judgedRef.current = new Set();
    setPuppet({ x: 0, y: 0, action: "walk", nonce: 0 });
    setPlaying(true);
    setCycle((value) => value + 1);
  }, [difficulty, story]);

  // 剧本就绪后直接进入 performance（跳过原 intro 掌柜/罗夫人对话）
  const perfStartedRef = useRef(false);
  useEffect(() => {
    if (story && !perfStartedRef.current) {
      perfStartedRef.current = true;
      startPerformance();
    }
  }, [story, startPerformance]);

  // performance 阶段播放当前关 BGM；切换关卡/退出时停止
  useEffect(() => {
    if (phase !== "performance" || !playing) return;
    const audio = new Audio(bgmUrl);
    audio.loop = false;
    audio.volume = 0.42;
    audio.play().catch(() => {});
    bgmRef.current = audio;
    return () => {
      audio.pause();
      audio.currentTime = 0;
      bgmRef.current = null;
    };
  }, [phase, playing, bgmUrl]);

  const advanceDialogue = useCallback(() => {
    if (!dialogueComplete) {
      setDialogueChars(dialogueContent.length);
      return;
    }
    if (dialogueIndex < dialogueBeats.length - 1) {
      setDialogueIndex((value) => value + 1);
      setDialogueChars(0);
    } else if (phase === "intro") {
      startPerformance();
    }
    // outro phase 已废弃：演出结束直接交棒给主流程奖励，不再走对话路径
  }, [dialogueBeats.length, dialogueComplete, dialogueContent.length, dialogueIndex, phase, startPerformance]);

  const showTimeMs = progress * (LEVEL_DURATION_MS + PERFORMANCE_LEAD_IN_MS) - PERFORMANCE_LEAD_IN_MS;
  const cues = useMemo(() => {
    if (!story) return [];
    const base = playableCues(story, difficulty);
    return extendCues(base, LEVEL_DURATION_MS);
  }, [difficulty, story]);
  const rhythmNotes = cues.flatMap((cue, index) => {
    if (judged[index]) return [];
    const deltaMs = cue.atMs - showTimeMs;
    if (deltaMs > RHYTHM_DROP_MS || deltaMs < -cue.windowMs / 2) return [];
    const key = actionControlKey(cue.action);
    const lane = RHYTHM_LANES.indexOf(key as (typeof RHYTHM_LANES)[number]);
    const fall = Math.max(0, Math.min(1, 1 - deltaMs / RHYTHM_DROP_MS));
    return [{ cue, deltaMs, key, lane, fall }];
  });

  const perform = useCallback((command: PuppetCommand) => {
    if (!story || phase !== "performance" || !playing) return;
    setPuppet((current) => {
      const step = 0.08;
      const x = command === "left" ? Math.max(-2.3, current.x - step)
        : command === "right" ? Math.min(2.3, current.x + step) : current.x;
      const y = command === "up" ? Math.min(1.1, current.y + step)
        : command === "down" ? Math.max(-0.1, current.y - step) : current.y;
      const action: PuppetAction =
        command === "hi" || command === "run" || command === "flying" || command === "walk" ? command : "walk";
      return { x, y, action, nonce: current.nonce + 1 };
    });
    const recordedAction = command === "hi" ? "salute"
      : command === "left" || command === "right" || command === "up" || command === "down"
        || command === "run" || command === "flying" ? command : null;
    if (recordedAction) runEventsRef.current.push({ action: recordedAction, atMs: Math.round(showTimeMs) });

    let nearest = -1;
    let distance = Number.POSITIVE_INFINITY;
    cues.forEach((cue, index) => {
      const delta = Math.abs(cue.atMs - showTimeMs);
      if (!judgedRef.current.has(index) && delta < distance) {
        nearest = index;
        distance = delta;
      }
    });
    if (nearest < 0) return;
    const cue = cues[nearest];
    const expected = toPuppetCommand(cue.action);
    if (expected !== command || distance > cue.windowMs / 2) {
      setCombo(0);
      setJudgment("失拍");
      return;
    }
    judgedRef.current.add(nearest);
    setJudged((items) => items.map((value, index) => index === nearest ? true : value));
    const precision = distance / (cue.windowMs / 2);
    const perfect = precision <= story.performance.scoring.perfectRatio;
    const gained = Math.round(cue.points * (perfect ? 1 : 0.7));
    scoreRef.current += gained;
    setScore(scoreRef.current);
    setJudgment(perfect ? "绝" : "如");
    setCombo((value) => value + 1);
  }, [cues, phase, playing, showTimeMs, story]);

  const tapCommand = useCallback((key: string, command: PuppetCommand) => {
    setActiveKey(key);
    perform(command);
    window.setTimeout(() => setActiveKey((value) => value === key ? "" : value), 420);
  }, [perform]);

  useEffect(() => {
    if (phase !== "performance" || !playing) return;
    let frame = 0;
    let previous = performance.now();
    const move = (now: number) => {
      const delta = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      const held = heldDirections.current;
      const horizontal = Number(held.has("right")) - Number(held.has("left"));
      const vertical = Number(held.has("up")) - Number(held.has("down"));
      if (horizontal || vertical) {
        setPuppet((current) => ({
          ...current,
          x: Math.max(-2.3, Math.min(2.3, current.x + horizontal * delta * 1.75)),
          y: Math.max(-0.1, Math.min(1.1, current.y + vertical * delta * 1.25)),
          action: "walk",
        }));
      }
      frame = window.requestAnimationFrame(move);
    };
    frame = window.requestAnimationFrame(move);
    return () => window.cancelAnimationFrame(frame);
  }, [phase, playing]);

  const finishPerformance = useCallback(() => {
    if (!story) return;
    if (endingFiredRef.current) return;
    endingFiredRef.current = true;
    setPlaying(false);
    // 停止 BGM
    if (bgmRef.current) {
      bgmRef.current.pause();
    }
    // 用延展后的 cue 列表计算 maxScore，保证 ratio 反映本关整体
    const maxScore = cues.reduce((sum, cue) => sum + cue.points, 0);
    const ratio = maxScore > 0 ? scoreRef.current / maxScore : 0;
    const nextGrade = gradeScore(story, ratio);
    recordGrade(story.customerId, nextGrade);
    setGrade(nextGrade);
    onFinish?.({ level, grade: nextGrade, score: scoreRef.current, ratio });
  }, [cues, story, onFinish, level]);

  const handleProgress = useCallback((value: number) => {
    if (!story) return;
    setProgress(value);
    const now = value * (LEVEL_DURATION_MS + PERFORMANCE_LEAD_IN_MS) - PERFORMANCE_LEAD_IN_MS;
    const missed = cues.findIndex(
      (cue, index) => now > cue.atMs + cue.windowMs / 2 && !judgedRef.current.has(index),
    );
    if (missed >= 0) {
      judgedRef.current.add(missed);
      setJudged((items) => items.map((item, index) => index === missed ? true : item));
      setCombo(0);
      setJudgment("失拍");
    }
  }, [cues, story]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (phase === "intro" || phase === "outro") {
        if (event.code === "Space" || event.code === "Enter") advanceDialogue();
        return;
      }
      const map: Record<string, PuppetCommand> = {
        KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
        KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down",
        KeyJ: "hi", Digit1: "hi", KeyK: "run", Digit2: "run", KeyL: "flying", Digit3: "flying",
      };
      const command = map[event.code];
      if (command) {
        event.preventDefault();
        const keyLabel: Partial<Record<PuppetCommand, string>> = {
          left: "A", right: "D", up: "W", down: "S", hi: "J", run: "K", flying: "L",
        };
        setActiveKey(keyLabel[command] ?? "");
        if (command === "left" || command === "right" || command === "up" || command === "down") {
          heldDirections.current.add(command);
        }
        if (event.repeat) return;
        perform(command);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const map: Record<string, PuppetCommand> = {
        KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
        KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down",
      };
      const command = map[event.code];
      if (command) {
        heldDirections.current.delete(command);
        setActiveKey("");
      }
    };
    const clearDirections = () => heldDirections.current.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearDirections);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearDirections);
    };
  }, [advanceDialogue, perform, phase]);

  useEffect(() => {
    if (!judgment) return;
    const timer = window.setTimeout(() => setJudgment(""), 520);
    return () => window.clearTimeout(timer);
  }, [judgment]);

  const performanceLine = story?.performance.lines
    .filter((line) => line.atMs <= showTimeMs)
    .at(-1);
  const performanceText = performanceLine
    ? performanceLine.text.slice(
        0,
        Math.max(1, Math.floor((showTimeMs - performanceLine.atMs) / 1000 * story!.performance.textPlayback.charsPerSecond)),
      )
    : "";
  const currentSpeakerKey = phase === "performance" ? performanceLine?.speaker : dialogueBeat?.speaker;
  const currentSpeaker = currentSpeakerKey ? story?.cast[currentSpeakerKey] : undefined;

  if (phase === "loading") {
    return (
      <main className="garden-shell loading-garden">
        <span>{loadError || `园中舞 · 第 ${level} 折 · 正在开锣……`}</span>
      </main>
    );
  }

  const gradeLabel = grade === "excellent" ? "绝" : grade === "good" ? "如" : "出";
  const playCount = story ? loadHistory(story.customerId).playCount : 0;

  return (
    <main className="garden-shell">
      <button
        type="button"
        className="rhythm-exit-btn"
        aria-label="退出音游"
        onClick={() => onExit?.()}
      >
        退出<i>Exit</i>
      </button>
      {bgMid ? (
        <div
          className="garden-layer mid"
          style={{ backgroundImage: `url("${bgMid}")` }}
          aria-hidden="true"
        />
      ) : null}
      {bgFront ? (
        <div
          className="garden-layer front"
          style={{ backgroundImage: `url("${bgFront}")` }}
          aria-hidden="true"
        />
      ) : null}
      <section className="world">
        <ShadowStage
          playing={playing}
          cycle={cycle}
          durationMs={LEVEL_DURATION_MS + PERFORMANCE_LEAD_IN_MS}
          puppetInput={puppet}
          onProgress={(value) => handleProgress(value)}
          onComplete={finishPerformance}
        />
      </section>

      {(phase === "intro" || phase === "outro") && dialogueBeat ? (
        <>
          {currentSpeaker?.portrait ? (
            <div className={`dialogue-portrait side-${currentSpeaker.side ?? "left"}`}>
              <img
                src={resolveAsset(storyUrl, story!, currentSpeaker.portrait)}
                alt={`${currentSpeaker.name}立绘`}
              />
            </div>
          ) : null}
          <button className="gal-dialogue" onClick={advanceDialogue}>
            <small>{phase === "intro" ? "客人上场" : `演出结局 · ${gradeLabel}`}</small>
            <b>{currentSpeaker?.name ?? "旁白"}</b>
            <p>{dialogueVisible}<i /></p>
            <em>{dialogueComplete ? (phase === "outro" && dialogueIndex >= dialogueBeats.length - 1 ? "继续旅程" : "点击继续") : "点击显示全文"}</em>
          </button>
        </>
      ) : null}

      {phase === "performance" ? (
        <section className="rhythm-highway" aria-label="节奏轨道">
          <div className="rhythm-lanes">
            {RHYTHM_LANES.map((key) => <i key={key}><span>{key}</span></i>)}
          </div>
          <div className="hit-line"><span>音符落到此线按键</span></div>
          {rhythmNotes.map(({ cue, deltaMs, key, lane, fall }) => (
            <article
              key={cue.id}
              className={deltaMs <= cue.windowMs / 2 ? "note-ready" : ""}
              style={{ left: `${(lane + .5) / RHYTHM_LANES.length * 100}%`, top: `${5 + fall * 88}%` }}
            >
              <b>{key}</b><small>{cue.label}</small>
            </article>
          ))}
        </section>
      ) : null}

      {phase === "performance" ? (
        <div className="rhythm-title">园中舞 · 第 {level} 折<i>Dance in the Garden · Level {level}</i></div>
      ) : null}

      {phase === "performance" ? (
        <div className="score-hud">
          <span>得分 <b>{score}</b></span><span>连击 <b>{combo}</b></span>
        </div>
      ) : null}
      {judgment ? <div className="judgment-pop">{judgment}</div> : null}

      <aside className="control-deck">
        <div className="rhythm-keys-row">
          <div className="rhythm-keys-group">
            <small className="rhythm-keys-label">位移 · 杜丽娘脚步</small>
            <section className="rhythm-keys" aria-label="位移按键">
              {CONTROL_KEYS.filter((c) => c.command === "up" || c.command === "down" || c.command === "left" || c.command === "right").map((control) => (
                <button
                  key={control.key}
                  className={activeKey === control.key ? "pressed" : ""}
                  onClick={() => tapCommand(control.key, control.command)}
                  title={control.hint}
                >
                  <kbd>{control.key}</kbd><span>{control.label}</span>
                </button>
              ))}
            </section>
          </div>
          <div className="rhythm-keys-group">
            <small className="rhythm-keys-label">动作 · 杜丽娘身段</small>
            <section className="rhythm-keys" aria-label="动作按键">
              {CONTROL_KEYS.filter((c) => c.command === "hi" || c.command === "run" || c.command === "flying").map((control) => (
                <button
                  key={control.key}
                  className={activeKey === control.key ? "pressed" : ""}
                  onClick={() => tapCommand(control.key, control.command)}
                  title={control.hint}
                >
                  <kbd>{control.key}</kbd><span>{control.label}</span>
                </button>
              ))}
            </section>
          </div>
        </div>
        <p className="control-hint">
          <span>位移 WASD = 控制杜丽娘走位</span>
          <i>·</i>
          <span>动作 JKL = 触发杜丽娘身段</span>
        </p>
        {(phase === "intro") ? (
          <div className="difficulty-picker" aria-label="演出难度">
            {(Object.keys(DIFFICULTIES) as Difficulty[]).map((id) => (
              <button key={id} className={difficulty === id ? "active" : ""} onClick={() => setDifficulty(id)}>
                {DIFFICULTIES[id].label}
              </button>
            ))}
          </div>
        ) : null}
      </aside>
    </main>
  );
}

export default RhythmExperience;
