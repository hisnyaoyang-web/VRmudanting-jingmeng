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
  injectiveTestnet,
  shadowRelicAbi,
  wagmiConfig,
  walletConnectProjectId,
} from "./web3";

const contractAddress = process.env.NEXT_PUBLIC_NFT_CONTRACT_ADDRESS as Address | undefined;
const SHOW_DURATION = 12.7;
const SCRIPT: Array<{
  at: number;
  command: PuppetCommand;
  title: string;
  line: string;
  key: string;
}> = [
  { at: 1.4, command: "hi", title: "月下见礼", line: "武生入月门，拱手见礼。", key: "J" },
  { at: 3.1, command: "right", title: "过桥寻影", line: "向右移步，莫惊水中月。", key: "D / →" },
  { at: 5.3, command: "run", title: "急追灯火", line: "脚下生风，疾行三步。", key: "K" },
  { at: 7.1, command: "flying", title: "飞袖惊鸿", line: "临水飞袖，此处须稳。", key: "L" },
  { at: 9.3, command: "left", title: "回身归园", line: "向左回身，藏入竹影。", key: "A / ←" },
  { at: 11.35, command: "hi", title: "谢幕留白", line: "再行一礼，灯暗戏终。", key: "J" },
];

const GUESTS = [
  { name: "沈掌柜", role: "茶商 · 求稳", image: "/characters/merchant-shen.webp", idle: "这出戏，手上要准。" },
  { name: "云生", role: "游学书生 · 爱奇", image: "/characters/scholar-yun.webp", idle: "原来影子也会飞！" },
  { name: "罗夫人", role: "旧伶人 · 识戏", image: "/characters/madam-luo.webp", idle: "我只看你最后一袖。" },
];

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
  const [judged, setJudged] = useState(() => SCRIPT.map(() => false));
  const [puppet, setPuppet] = useState<{ x: number; y: number; action: PuppetAction; nonce: number }>({
    x: 0,
    y: 0,
    action: "walk",
    nonce: 0,
  });
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
    setJudged(SCRIPT.map(() => false));
    setPuppet({ x: 0, y: 0, action: "walk", nonce: 0 });
    judgedBeats.current = new Set();
    setPlaying(true);
    setCycle((value) => value + 1);
  }, []);

  const perform = useCallback((command: PuppetCommand) => {
    if (!started || !playing) return;
    setPuppet((current) => {
      const step = 0.42;
      const x = command === "left"
        ? Math.max(-2.3, current.x - step)
        : command === "right"
          ? Math.min(2.3, current.x + step)
          : current.x;
      const y = command === "up"
        ? Math.min(1.1, current.y + step)
        : command === "down"
          ? Math.max(-0.1, current.y - step)
          : current.y;
      const action: PuppetAction =
        command === "hi" || command === "run" || command === "flying" || command === "walk"
          ? command
          : "walk";
      return { x, y, action, nonce: current.nonce + 1 };
    });

    const now = progress * SHOW_DURATION;
    let nearest = -1;
    let distance = Number.POSITIVE_INFINITY;
    SCRIPT.forEach((beat, index) => {
      const delta = Math.abs(beat.at - now);
      if (!judgedBeats.current.has(index) && delta < distance) {
        nearest = index;
        distance = delta;
      }
    });
    if (nearest < 0 || distance > 0.72 || SCRIPT[nearest].command !== command) {
      setCombo(0);
      setJudgment("失拍");
      return;
    }
    judgedBeats.current.add(nearest);
    setJudged((items) => items.map((value, index) => index === nearest ? true : value));
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
      if (!started || watched) {
        if (event.code === "Space" || event.code === "Enter") {
          event.preventDefault();
          startGame();
        }
        return;
      }
      const commandByCode: Record<string, PuppetCommand> = {
        KeyA: "left", ArrowLeft: "left",
        KeyD: "right", ArrowRight: "right",
        KeyW: "up", ArrowUp: "up",
        KeyS: "down", ArrowDown: "down",
        KeyJ: "hi", Digit1: "hi",
        KeyK: "run", Digit2: "run",
        KeyL: "flying", Digit3: "flying",
      };
      const command = commandByCode[event.code];
      if (command) {
        event.preventDefault();
        perform(command);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [perform, startGame, started, watched]);

  useEffect(() => {
    if (!judgment) return;
    const timeout = window.setTimeout(() => setJudgment(""), 520);
    return () => window.clearTimeout(timeout);
  }, [judgment]);

  const handleProgress = useCallback((value: number, label: string) => {
    setProgress(value);
    setCue(label);
    const now = value * SHOW_DURATION;
    const missed = SCRIPT.findIndex(
      (item, index) => now > item.at + 0.72 && !judgedBeats.current.has(index),
    );
    if (missed >= 0) {
      judgedBeats.current.add(missed);
      setJudged((items) => items.map((value, index) => index === missed ? true : value));
      setCombo(0);
      setJudgment("失拍");
    }
  }, []);

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

  const showTime = progress * SHOW_DURATION;
  const currentScriptIndex = watched
    ? SCRIPT.length - 1
    : Math.min(
        SCRIPT.length - 1,
        SCRIPT.findIndex((item, index) => !judged[index] && item.at >= showTime - 0.72) < 0
          ? SCRIPT.length - 1
          : SCRIPT.findIndex((item, index) => !judged[index] && item.at >= showTime - 0.72),
      );
  const currentScript = SCRIPT[currentScriptIndex];
  const activeGuest = Math.min(2, Math.floor(progress * 3));
  const ending = score >= 500
    ? "罗夫人认出失传的飞袖，邀你去旧戏楼续演《灯影记》。"
    : score >= 300
      ? "云生把你的演法记进游记，明日会带来一份新剧本。"
      : "沈掌柜留下半盏冷茶：基本功尚在，再练一折便来复看。";

  return (
    <main className="garden-shell">
      <section className="world" enable-xr>
        <ShadowStage
          playing={playing}
          cycle={cycle}
          puppetInput={puppet}
          onXrCommand={perform}
          onProgress={handleProgress}
          onComplete={() => {
            setPlaying(false);
            setWatched(true);
          }}
        />
      </section>

      <button
        className={`rhythm-strike ${judgment ? `is-${judgment}` : ""}`}
        onClick={!started || watched ? startGame : () => perform(currentScript.command)}
        aria-label={!started || watched ? "开始演出" : `执行${currentScript.title}`}
      >
        {!started ? (
          <><b>开张</b><small>接下今晚的剧本</small></>
        ) : watched ? (
          <><b>{score >= 480 ? "绝" : score >= 300 ? "妙" : "凡"}</b><small>{score} 分 · 再演一折</small></>
        ) : (
          <><i style={{ "--beat": `${Math.max(0, 1 - Math.abs(currentScript.at - showTime) / 1.1)}` } as React.CSSProperties} /><b>{judgment || currentScript.key}</b></>
        )}
      </button>

      {started && !watched ? (
        <div className="score-hud">
          <span>得分 <b>{score}</b></span>
          <span>连击 <b>{combo}</b></span>
        </div>
      ) : null}

      {judgment ? <div className="judgment-pop" key={`${judgment}-${score}`}>{judgment}</div> : null}

      <aside className="script-board" enable-xr>
        <p>今夜剧本 ·《月门照影》</p>
        <h2>{watched ? "一折戏毕" : currentScript.title}</h2>
        <blockquote>{watched ? ending : currentScript.line}</blockquote>
        <ol>
          {SCRIPT.map((item, index) => (
            <li
              key={item.title}
              className={
                judged[index]
                  ? "done"
                  : index === currentScriptIndex
                    ? "current"
                    : ""
              }
            >
              <span>{index + 1}</span>
              <b>{item.title}</b>
              <kbd>{item.key}</kbd>
            </li>
          ))}
        </ol>
        <small>移动：WASD / 方向键　招式：J K L</small>
      </aside>

      <section className="spatial-audience" aria-label="今夜客人">
        {GUESTS.map((guest, index) => (
          <article
            key={guest.name}
            className={`guest-card ${index === activeGuest ? "active" : ""}`}
            enable-xr
          >
            <Image src={guest.image} alt={`${guest.name}立绘`} width={64} height={104} />
            <div>
              <small>{guest.role}</small>
              <h3>{guest.name}</h3>
              <p>
                {watched
                  ? index === (score >= 500 ? 2 : score >= 300 ? 1 : 0)
                    ? ending
                    : "静候下一折。"
                  : index === activeGuest && judgment
                    ? judgment === "失拍" ? "手上慢了半拍。" : "这一式有意思。"
                    : guest.idle}
              </p>
            </div>
          </article>
        ))}
      </section>

      <header className="garden-header">
        <div className="garden-title">
          <span className="title-mark">园</span>
          <div>
            <h1>园中影铺</h1>
            <p>SHADOW PUPPET SHOP</p>
          </div>
        </div>
        <div className="act-label">
          <span>壹</span>
          <p>掌柜上场<br /><b>{cue}</b></p>
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
