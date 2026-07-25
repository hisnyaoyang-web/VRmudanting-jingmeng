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
import { DIFFICULTIES, playableCues, type Difficulty, type RunInput } from "./game-rules";
import {
  injectiveTestnet,
  shadowRelicAbi,
  wagmiConfig,
  walletConnectProjectId,
} from "./web3";

const contractAddress = process.env.NEXT_PUBLIC_NFT_CONTRACT_ADDRESS as Address | undefined;
const DEFAULT_STORY_URL = "/stories/moongate-night/story.json";
const PERFORMANCE_LEAD_IN_MS = 3000;
const RHYTHM_DROP_MS = 3000;
const RHYTHM_LANES = ["W", "A", "S", "D", "J", "K", "L"] as const;
const CONTROL_KEYS: Array<{ key: (typeof RHYTHM_LANES)[number]; command: PuppetCommand; label: string }> = [
  { key: "W", command: "up", label: "前" },
  { key: "A", command: "left", label: "左" },
  { key: "S", command: "down", label: "后" },
  { key: "D", command: "right", label: "右" },
  { key: "J", command: "hi", label: "见礼" },
  { key: "K", command: "run", label: "疾行" },
  { key: "L", command: "flying", label: "飞袖" },
];

type ClaimVoucher = {
  player: Address;
  storyId: `0x${string}`;
  seasonId: `0x${string}`;
  score: number;
  grade: number;
  nonce: `0x${string}`;
  deadline: string;
  signature: `0x${string}`;
};

type LeaderboardEntry = {
  rank: number;
  address: string;
  score: number;
  grade: StoryGrade;
  difficulty: Difficulty;
};

function short(value?: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "";
}

function toPuppetCommand(action: StoryAction): PuppetCommand {
  return action === "salute" ? "hi" : action;
}

function actionControlKey(action: StoryAction) {
  return {
    left: "A", right: "D", up: "W", down: "S",
    salute: "J", run: "K", flying: "L",
  }[action];
}

function Experience() {
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
  const [, setBestCombo] = useState(0);
  const [judgment, setJudgment] = useState("");
  const [grade, setGrade] = useState<StoryGrade>("bad");
  const [judged, setJudged] = useState<boolean[]>([]);
  const judgedRef = useRef(new Set<number>());
  const scoreRef = useRef(0);
  const heldDirections = useRef(new Set<PuppetCommand>());
  const [puppet, setPuppet] = useState<{ x: number; y: number; action: PuppetAction; nonce: number }>({
    x: 0, y: 0, action: "walk", nonce: 0,
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const [endingReady, setEndingReady] = useState(false);
  const [relicStatus, setRelicStatus] = useState<"idle" | "generating" | "ready" | "error">("idle");
  const [relicImage, setRelicImage] = useState("");
  const [relicError, setRelicError] = useState("");
  const [claimAttempt, setClaimAttempt] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty>("stage");
  const [fragments, setFragments] = useState(0);
  const [verifiedMessage, setVerifiedMessage] = useState("");
  const [voucher, setVoucher] = useState<ClaimVoucher | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [holderUnlocked, setHolderUnlocked] = useState(false);
  const [inWebXr, setInWebXr] = useState(false);
  const [webXrAvailable, setWebXrAvailable] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const runIdRef = useRef("");
  const runEventsRef = useRef<RunInput[]>([]);
  const claimedHashRef = useRef("");

  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContract, data: hash, isPending: isWriting, error: writeError } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ chainId: injectiveTestnet.id, hash });

  useEffect(() => {
    const syncFullscreen = () => {
      setFullscreen(Boolean(document.fullscreenElement));
      setFullscreenError("");
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      }
    } catch {
      setFullscreenError("无法全屏");
      window.setTimeout(() => setFullscreenError(""), 1800);
    }
  }, []);

  useEffect(() => {
    if (!address) return;
    fetch(`/api/v1/progress/${address}`)
      .then(async (response) => response.json() as Promise<{
        data?: {
          stories?: Array<{ story_id: string; fragments: number }>;
          unlocks?: Array<{ unlock_id: string }>;
        };
      }>)
      .then((payload) => {
        const item = payload.data?.stories?.find((entry) => entry.story_id === "moongate-night");
        setFragments(item?.fragments || 0);
        setHolderUnlocked(Boolean(payload.data?.unlocks?.some((entry) => entry.unlock_id === "relic:moongate-night")));
      })
      .catch(() => undefined);
  }, [address]);

  useEffect(() => {
    if (!panelOpen) return;
    fetch("/api/v1/leaderboard?storyId=moongate-night&limit=5")
      .then(async (response) => response.json() as Promise<{ data?: { entries?: LeaderboardEntry[] } }>)
      .then((payload) => setLeaderboard(payload.data?.entries || []))
      .catch(() => setLeaderboard([]));
  }, [panelOpen]);

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

  const startPerformance = useCallback((forcePlay = false) => {
    if (!story) return;
    const shouldPlay = forcePlay || !webXrAvailable;
    runIdRef.current = "";
    runEventsRef.current = [];
    setVoucher(null);
    setVerifiedMessage("");
    if (shouldPlay) {
      fetch("/api/v1/runs/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storyId: story.id, difficulty }),
      })
        .then(async (response) => {
          const payload = await response.json() as { data?: { runId?: string } };
          if (response.ok && payload.data?.runId) runIdRef.current = payload.data.runId;
        })
        .catch(() => setVerifiedMessage("离线演出：本局不会进入排行榜"));
    }
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
    setJudged(playableCues(story, difficulty).map(() => false));
    judgedRef.current = new Set();
    setPuppet({ x: 0, y: 0, action: "walk", nonce: 0 });
    setEndingReady(false);
    setRelicStatus("idle");
    setRelicImage("");
    setRelicError("");
    setClaimAttempt(0);
    claimedHashRef.current = "";
    setPlaying(shouldPlay);
    setCycle((value) => value + 1);
  }, [difficulty, story, webXrAvailable]);

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

  const showTimeMs = progress * ((story?.performance.durationMs ?? 1) + PERFORMANCE_LEAD_IN_MS) - PERFORMANCE_LEAD_IN_MS;
  const cues = useMemo(() => story ? playableCues(story, difficulty) : [], [difficulty, story]);
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
    setJudgment(perfect ? "绝" : "妙");
    setCombo((value) => {
      const next = value + 1;
      setBestCombo((best) => Math.max(best, next));
      return next;
    });
  }, [cues, phase, playing, showTimeMs, story]);

  const tapCommand = useCallback((key: string, command: PuppetCommand) => {
    setActiveKey(key);
    perform(command);
    window.setTimeout(() => setActiveKey((value) => value === key ? "" : value), 420);
  }, [perform]);

  const handleXrPrimary = useCallback(() => {
    if (phase === "intro" || phase === "outro") {
      advanceDialogue();
      return;
    }
    perform("hi");
  }, [advanceDialogue, perform, phase]);

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
    const maxScore = playableCues(story, difficulty).reduce((sum, cue) => sum + cue.points, 0);
    const ratio = maxScore > 0 ? scoreRef.current / maxScore : 0;
    const nextGrade = gradeScore(story, ratio);
    const history = recordGrade(story.customerId, nextGrade);
    setGrade(nextGrade);
    setOutro(resolveBranch(story, nextGrade, ratio, history));
    setDialogueIndex(0);
    setDialogueChars(0);
    setPhase("outro");
    setEndingReady(false);
    if (runIdRef.current) {
      fetch("/api/v1/runs/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: runIdRef.current, address, events: runEventsRef.current }),
      })
        .then(async (response) => {
          const payload = await response.json() as {
            data?: {
              score: number; grade: StoryGrade;
              progress?: { fragments?: number };
              voucher?: ClaimVoucher | null;
              eligibility?: string;
            };
            error?: { message?: string };
          };
          if (!response.ok || !payload.data) throw new Error(payload.error?.message || "成绩验证失败");
          setScore(payload.data.score);
          setGrade(payload.data.grade);
          setFragments(payload.data.progress?.fragments || 0);
          setVoucher(payload.data.voucher || null);
          setVerifiedMessage(
            payload.data.voucher ? "成绩已验证，影灵领取凭证已签发"
              : payload.data.eligibility === "collect_fragments"
                ? `成绩已验证 · 影纹 ${payload.data.progress?.fragments || 0}/3`
                : payload.data.eligibility === "excellent_required"
                  ? "成绩已验证 · 达到「绝」即可铸造"
                  : "成绩已验证",
          );
        })
        .catch((error) => setVerifiedMessage(error instanceof Error ? error.message : "成绩验证失败"));
    }
  }, [address, difficulty, story]);

  const handleXrSessionChange = useCallback((active: boolean, completed = false) => {
    setInWebXr(active);
    if (active) {
      startPerformance(true);
      return;
    }
    if (!completed && phase === "performance") {
      setPlaying(false);
      runIdRef.current = "";
      setVerifiedMessage("演出已中止 · 再次登台将重新计分");
    }
  }, [phase, startPerformance]);

  useEffect(() => {
    if (phase !== "outro") return;
    const timer = window.setTimeout(() => setEndingReady(true), 1800);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const handleProgress = useCallback((value: number) => {
    if (!story) return;
    setProgress(value);
    const now = value * (story.performance.durationMs + PERFORMANCE_LEAD_IN_MS) - PERFORMANCE_LEAD_IN_MS;
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

  useEffect(() => {
    if (!receipt.isSuccess || !hash || !address || !story || claimedHashRef.current === hash) return;
    claimedHashRef.current = hash;
    const controller = new AbortController();
    setRelicStatus("generating");
    setRelicError("");
    setPanelOpen(true);

    fetch("/api/relic/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        txHash: hash,
        address,
        grade,
        score,
        storyId: story.id,
        storyTitle: story.title,
      }),
    })
      .then(async (response) => {
        const result = await response.json() as { error?: string; imageUrl?: string };
        if (!response.ok || !result.imageUrl) throw new Error(result.error || "虚拟形象生成失败");
        setRelicImage(result.imageUrl);
        setRelicStatus("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        claimedHashRef.current = "";
        setRelicError(error instanceof Error ? error.message : "虚拟形象生成失败");
        setRelicStatus("error");
      });

    return () => controller.abort();
  }, [address, claimAttempt, grade, hash, receipt.isSuccess, score, story]);

  const walletReady = Boolean(walletConnectProjectId && connectors.length);
  const visibleFragments = address ? fragments : 0;
  const visibleHolderUnlock = Boolean(address && holderUnlocked);
  const success = relicStatus === "ready";
  const connectWallet = () => connectors[0] && connect({ connector: connectors[0], chainId: injectiveTestnet.id });
  const mint = async () => {
    if (!contractAddress || !voucher || !address) return;
    if (chainId !== injectiveTestnet.id) await switchChainAsync({ chainId: injectiveTestnet.id });
    writeContract({
      address: contractAddress,
      abi: shadowRelicAbi,
      functionName: "claim",
      chainId: injectiveTestnet.id,
      args: [
        voucher.player, voucher.storyId, voucher.seasonId, voucher.score, voucher.grade,
        voucher.nonce, BigInt(voucher.deadline), voucher.signature,
      ],
    });
  };
  const primaryAction = phase !== "outro" ? { label: "待演", action: undefined }
    : !endingReady ? { label: "谢幕中", action: undefined }
    : !walletReady ? { label: "待配置", action: undefined }
      : !isConnected ? { label: isConnecting ? "扫码中" : "连接", action: connectWallet }
        : !contractAddress ? { label: "待部署", action: undefined }
          : !voucher ? { label: visibleFragments < 3 ? `${visibleFragments}/3` : "需绝", action: undefined }
            : relicStatus === "generating" ? { label: "塑形中", action: undefined }
            : relicStatus === "error" ? { label: "重试", action: () => setClaimAttempt((value) => value + 1) }
              : { label: isWriting || receipt.isLoading ? "铸造中" : success ? "已铸" : "铸", action: success ? undefined : mint };
  const walletStatus = success ? `专属藏品已生成 · ${short(hash)}`
    : relicStatus === "generating" ? "GPT-Image-2 正在塑造你的皮影化身…"
      : relicError ? relicError
        : writeError ? writeError instanceof BaseError ? writeError.shortMessage : writeError.message
          : connectError ? connectError.message
            : receipt.isSuccess ? `交易已确认 · ${short(hash)}`
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
    <main className={`garden-shell ${visibleHolderUnlock ? "relic-holder" : ""} ${inWebXr ? "xr-active" : ""}`} enable-xr-monitor>
      <section className="world" enable-xr style={{ ...xrBase, "--xr-back": "0", "--xr-depth": "180" } as React.CSSProperties}>
        <ShadowStage
          playing={playing}
          cycle={cycle}
          durationMs={story!.performance.durationMs + PERFORMANCE_LEAD_IN_MS}
          puppetInput={puppet}
          onXrCommand={perform}
          onXrPrimary={handleXrPrimary}
          onXrSessionChange={handleXrSessionChange}
          onXrSupportChange={setWebXrAvailable}
          onProgress={(value) => handleProgress(value)}
          onComplete={finishPerformance}
          xrHud={{
            phase,
            title: story!.title,
            speaker: currentSpeaker?.name ?? "旁白",
            text: phase === "performance" ? performanceText : dialogueVisible,
            score,
            combo,
            judgment,
            grade: gradeLabel,
            difficulty: DIFFICULTIES[difficulty].label,
            nextCue: rhythmNotes[0] ? `${rhythmNotes[0].key} · ${rhythmNotes[0].cue.label}` : "",
          }}
        />
      </section>

      {phase === "outro" ? (
        <div
          className="ending-transition"
          enable-xr
          style={{ ...xrBase, "--xr-back": "205", "--xr-depth": "30", "--xr-z-index": "70" } as React.CSSProperties}
        >
          <i /><span>一折既终</span><b>{gradeLabel}</b>
        </div>
      ) : null}

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
        <section
          className="rhythm-highway"
          enable-xr
          style={{ ...xrBase, "--xr-back": "230", "--xr-depth": "28", "--xr-z-index": "75" } as React.CSSProperties}
          aria-label="节奏轨道"
        >
          <div className="rhythm-lanes">
            {RHYTHM_LANES.map((key) => <i key={key}><span>{key}</span></i>)}
          </div>
          <div className="hit-line"><span>判定线</span></div>
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
        <section className="rhythm-keys" aria-label="演出按键">
          {CONTROL_KEYS.map((control) => (
            <button
              key={control.key}
              className={activeKey === control.key ? "pressed" : ""}
              onClick={() => tapCommand(control.key, control.command)}
            >
              <kbd>{control.key}</kbd><span>{control.label}</span>
            </button>
          ))}
        </section>
      </aside>
      <nav className="ritual-actions">
        <button className="round-action" onClick={() => setPanelOpen((value) => !value)}><span>◉</span><small>信息</small></button>
        <button className={`round-action ${isConnected ? "connected" : ""}`} onClick={isConnected ? () => disconnect() : connectWallet} disabled={!walletReady}><span>▣</span><small>{isConnected ? "已连" : "连接"}</small></button>
        <button className="mint-seal" onClick={primaryAction.action} disabled={!primaryAction.action}><b>{primaryAction.label}</b></button>
      </nav>

      {!inWebXr && !(webXrAvailable && phase === "performance") ? (
        <button
          className="fullscreen-toggle"
          type="button"
          onClick={toggleFullscreen}
          disabled={!document.fullscreenEnabled}
          aria-label={fullscreen ? "退出网页全屏" : "网页全屏"}
        >
          <span aria-hidden="true">{fullscreen ? "↙" : "⛶"}</span>
          {fullscreenError || (fullscreen ? "退出网页全屏" : "网页全屏（非 XR）")}
        </button>
      ) : null}

      <aside className={`garden-panel ${panelOpen ? "open" : ""}`} enable-xr>
        <button className="panel-close" onClick={() => setPanelOpen(false)}>×</button>
        <p className="panel-kicker">CONTENT-DRIVEN STORY</p><h2>{story!.title}</h2>
        <p>剧情、台词、动作判定与结局分支均来自外部 JSON。当前客人已演出 {loadHistory(story!.customerId).playCount} 次。</p>
        <div className="difficulty-picker" aria-label="演出难度">
          {(Object.keys(DIFFICULTIES) as Difficulty[]).map((id) => (
            <button
              key={id}
              className={difficulty === id ? "active" : ""}
              onClick={() => setDifficulty(id)}
              disabled={phase === "performance"}
            >
              {DIFFICULTIES[id].label}
            </button>
          ))}
        </div>
        <p className="verified-run">{verifiedMessage || `今日影纹 ${visibleFragments}/3 · 达到「绝」后可铸造`}</p>
        {visibleHolderUnlock ? <p className="holder-unlock">影灵共鸣 · 月白灯色与隐藏谢幕已解锁</p> : null}
        {relicImage ? (
          <div
            className="relic-preview"
            role="img"
            aria-label="你的专属皮影虚拟形象"
            style={{ backgroundImage: `url("${relicImage}")` }}
          />
        ) : null}
        <div className={`panel-status ${success ? "success" : ""}`}>{walletStatus}</div>
        <section className="leaderboard-mini" aria-label="本赛季排行榜">
          <h3>本季名角</h3>
          {leaderboard.length ? (
            <ol>
              {leaderboard.map((entry) => (
                <li key={`${entry.rank}-${entry.address}`}>
                  <span>{entry.rank}. {entry.address}</span><b>{entry.score}</b>
                </li>
              ))}
            </ol>
          ) : <p>尚待第一位名角登台</p>}
        </section>
        <button className="replay-link" onClick={() => startPerformance()}>重演此折</button>
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
