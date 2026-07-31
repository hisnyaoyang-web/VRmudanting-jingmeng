/**
 * 区块链核心模块
 * - Injective EVM Testnet 链配置
 * - wagmi + WalletConnect 接入
 * - 简单 ERC-721 mint ABI
 *
 * 这里直接复用第二个项目的 Web3 接入方式，但暴露给第一个项目原有的终幕 UI。
 */
import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { defineChain, type Address } from "viem";
import {
  BLOCK_EXPLORER,
  CHAIN_ID,
  NFT_CONTRACT_ADDRESS,
  RPC_URL,
  SITE_URL,
  WALLETCONNECT_PROJECT_ID,
  isWeb3Configured,
} from "./web3-config";

/** Injective EVM Testnet */
export const injectiveTestnet = defineChain({
  id: CHAIN_ID,
  name: "Injective EVM Testnet",
  nativeCurrency: { name: "Injective", symbol: "INJ", decimals: 18 },
  rpcUrls: {
    default: {
      http: [RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: "Injective Testnet Explorer",
      url: BLOCK_EXPLORER,
    },
  },
  testnet: true,
});

function getSiteUrl() {
  if (SITE_URL) return SITE_URL;
  if (typeof window !== "undefined") return window.location.origin;
  return "https://localhost";
}

const connectors = WALLETCONNECT_PROJECT_ID && typeof window !== "undefined"
  ? [
      ...(typeof window !== "undefined" && (window as Window & { ethereum?: unknown }).ethereum
        ? [
            injected({
              shimDisconnect: true,
            }),
          ]
        : []),
      walletConnect({
        projectId: WALLETCONNECT_PROJECT_ID,
        showQrModal: true,
        metadata: {
          name: "梦入牡丹亭",
          description: "寻回杜丽娘 · Web3 皮影体验",
          url: getSiteUrl(),
          icons: [`${getSiteUrl()}/favicon.svg`],
        },
      }),
    ]
  : (typeof window !== "undefined" && (window as Window & { ethereum?: unknown }).ethereum
      ? [
          injected({
            shimDisconnect: true,
          }),
        ]
      : []);

export const wagmiConfig = createConfig({
  chains: [injectiveTestnet],
  connectors,
  transports: {
    [injectiveTestnet.id]: http(RPC_URL),
  },
});

export const walletConnectProjectId = WALLETCONNECT_PROJECT_ID;

export const contractAddress = NFT_CONTRACT_ADDRESS
  ? (NFT_CONTRACT_ADDRESS as Address)
  : undefined;

/** ShadowRelic.mint() ABI */
export const shadowRelicAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
] as const;

export { isWeb3Configured };
