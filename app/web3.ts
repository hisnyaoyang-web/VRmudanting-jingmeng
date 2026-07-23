"use client";

import { createConfig, http } from "wagmi";
import { walletConnect } from "wagmi/connectors";
import { defineChain } from "viem";

export const injectiveTestnet = defineChain({
  id: 1439,
  name: "Injective EVM Testnet",
  nativeCurrency: { name: "Injective", symbol: "INJ", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://k8s.testnet.json-rpc.injective.network/"],
    },
  },
  blockExplorers: {
    default: {
      name: "Injective Testnet Explorer",
      url: "https://testnet.blockscout.injective.network",
    },
  },
  testnet: true,
});

export const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

const connectors = walletConnectProjectId
  ? [
      walletConnect({
        projectId: walletConnectProjectId,
        showQrModal: true,
        metadata: {
          name: "幕影铸梦",
          description: "WebSpatial × Injective 文化藏品 Demo",
          url:
            process.env.NEXT_PUBLIC_SITE_URL ??
            (typeof window === "undefined" ? "https://localhost" : window.location.origin),
          icons: [
            `${
              process.env.NEXT_PUBLIC_SITE_URL ??
              (typeof window === "undefined" ? "https://localhost" : window.location.origin)
            }/favicon.svg`,
          ],
        },
      }),
    ]
  : [];

export const wagmiConfig = createConfig({
  chains: [injectiveTestnet],
  connectors,
  transports: {
    [injectiveTestnet.id]: http(),
  },
});

export const shadowRelicAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
] as const;
