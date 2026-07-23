/** @jsxImportSource @webspatial/react-sdk */
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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

const contractAddress = process.env.NEXT_PUBLIC_NFT_CONTRACT_ADDRESS as
  | Address
  | undefined;

function short(value?: string) {
  return value ? `${value.slice(0, 7)}…${value.slice(-5)}` : "";
}

function Experience() {
  const [playing, setPlaying] = useState(true);
  const [watched, setWatched] = useState(false);
  const [cycle, setCycle] = useState(0);
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending: isConnecting, error: connectError } =
    useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const {
    writeContract,
    data: hash,
    isPending: isWriting,
    error: writeError,
  } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({
    chainId: injectiveTestnet.id,
    hash,
  });

  const walletReady = Boolean(walletConnectProjectId && connectors.length);
  const contractReady = Boolean(contractAddress);
  const success = receipt.isSuccess;

  const replay = () => {
    setWatched(false);
    setPlaying(true);
    setCycle((value) => value + 1);
  };

  const connectWallet = () => {
    if (!connectors[0]) return;
    connect({ connector: connectors[0], chainId: injectiveTestnet.id });
  };

  const mint = async () => {
    if (!contractAddress) return;
    if (chainId !== injectiveTestnet.id) {
      await switchChainAsync({ chainId: injectiveTestnet.id });
    }
    writeContract({
      address: contractAddress,
      abi: shadowRelicAbi,
      functionName: "mint",
      chainId: injectiveTestnet.id,
    });
  };

  const primaryAction = !walletReady
    ? { label: "需要配置 WalletConnect", action: undefined }
    : !watched
      ? { label: "请先看完本折", action: undefined }
      : !isConnected
        ? {
            label: isConnecting ? "正在生成二维码…" : "手机扫码连接钱包",
            action: connectWallet,
          }
        : !contractReady
          ? { label: "需要配置合约地址", action: undefined }
          : {
              label: isWriting
                ? "请在手机钱包确认…"
                : receipt.isLoading
                  ? "等待 Injective 确认…"
                  : success
                    ? "藏品已铸成"
                    : "铸造《武将出关》",
              action: success || isWriting || receipt.isLoading ? undefined : mint,
            };

  const status = success
    ? `铸造成功 · ${short(hash)}`
    : writeError
      ? writeError instanceof BaseError
        ? writeError.shortMessage
        : writeError.message
      : connectError
        ? connectError.message
        : !walletReady
          ? "在 .env.local 中填写 NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID 后启用扫码连接。"
          : isConnected
            ? `已连接 ${short(address)} · Chain ${chainId}`
            : "动画结束后，使用手机 MetaMask 扫描 WalletConnect 二维码。";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-seal" aria-hidden="true">影</div>
          <div>
            <h1>幕影铸梦</h1>
            <p>SHADOW RELIC · SPATIAL EDITION</p>
          </div>
        </div>
        <div className="network-pill"><i />INJECTIVE EVM TESTNET · 1439</div>
      </header>

      <section className="experience-grid">
        <div className="stage-card" enable-xr>
          <div className="stage-label"><span />第一折 · 武将出关</div>
          <div className="canvas-wrap">
            <ShadowStage
              playing={playing}
              cycle={cycle}
              onComplete={() => {
                setPlaying(false);
                setWatched(true);
              }}
            />
          </div>
          <div className="stage-hint">WEBSPATIAL VOLUMETRIC STAGE<br />TRANSMISSION · DEPTH · SHADOW</div>
        </div>

        <aside className="side-card" enable-xr>
          <div className="eyebrow">一幕一藏 · DEMO 01</div>
          <h2>看完一折，<br />带走一影。</h2>
          <p className="lede">
            暖光穿过彩色皮影，武将从雕柱之后走上幕前。
            看完演出，即可把这一折铸成 Injective 测试网上的文化藏品。
          </p>

          <div className="timeline" aria-label="体验进度">
            <div className={`step ${watched ? "done" : "active"}`}>
              <div className="step-dot">01</div>
              <div><strong>观看《武将出关》</strong><small>{watched ? "演出完成" : "固定动画播放中"}</small></div>
            </div>
            <div className={`step ${isConnected ? "done" : watched ? "active" : ""}`}>
              <div className="step-dot">02</div>
              <div><strong>手机扫码连接</strong><small>{isConnected ? short(address) : "WalletConnect · MetaMask"}</small></div>
            </div>
            <div className={`step ${success ? "done" : isConnected ? "active" : ""}`}>
              <div className="step-dot">03</div>
              <div><strong>铸造文化藏品</strong><small>{success ? "Injective 已确认" : "ERC-721 · Testnet 1439"}</small></div>
            </div>
          </div>

          <button
            className="action-button"
            disabled={!primaryAction.action}
            onClick={primaryAction.action}
          >
            {primaryAction.label}
          </button>
          <button className="secondary-button" onClick={isConnected ? () => disconnect() : replay}>
            {isConnected ? "断开钱包" : "重播本折"}
          </button>
          <div className={`status-box ${success ? "success" : writeError || connectError ? "error" : ""}`}>
            {status}
            {success && hash ? (
              <>
                <br />
                <a
                  href={`${injectiveTestnet.blockExplorers.default.url}/tx/${hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  在区块浏览器查看 ↗
                </a>
              </>
            ) : null}
          </div>
          <div className="footer-note">
            PICO OS 6 · STANDALONE WEBSPATIAL APP<br />
            演示交易使用 Injective EVM Testnet，不涉及真实资产。
          </div>
        </aside>
      </section>
    </main>
  );
}

export default function ShadowplayApp() {
  const queryClient = useMemo(() => new QueryClient(), []);
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Experience />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
