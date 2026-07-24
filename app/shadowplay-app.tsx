/** @jsxImportSource @webspatial/react-sdk */
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import ShadowStage from "./shadow-stage";
import {
  injectiveTestnet,
  shadowRelicAbi,
  wagmiConfig,
  walletConnectProjectId,
} from "./web3";

const contractAddress = process.env.NEXT_PUBLIC_NFT_CONTRACT_ADDRESS as Address | undefined;
const SHOW_DURATION = 12.7;
const BEATS = [1.4, 2.8, 5.3, 7.1, 9.3, 11.35];

function short(value?: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "";
}

function Experience() {
  const [playing, setPlaying] = useState(false);
  const [watched, setWatched] = useState(false);
  const [started, setStarted] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [progress, setProgress] = useState(0);
  const [cue, setCue] = useState("穿廊入园");
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [judgment, setJudgment] = useState("");
  const judgedBeats = useRef(new Set<number>());
  const [panelOpen, setPanelOpen] = useState(false);
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const {
    writeContract,
    data: hash,
    isPending: isWriting,
    error: writeError,
  } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ chainId: injectiveTestnet.id, hash });

  const walletReady = Boolean(walletConnectProjectId && connectors.length);
  const success = receipt.isSuccess;

  const startGame = useCallback(() => {
    setProgress(0);
    setCue("穿廊入园");
    setWatched(false);
    setStarted(true);
    setScore(0);
    setCombo(0);
    setBestCombo(0);
    setJudgment("");
    judgedBeats.current = new Set();
    setPlaying(true);
    setCycle((value) => value + 1);
  }, []);

  const strike = useCallback(() => {
    if (!started || !playing) return;
    const now = progress * SHOW_DURATION;
    let nearest = -1;
    let distance = Number.POSITIVE_INFINITY;
    BEATS.forEach((beat, index) => {
      const delta = Math.abs(beat - now);
      if (!judgedBeats.current.has(index) && delta < distance) {
        nearest = index;
        distance = delta;
      }
    });
    if (nearest < 0 || distance > 0.55) {
      setCombo(0);
      setJudgment("失拍");
      return;
    }
    judgedBeats.current.add(nearest);
    const perfect = distance <= 0.22;
    setJudgment(perfect ? "绝" : "妙");
    setScore((value) => value + (perfect ? 100 : 60) + combo * 10);
    setCombo((value) => {
      const next = value + 1;
      setBestCombo((best) => Math.max(best, next));
      return next;
    });
  }, [combo, playing, progress, started]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.code !== "Enter") return;
      event.preventDefault();
      if (!started || watched) startGame();
      else strike();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [startGame, started, strike, watched]);

  useEffect(() => {
    if (!judgment) return;
    const timeout = window.setTimeout(() => setJudgment(""), 520);
    return () => window.clearTimeout(timeout);
  }, [judgment]);

  const connectWallet = () => {
    if (connectors[0]) connect({ connector: connectors[0], chainId: injectiveTestnet.id });
  };

  const mint = async () => {
    if (!contractAddress) return;
    if (chainId !== injectiveTestnet.id) await switchChainAsync({ chainId: injectiveTestnet.id });
    writeContract({
      address: contractAddress,
      abi: shadowRelicAbi,
      functionName: "mint",
      chainId: injectiveTestnet.id,
    });
  };

  const primaryAction = !watched
    ? { label: "待演", action: undefined }
    : !walletReady
    ? { label: "待配置", action: undefined }
    : !isConnected
      ? { label: isConnecting ? "扫码中" : "连接", action: connectWallet }
      : !contractAddress
        ? { label: "待部署", action: undefined }
        : {
            label: isWriting || receipt.isLoading ? "铸造中" : success ? "已铸" : "铸",
            action: success || isWriting || receipt.isLoading ? undefined : mint,
          };

  const status = success
    ? `藏品已铸成 · ${short(hash)}`
    : writeError
      ? writeError instanceof BaseError ? writeError.shortMessage : writeError.message
      : connectError
        ? connectError.message
        : isConnected
          ? `${short(address)} · Injective 1439`
          : "手机钱包扫码连接";

  return (
    <main className="garden-shell">
      <section className="world" enable-xr>
        <ShadowStage
          playing={playing}
          cycle={cycle}
          onStrike={strike}
          onProgress={(value, label) => {
            setProgress(value);
            setCue(label);
          }}
          onComplete={() => {
            setPlaying(false);
            setWatched(true);
          }}
        />
      </section>

      <button
        className={`rhythm-strike ${judgment ? `is-${judgment}` : ""}`}
        onClick={!started || watched ? startGame : strike}
        aria-label={!started || watched ? "开始演出" : "击打节拍"}
      >
        {!started ? (
          <><b>开演</b><small>点击 / 空格 / 扳机</small></>
        ) : watched ? (
          <><b>{score >= 480 ? "绝" : score >= 300 ? "妙" : "凡"}</b><small>{score} 分 · 再演一折</small></>
        ) : (
          <><i style={{ "--beat": `${Math.max(0, 1 - Math.min(...BEATS.map((beat) => Math.abs(beat - progress * SHOW_DURATION))) / 1.1)}` } as React.CSSProperties} /><b>{judgment || "合"}</b></>
        )}
      </button>

      {started && !watched ? (
        <div className="score-hud">
          <span>得分 <b>{score}</b></span>
          <span>连击 <b>{combo}</b></span>
        </div>
      ) : null}

      {judgment ? <div className="judgment-pop" key={`${judgment}-${score}`}>{judgment}</div> : null}

      <header className="garden-header">
        <div className="garden-title">
          <span className="title-mark">园</span>
          <div>
            <h1>园中影</h1>
            <p>SHADOWS IN THE GARDEN</p>
          </div>
        </div>
        <div className="act-label">
          <span>壹</span>
          <p>第一折<br /><b>{cue}</b></p>
        </div>
      </header>

      <div className="network-status">
        <i />
        INJECTIVE EVM · 1439
      </div>

      <div className="show-progress" aria-label={`演出进度 ${Math.round(progress * 100)}%`}>
        <button onClick={playing ? () => setPlaying(false) : startGame} aria-label={playing ? "暂停演出" : "开始演出"}>
          {playing ? "Ⅱ" : "▶"}
        </button>
        <div className="progress-track"><i style={{ width: `${progress * 100}%` }} /></div>
        <span>{String(Math.floor(progress * 12.7)).padStart(2, "0")} / 13</span>
      </div>

      <nav className="ritual-actions" aria-label="空间与藏品操作">
        <button className="round-action" onClick={() => setPanelOpen((value) => !value)}>
          <span className="vr-glyph">◉</span>
          <small>入境</small>
        </button>
        <button
          className={`round-action ${isConnected ? "connected" : ""}`}
          onClick={isConnected ? () => disconnect() : connectWallet}
          disabled={!walletReady}
        >
          <span className="wallet-glyph">▣</span>
          <small>{isConnected ? "已连" : "连接"}</small>
        </button>
        <button className="mint-seal" onClick={primaryAction.action} disabled={!primaryAction.action}>
          <b>{primaryAction.label}</b>
        </button>
      </nav>

      <aside className={`garden-panel ${panelOpen ? "open" : ""}`} enable-xr>
        <button className="panel-close" onClick={() => setPanelOpen(false)} aria-label="关闭说明">×</button>
        <p className="panel-kicker">WEBSPATIAL · 第一折</p>
        <h2>月门照影，<br />一折入链。</h2>
        <p>
          方块搭起白墙黛瓦、曲廊月门与临水庭院。
          曜灵穿行其间，园林构件以真实深度遮挡纸片皮影。
        </p>
        <dl>
          <div><dt>演出</dt><dd>{watched ? `${score} 分 · ${bestCombo} 连击` : cue}</dd></div>
          <div><dt>钱包</dt><dd>{isConnected ? short(address) : "未连接"}</dd></div>
          <div><dt>藏品</dt><dd>{success ? "Injective 已确认" : "ERC-721 测试网"}</dd></div>
        </dl>
        <div className={`panel-status ${success ? "success" : writeError || connectError ? "error" : ""}`}>
          {status}
          {success && hash ? (
            <a href={`${injectiveTestnet.blockExplorers.default.url}/tx/${hash}`} target="_blank" rel="noreferrer">
              查看交易 ↗
            </a>
          ) : null}
        </div>
        <button className="replay-link" onClick={startGame}>重游此园 · 重播演出</button>
      </aside>

      <div className="corner-note">
        PICO WEBSPATIAL<br />DEPTH · LIGHT · SHADOW
      </div>
    </main>
  );
}

export default function ShadowplayApp() {
  const queryClient = useMemo(() => new QueryClient(), []);
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  if (!mounted) return <main className="garden-shell loading-garden"><span>园中影</span></main>;

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Experience />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
