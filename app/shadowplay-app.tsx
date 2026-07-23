/** @jsxImportSource @webspatial/react-sdk */
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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

function short(value?: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "";
}

function Experience() {
  const [playing, setPlaying] = useState(true);
  const [watched, setWatched] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [progress, setProgress] = useState(0);
  const [cue, setCue] = useState("穿廊入园");
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

  const replay = () => {
    setProgress(0);
    setCue("穿廊入园");
    setWatched(false);
    setPlaying(true);
    setCycle((value) => value + 1);
  };

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

  const primaryAction = !walletReady
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
        <button onClick={playing ? () => setPlaying(false) : replay} aria-label={playing ? "暂停演出" : "重播演出"}>
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
          <div><dt>演出</dt><dd>{watched ? "已看完" : cue}</dd></div>
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
        <button className="replay-link" onClick={replay}>重游此园 · 重播演出</button>
      </aside>

      <div className="corner-note">
        PICO WEBSPATIAL<br />DEPTH · LIGHT · SHADOW
      </div>
    </main>
  );
}

export default function ShadowplayApp() {
  const queryClient = useMemo(() => new QueryClient(), []);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <main className="garden-shell loading-garden"><span>园中影</span></main>;

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Experience />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
