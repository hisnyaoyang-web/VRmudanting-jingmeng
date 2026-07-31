import { useEffect, useRef } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { BaseError } from "viem";
import { fx } from "./effects";
import { contractAddress, injectiveTestnet, shadowRelicAbi, walletConnectProjectId } from "./web3";

type NftPanelViewProps = {
  onClose: () => void;
};

function short(value?: string) {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "";
}

export function NftPanelView({ onClose }: NftPanelViewProps) {
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
  const receipt = useWaitForTransactionReceipt({
    chainId: injectiveTestnet.id,
    hash,
  });
  const didBurstRef = useRef(false);

  const walletReady = Boolean(walletConnectProjectId && connectors.length);
  const success = receipt.isSuccess;

  useEffect(() => {
    if (!success || didBurstRef.current) return;
    didBurstRef.current = true;
    fx.burst(window.innerWidth / 2, window.innerHeight / 2, 80, 44);
  }, [success]);

  useEffect(() => {
    if (!success) didBurstRef.current = false;
  }, [success, hash]);

  const connectWallet = () => {
    if (connectors[0]) {
      connect({
        connector: connectors[0],
        chainId: injectiveTestnet.id,
      });
    }
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
    ? { label: "待配置", action: undefined as (() => void) | undefined }
    : !isConnected
      ? { label: isConnecting ? "扫码中" : "连接钱包", action: connectWallet }
      : !contractAddress
        ? { label: "待部署", action: undefined }
        : success
          ? { label: "已铸造", action: undefined }
          : isWriting || receipt.isLoading
            ? { label: "铸造中", action: undefined }
            : { label: "铸造 NFT", action: mint };

  let status = "手机钱包扫码连接";
  if (!walletConnectProjectId) {
    status = "未配置 WalletConnect Project ID";
  } else if (writeError) {
    status = writeError instanceof BaseError ? writeError.shortMessage : writeError.message;
  } else if (connectError) {
    status = connectError instanceof BaseError ? connectError.shortMessage : connectError.message;
  } else if (success && hash) {
    status = `藏品已铸成 · ${short(hash)}`;
  } else if (isConnected) {
    status = `${short(address)} · Injective 1439`;
  } else if (!contractAddress) {
    status = "NFT 合约地址待配置";
  }

  return (
    <div className="nft-card nft-content">
      <div className="nft-icon">{success ? "\u2728" : "\uD83C\uDFAD"}</div>
      <h3>链上信物</h3>
      <p className="nft-desc">
        终幕已成。连接 Injective 钱包，把这一次梦境铸成链上的永久藏品。
      </p>
      <p className="nft-note">{status}</p>

      {isConnected ? (
        <p className="nft-wallet">{short(address)}</p>
      ) : null}

      {success && hash ? (
        <a
          className="nft-link"
          href={`${injectiveTestnet.blockExplorers.default.url}/tx/${hash}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          在 Blockscout 查看交易
        </a>
      ) : null}

      <div className="nft-btns">
        <button
          className="nft-btn nft-primary"
          type="button"
          onClick={primaryAction.action}
          disabled={!primaryAction.action}
        >
          {primaryAction.label}
        </button>
        <button className="nft-btn nft-ghost" type="button" onClick={onClose}>
          {success ? "完成" : "关闭"}
        </button>
        {isConnected && !success ? (
          <button className="nft-btn nft-ghost" type="button" onClick={() => disconnect()}>
            断开钱包
          </button>
        ) : null}
      </div>
    </div>
  );
}
