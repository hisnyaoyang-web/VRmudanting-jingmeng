/** @jsxImportSource @webspatial/react-sdk */
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  WagmiProvider,
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { BaseError, type Address } from "viem";
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
import {
  injectiveTestnet,
  shadowRelicAbi,
  wagmiConfig,
  walletConnectProjectId,
} from "./web3";

const contractAddress = process.env.NEXT_PUBLIC_NFT_CONTRACT_ADDRESS as Address | undefined;
const DEFAULT_STORY_URL = "/stories/moongate-night/story.json";

function short(value?: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "";
}

function toPuppetCommand(action: StoryAction): PuppetCommand {
  return action === "salute" ? "hi" : action;
}

function actionKey(action: StoryAction) {
  return {
    left: "A / ←", right: "D / →", up: "W / ↑", down: "S / ↓",
    salute: "J", run: "K", flying: "L",
  }[action];
}

function Experience() {
  const [story, setStory] = useState<StoryPackage | null>(null);
  const [storyUrl, setStoryUrl] = useState(DEFAULT_STORY_URL);
  const [loadError, setLoadError] = useState("");
  const [phase, setPhase] = useState<"loading" | "intro" | "performance" | "outro">("loading");
  const [dialogueIndex, setDialogueIndex] = useState(0);
  const [dialogueChars, setDialogueChars] = useState(0);
  const [outro, setOutro] = useState<StoryBranch | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [progress, setProgress] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [judgment, setJudgment] = useState("");
  const [grade, setGrade] = useState<StoryGrade>("bad");
  const [judged, setJudged] = useState<boolean[]>([]);
  const judgedRef = useRef(new Set<number>());
  const scoreRef = useRef(0);
  const [puppet, setPuppet] = useState<{ x: number; y: number; action: PuppetAction; nonce: number }>({
    x: 0, y: 0, action: "walk", nonce: 0,
  });
  const [panelOpen, setPanelOpen] = useState(false);

  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContract, data: hash, isPending: isWriting, error: writeError } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ chainId: injectiveTestnet.id, hash });

  useEffect(() => {
    let cancelled = false;

    async function loadStory() {
      try {
        const requested = new URLSearchParams(window.location.search).get("story") || DEFAULT_STORY_URL;
        const resolved = new URL(requested, window.location.href);
        if (resolved.protocol !== "https:" && resolved.origin !== window.location.origin) {
          throw new Error("远程剧情必须使用 HTTPS");
        }

        const response = await fetch(resolved);
        if (!response.ok) throw new Error(`剧情加载失败：${response.status}`);
        const value: unknown = await response.json();
        const next = validateStory(value);
        if (cancelled) return;
        setStoryUrl(resolved.toString());
        setStory(next);
        setJudged(next.performance.cues.map(() => false));
        setPhase("intro");
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "剧情地址无效");
      }
    }

    void loadStory();
    return () => {
      cancelled = true;
    };
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
    setDialogueIndex(0);
    setDialogueChars(0);
    setPhase("performance");
    setProgress(0);
    setScore(0);
    scoreRef.current = 0;
    setCombo(0);
    setBestCombo(0);
    setGrade("bad");
    setJudgment("");
    setJudged(story.performance.cues.map(() => false));
    judgedRef.current = new Set();
    setPuppet({ x: 0, y: 0, action: "walk", nonce: 0 });
    setPlaying(true);
    setCycle((value) => value + 1);
  }, [story]);

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
  }, [dialogueBeats.length, dialogueComplete, dialogueContent.length, dialogueIndex, phase, startPerformance]);

  const showTimeMs = progress * (story?.performance.durationMs ?? 1);
  const cues = story?.performance.cues ?? [];
  const nextCueIndex = cues.findIndex((_, index) => !judged[index]);
  const currentCueIndex = nextCueIndex < 0 ? Math.max(0, cues.length - 1) : nextCueIndex;
  const currentCue = cues[currentCueIndex];

  const perform = useCallback((command: PuppetCommand) => {
    if (!story || phase !== "performance" || !playing) return;
    setPuppet((current) => {
      const step = 0.42;
      const x = command === "left" ? Math.max(-2.3, current.x - step)
        : command === "right" ? Math.min(2.3, current.x + step) : current.x;
      const y = command === "up" ? Math.min(1.1, current.y + step)
        : command === "down" ? Math.max(-0.1, current.y - step) : current.y;
      const action: PuppetAction =
        command === "hi" || command === "run" || command === "flying" || command === "walk" ? command : "walk";
      return { x, y, action, nonce: current.nonce + 1 };
    });

    let nearest = -1;
    let distance = Number.POSITIVE_INFINITY;
    story.performance.cues.forEach((cue, index) => {
      const delta = Math.abs(cue.atMs - showTimeMs);
      if (!judgedRef.current.has(index) && delta < distance) {
        nearest = index;
        distance = delta;
      }
    });
    if (nearest < 0) return;
    const cue = story.performance.cues[nearest];
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
    setJudgment(perfect ? "绝" : "妙");
    setCombo((value) => {
      const next = value + 1;
      setBestCombo((best) => Math.max(best, next));
      return next;
    });
  }, [phase, playing, showTimeMs, story]);

  const finishPerformance = useCallback(() => {
    if (!story) return;
    setPlaying(false);
    const maxScore = story.performance.cues.reduce((sum, cue) => sum + cue.points, 0);
    const ratio = maxScore > 0 ? scoreRef.current / maxScore : 0;
    const nextGrade = gradeScore(story, ratio);
    const history = recordGrade(story.customerId, nextGrade);
    setGrade(nextGrade);
    setOutro(resolveBranch(story, nextGrade, ratio, history));
    setDialogueIndex(0);
    setDialogueChars(0);
    setPhase("outro");
  }, [story]);

  const handleProgress = useCallback((value: number) => {
    if (!story) return;
    setProgress(value);
    const now = value * story.performance.durationMs;
    const missed = story.performance.cues.findIndex(
      (cue, index) => now > cue.atMs + cue.windowMs / 2 && !judgedRef.current.has(index),
    );
    if (missed >= 0) {
      judgedRef.current.add(missed);
      setJudged((items) => items.map((item, index) => index === missed ? true : item));
      setCombo(0);
      setJudgment("失拍");
    }
  }, [story]);

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
        perform(command);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
  const castEntries = Object.entries(story?.cast ?? {});
  const currentSpeakerKey = phase === "performance" ? performanceLine?.speaker : dialogueBeat?.speaker;
  const currentSpeaker = currentSpeakerKey ? story?.cast[currentSpeakerKey] : undefined;
  const customerEntries = castEntries.filter(([key, member]) => key !== "narrator" && key !== "shopkeeper" && member.portrait);

  const walletReady = Boolean(walletConnectProjectId && connectors.length);
  const success = receipt.isSuccess;
  const connectWallet = () => connectors[0] && connect({ connector: connectors[0], chainId: injectiveTestnet.id });
  const mint = async () => {
    if (!contractAddress) return;
    if (chainId !== injectiveTestnet.id) await switchChainAsync({ chainId: injectiveTestnet.id });
    writeContract({ address: contractAddress, abi: shadowRelicAbi, functionName: "mint", chainId: injectiveTestnet.id });
  };
  const primaryAction = phase !== "outro" ? { label: "待演", action: undefined }
    : !walletReady ? { label: "待配置", action: undefined }
      : !isConnected ? { label: isConnecting ? "扫码中" : "连接", action: connectWallet }
        : !contractAddress ? { label: "待部署", action: undefined }
          : { label: isWriting || receipt.isLoading ? "铸造中" : success ? "已铸" : "铸", action: success ? undefined : mint };
  const walletStatus = success ? `藏品已铸成 · ${short(hash)}`
    : writeError ? writeError instanceof BaseError ? writeError.shortMessage : writeError.message
      : connectError ? connectError.message
        : isConnected ? `${short(address)} · Injective 1439` : "手机钱包扫码连接";

  if (phase === "loading") {
    return (
      <main className="garden-shell loading-garden">
        <span>{loadError || "正在开铺…"}</span>
      </main>
    );
  }

  const xrBase = { "--xr-background-material": "none" } as React.CSSProperties;
  const gradeLabel = grade === "excellent" ? "绝" : grade === "good" ? "妙" : "凡";

  return (
    <main className="garden-shell" enable-xr-monitor>
      <section className="world" enable-xr style={{ ...xrBase, "--xr-back": "0", "--xr-depth": "180" } as React.CSSProperties}>
        <ShadowStage
          playing={playing}
          cycle={cycle}
          durationMs={story!.performance.durationMs}
          puppetInput={puppet}
          onXrCommand={perform}
          onProgress={(value) => handleProgress(value)}
          onComplete={finishPerformance}
        />
      </section>

      {(phase === "intro" || phase === "outro") && dialogueBeat ? (
        <button
          className="gal-dialogue"
          enable-xr
          style={{ ...xrBase, "--xr-back": "150", "--xr-depth": "24", "--xr-z-index": "50" } as React.CSSProperties}
          onClick={advanceDialogue}
        >
          {currentSpeaker?.portrait ? (
            <Image
              src={resolveAsset(storyUrl, story!, currentSpeaker.portrait)}
              alt={currentSpeaker.name}
              width={260}
              height={360}
              unoptimized
            />
          ) : null}
          <span>
            <small>{phase === "intro" ? "客人上场" : `演出结局 · ${gradeLabel}`}</small>
            <b>{currentSpeaker?.name ?? "旁白"}</b>
            <p>{dialogueVisible}<i /></p>
            <em>{dialogueComplete ? "点击继续" : "点击显示全文"}</em>
          </span>
        </button>
      ) : null}

      {phase === "performance" && currentCue ? (
        <button
          className={`rhythm-strike ${judgment ? `is-${judgment}` : ""}`}
          enable-xr
          style={{
            "--beat": `${Math.max(0, 1 - Math.abs(currentCue.atMs - showTimeMs) / Math.max(1, currentCue.windowMs))}`,
            "--xr-back": "155", "--xr-depth": "20", "--xr-z-index": "45",
            "--xr-background-material": "none",
          } as React.CSSProperties}
          onClick={() => perform(toPuppetCommand(currentCue.action))}
        >
          <i /><b>{judgment || actionKey(currentCue.action)}</b><small>{currentCue.label}</small>
        </button>
      ) : null}

      {phase === "performance" ? (
        <div className="performance-subtitle" enable-xr style={{ ...xrBase, "--xr-back": "120", "--xr-z-index": "38" } as React.CSSProperties}>
          <small>{currentSpeaker?.name ?? "旁白"}</small>
          <p>{performanceText}</p>
        </div>
      ) : null}

      <aside className="script-board" enable-xr style={{ ...xrBase, "--xr-back": "85", "--xr-depth": "24" } as React.CSSProperties}>
        <p>今夜剧本 ·《{story!.title}》</p>
        <h2>{phase === "outro" ? outro?.id : phase === "intro" ? "客人入座" : currentCue?.label}</h2>
        <blockquote>
          {phase === "intro" ? "听客人开口，再点灯开演。"
            : phase === "outro" ? `本场 ${score} 分 · 最高 ${bestCombo} 连击`
              : performanceLine?.text ?? "候场。"}
        </blockquote>
        <ol>
          {cues.map((cue, index) => (
            <li key={cue.id} className={judged[index] ? "done" : index === currentCueIndex ? "current" : ""}>
              <span>{index + 1}</span><b>{cue.label}</b><kbd>{actionKey(cue.action)}</kbd>
            </li>
          ))}
        </ol>
        <small>移动：WASD / 方向键　招式：J K L</small>
      </aside>

      <section className="spatial-audience" aria-label="今夜客人">
        {customerEntries.map(([key, member], index) => (
          <article
            key={key}
            className={`guest-card ${currentSpeakerKey === key ? "active" : ""}`}
            enable-xr
            style={{ ...xrBase, "--xr-back": `${50 + index * 12}`, "--xr-depth": "22" } as React.CSSProperties}
          >
            <Image src={resolveAsset(storyUrl, story!, member.portrait)} alt={`${member.name}立绘`} width={64} height={104} unoptimized />
            <div><small>{story!.customerId}</small><h3>{member.name}</h3><p>{currentSpeakerKey === key ? dialogueBeat?.text : "静候演出。"}</p></div>
          </article>
        ))}
      </section>

      {phase === "performance" ? (
        <div className="score-hud" enable-xr style={{ ...xrBase, "--xr-back": "110" } as React.CSSProperties}>
          <span>得分 <b>{score}</b></span><span>连击 <b>{combo}</b></span>
        </div>
      ) : null}
      {judgment ? <div className="judgment-pop" enable-xr>{judgment}</div> : null}

      <header className="garden-header">
        <div className="garden-title"><span className="title-mark">园</span><div><h1>园中影铺</h1><p>STORY API · {story!.schemaVersion}</p></div></div>
        <div className="act-label"><span>壹</span><p>{phase === "intro" ? "上场" : phase === "performance" ? "演出" : "谢幕"}<br /><b>{story!.title}</b></p></div>
      </header>

      <div className="network-status"><i /> STORY · {story!.id}</div>
      <div className="show-progress"><button onClick={phase === "performance" ? () => setPlaying((value) => !value) : startPerformance}>{playing ? "Ⅱ" : "▶"}</button><div className="progress-track"><i style={{ width: `${progress * 100}%` }} /></div><span>{Math.floor(showTimeMs / 1000)} / {Math.round(story!.performance.durationMs / 1000)}</span></div>

      <nav className="ritual-actions">
        <button className="round-action" onClick={() => setPanelOpen((value) => !value)}><span>◉</span><small>信息</small></button>
        <button className={`round-action ${isConnected ? "connected" : ""}`} onClick={isConnected ? () => disconnect() : connectWallet} disabled={!walletReady}><span>▣</span><small>{isConnected ? "已连" : "连接"}</small></button>
        <button className="mint-seal" onClick={primaryAction.action} disabled={!primaryAction.action}><b>{primaryAction.label}</b></button>
      </nav>

      <aside className={`garden-panel ${panelOpen ? "open" : ""}`} enable-xr>
        <button className="panel-close" onClick={() => setPanelOpen(false)}>×</button>
        <p className="panel-kicker">CONTENT-DRIVEN STORY</p><h2>{story!.title}</h2>
        <p>剧情、台词、动作判定与结局分支均来自外部 JSON。当前客人已演出 {loadHistory(story!.customerId).playCount} 次。</p>
        <div className={`panel-status ${success ? "success" : ""}`}>{walletStatus}</div>
        <button className="replay-link" onClick={startPerformance}>重演此折</button>
      </aside>
      <div className="corner-note">PICO WEBSPATIAL<br />STORY RUNTIME · 1.0</div>
    </main>
  );
}

export default function ShadowplayApp() {
  const queryClient = useMemo(() => new QueryClient(), []);
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  if (!mounted) return <main className="garden-shell loading-garden"><span>园中影</span></main>;
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}><Experience /></QueryClientProvider>
    </WagmiProvider>
  );
}
