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

function Experience() {
  const [story, setStory] = useState<StoryPackage | null>(null);
  const [storyUrl, setStoryUrl] = useState(DEFAULT_STORY_URL);
  const [loadError, setLoadError] = useState("");
  const [phase, setPhase] = useState<"loading" | "intro" | "countdown" | "performance" | "outro">("loading");
  const [countdown, setCountdown] = useState(3);
  const [activeKey, setActiveKey] = useState("");
  const [dialogueIndex, setDialogueIndex] = useState(0);
  const [dialogueChars, setDialogueChars] = useState(0);
  const [outro, setOutro] = useState<StoryBranch | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [progress, setProgress] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [, setBestCombo] = useState(0);
  const [judgment, setJudgment] = useState("");
  const [grade, setGrade] = useState<StoryGrade>("bad");
  const [, setJudged] = useState<boolean[]>([]);
  const judgedRef = useRef(new Set<number>());
  const scoreRef = useRef(0);
  const heldDirections = useRef(new Set<PuppetCommand>());
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
    setPhase("countdown");
    setCountdown(3);
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
    setPlaying(false);
  }, [story]);

  useEffect(() => {
    if (phase !== "countdown") return;
    const timer = window.setTimeout(() => {
      if (countdown > 1) {
        setCountdown((value) => value - 1);
      } else {
        setPhase("performance");
        setPlaying(true);
        setCycle((value) => value + 1);
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, phase]);

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
        <>
          {currentSpeaker?.portrait ? (
            <div
              className={`dialogue-portrait side-${currentSpeaker.side ?? "left"}`}
              enable-xr
              style={{ ...xrBase, "--xr-back": "175", "--xr-depth": "34", "--xr-z-index": "55" } as React.CSSProperties}
            >
              <Image
                src={resolveAsset(storyUrl, story!, currentSpeaker.portrait)}
                alt={`${currentSpeaker.name}立绘`}
                width={360}
                height={520}
                priority
                unoptimized
              />
            </div>
          ) : null}
          <button
            className="gal-dialogue"
            enable-xr
            style={{ ...xrBase, "--xr-back": "145", "--xr-depth": "22", "--xr-z-index": "50" } as React.CSSProperties}
            onClick={advanceDialogue}
          >
            <small>{phase === "intro" ? "客人上场" : `演出结局 · ${gradeLabel}`}</small>
            <b>{currentSpeaker?.name ?? "旁白"}</b>
            <p>{dialogueVisible}<i /></p>
            <em>{dialogueComplete ? "点击继续" : "点击显示全文"}</em>
          </button>
        </>
      ) : null}

      {phase === "performance" ? (
        <div className="performance-subtitle" enable-xr style={{ ...xrBase, "--xr-back": "120", "--xr-z-index": "38" } as React.CSSProperties}>
          <small>{currentSpeaker?.name ?? "旁白"}</small>
          <p>{performanceText}</p>
        </div>
      ) : null}

      {phase === "performance" ? (
        <div className="score-hud" enable-xr style={{ ...xrBase, "--xr-back": "110" } as React.CSSProperties}>
          <span>得分 <b>{score}</b></span><span>连击 <b>{combo}</b></span>
        </div>
      ) : null}
      {judgment ? <div className="judgment-pop" enable-xr>{judgment}</div> : null}

      <aside className="control-deck" enable-xr style={{ ...xrBase, "--xr-back": "190", "--xr-depth": "32", "--xr-z-index": "60" } as React.CSSProperties}>
        {phase === "countdown" ? (
          <div className="stage-countdown" key={countdown}>
            <small>演出即将开始</small><b>{countdown}</b>
          </div>
        ) : null}
        <section className="movement-keys" aria-label="移动按键">
          <button className={activeKey === "W" ? "pressed" : ""} onClick={() => tapCommand("W", "up")}><kbd>W</kbd><span>前</span></button>
          <button className={activeKey === "A" ? "pressed" : ""} onClick={() => tapCommand("A", "left")}><kbd>A</kbd><span>左</span></button>
          <button className={activeKey === "S" ? "pressed" : ""} onClick={() => tapCommand("S", "down")}><kbd>S</kbd><span>后</span></button>
          <button className={activeKey === "D" ? "pressed" : ""} onClick={() => tapCommand("D", "right")}><kbd>D</kbd><span>右</span></button>
        </section>
        <div className="deck-label"><i />按住<br />移动</div>
        <section className="action-keys" aria-label="招式按键">
          <button className={activeKey === "J" ? "pressed" : ""} onClick={() => tapCommand("J", "hi")}><kbd>J</kbd><span>见礼</span></button>
          <button className={activeKey === "K" ? "pressed" : ""} onClick={() => tapCommand("K", "run")}><kbd>K</kbd><span>疾行</span></button>
          <button className={activeKey === "L" ? "pressed" : ""} onClick={() => tapCommand("L", "flying")}><kbd>L</kbd><span>飞袖</span></button>
        </section>
      </aside>
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
