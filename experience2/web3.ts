/**
 * 区块链核心模块
 * - Injective EVM Testnet 链配置
 * - ShadowRelic 合约 ABI
 * - 钱包连接（浏览器扩展 EIP-1193 + WalletConnect 二维码）
 * - EIP-712 领奖凭证签名 + 链上 claim 交易
 */
import {
  createWalletClient, createPublicClient, http, custom, encodeFunctionData, defineChain,
  encodePacked, keccak256, parseAbi,
  type Address, type Hex, type WalletClient, type PublicClient,
} from "viem";
// defineChain imported from main viem module below
import { privateKeyToAccount } from "viem/accounts";
import {
  CHAIN_ID, NFT_CONTRACT_ADDRESS, GAME_SIGNER_PRIVATE_KEY,
  WALLETCONNECT_PROJECT_ID, RPC_URL, BLOCK_EXPLORER,
  STORY_ID, SEASON_ID, isWeb3Configured,
} from "./web3-config";

/** Injective EVM Testnet */
export const injectiveTestnet = defineChain({
  id: CHAIN_ID,
  name: "Injective EVM Testnet",
  nativeCurrency: { name: "Injective", symbol: "INJ", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Blockscout", url: BLOCK_EXPLORER } },
  testnet: true,
});

/** ShadowRelic.claim() ABI */
export const SHADOW_RELIC_ABI = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "player", type: "address" },
      { name: "storyId", type: "bytes32" },
      { name: "seasonId", type: "bytes32" },
      { name: "score", type: "uint32" },
      { name: "grade", type: "uint8" },
      { name: "nonce", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "event",
    name: "RelicClaimed",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "storyId", type: "bytes32", indexed: true },
      { name: "seasonId", type: "bytes32" },
      { name: "score", type: "uint32" },
      { name: "grade", type: "uint8" },
    ],
  },
] as const;

/** EIP-712 Claim 类型哈希（必须与合约一致） */
const CLAIM_TYPES = {
  Claim: [
    { name: "player", type: "address" },
    { name: "storyId", type: "bytes32" },
    { name: "seasonId", type: "bytes32" },
    { name: "score", type: "uint32" },
    { name: "grade", type: "uint8" },
    { name: "nonce", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export type ClaimResult = {
  txHash: string;
  tokenId?: string;
  blockExplorerUrl: string;
};

export type WalletInfo = {
  address: Address;
  chainId: number;
};

/** 生成随机 nonce */
function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
}

/**
 * 客户端签发 EIP-712 领奖凭证。
 * 用 GAME_SIGNER_PRIVATE_KEY 对 claim 结构签名，玩家钱包拿凭证去链上 mint。
 */
export function signVoucher(
  playerAddress: Address,
  score: number,
  grade: number,
): { nonce: Hex; deadline: bigint; signature: Hex; storyIdHash: Hex; seasonIdHash: Hex } | null {
  if (!GAME_SIGNER_PRIVATE_KEY || !NFT_CONTRACT_ADDRESS) return null;
  const account = privateKeyToAccount(GAME_SIGNER_PRIVATE_KEY as Hex);
  const nonce = randomNonce();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
  const storyIdHash = keccak256(encodePacked(["string"], [STORY_ID]));
  const seasonIdHash = keccak256(encodePacked(["string"], [SEASON_ID]));

  const domain = {
    name: "Shadow Relic",
    version: "1",
    chainId: CHAIN_ID,
    verifyingContract: NFT_CONTRACT_ADDRESS as Address,
  } as const;

  const message = {
    player: playerAddress,
    storyId: storyIdHash,
    seasonId: seasonIdHash,
    score,
    grade,
    nonce,
    deadline,
  };

  const signature = account.signTypedData({
    domain,
    types: CLAIM_TYPES,
    primaryType: "Claim",
    message,
  }) as Hex;

  // signTypedData is sync in viem for privateKeyToAccount, but TS may type it as Promise
  return { nonce, deadline, signature: signature as unknown as Hex, storyIdHash, seasonIdHash };
}

/**
 * 异步版本：signTypedData 在某些 viem 版本返回 Promise
 */
export async function signVoucherAsync(
  playerAddress: Address,
  score: number,
  grade: number,
): Promise<{ nonce: Hex; deadline: bigint; signature: Hex; storyIdHash: Hex; seasonIdHash: Hex } | null> {
  if (!GAME_SIGNER_PRIVATE_KEY || !NFT_CONTRACT_ADDRESS) return null;
  const account = privateKeyToAccount(GAME_SIGNER_PRIVATE_KEY as Hex);
  const nonce = randomNonce();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
  const storyIdHash = keccak256(encodePacked(["string"], [STORY_ID]));
  const seasonIdHash = keccak256(encodePacked(["string"], [SEASON_ID]));

  const domain = {
    name: "Shadow Relic",
    version: "1",
    chainId: CHAIN_ID,
    verifyingContract: NFT_CONTRACT_ADDRESS as Address,
  } as const;

  const message = {
    player: playerAddress,
    storyId: storyIdHash,
    seasonId: seasonIdHash,
    score,
    grade,
    nonce,
    deadline,
  };

  const signature = (await account.signTypedData({
    domain,
    types: CLAIM_TYPES,
    primaryType: "Claim",
    message,
  })) as Hex;

  return { nonce, deadline, signature, storyIdHash, seasonIdHash };
}

/**
 * 连接钱包（浏览器扩展或 WalletConnect）
 * 返回已连接的 WalletClient 和地址
 */
export async function connectWallet(): Promise<WalletInfo> {
  const provider = await getProvider();
  if (!provider) throw new Error("NO_WALLET");

  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];
  if (!accounts || accounts.length === 0) throw new Error("NO_ACCOUNT");

  const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
  const chainId = parseInt(chainIdHex, 16);

  const address = accounts[0] as Address;

  // 如果不在 Injective 链上，尝试切换
  if (chainId !== CHAIN_ID) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + CHAIN_ID.toString(16) }],
      });
    } catch (switchError: any) {
      // 链不存在，尝试添加
      if (switchError?.code === 4902) {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: "0x" + CHAIN_ID.toString(16),
            chainName: "Injective EVM Testnet",
            nativeCurrency: { name: "Injective", symbol: "INJ", decimals: 18 },
            rpcUrls: [RPC_URL],
            blockExplorerUrls: [BLOCK_EXPLORER],
          }],
        });
      } else {
        throw new Error("CHAIN_SWITCH_FAILED");
      }
    }
  }

  return { address, chainId: CHAIN_ID };
}

/** 获取 EIP-1193 provider（浏览器扩展或 WalletConnect） */
async function getProvider(): Promise<any> {
  // 优先使用浏览器注入的钱包
  if (typeof window !== "undefined" && (window as any).ethereum) {
    return (window as any).ethereum;
  }

  // 没有注入钱包时使用 WalletConnect
  if (WALLETCONNECT_PROJECT_ID) {
    return await connectWalletConnect();
  }

  return null;
}

/** WalletConnect 连接（弹出二维码） */
async function connectWalletConnect(): Promise<any> {
  const EthereumProvider = (await import("@walletconnect/ethereum-provider")).default;
  const provider = await EthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    chains: [CHAIN_ID],
    showQrModal: true,
    qrModalOptions: {
      themeMode: "dark",
      themeVariables: {
        "--wcm-accent-color": "#d98a3c",
        "--wcm-background-color": "#160a10",
      },
    },
    metadata: {
      name: "梦入牡丹亭",
      description: "寻回杜丽娘 · Web3 皮影体验",
      url: typeof window !== "undefined" ? window.location.origin : "https://localhost",
      icons: [typeof window !== "undefined" ? window.location.origin + "/favicon.svg" : ""],
    },
  });
  await provider.enable();
  return provider;
}

/**
 * 提交链上 claim 交易，铸造 NFT
 */
export async function mintRelic(
  provider: any,
  playerAddress: Address,
  score: number,
  grade: number,
): Promise<ClaimResult> {
  const voucher = await signVoucherAsync(playerAddress, score, grade);
  if (!voucher) throw new Error("VOUCHER_FAILED");

  const data = encodeClaimData(
    playerAddress,
    voucher.storyIdHash,
    voucher.seasonIdHash,
    score,
    grade,
    voucher.nonce,
    voucher.deadline,
    voucher.signature,
  );

  const txHash = (await provider.request({
    method: "eth_sendTransaction",
    params: [{
      from: playerAddress,
      to: NFT_CONTRACT_ADDRESS,
      data,
    }],
  })) as string;

  // 等待交易确认，尝试解析 tokenId
  const publicClient = createPublicClient({
    chain: injectiveTestnet,
    transport: http(RPC_URL),
  });

  let tokenId: string | undefined;
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash as Hex,
      timeout: 120_000,
      confirmations: 1,
    });
    // 从 Transfer 事件解析 tokenId
    const transferLog = receipt.logs.find((log) =>
      log.topics[0]?.toLowerCase() ===
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
    );
    if (transferLog?.topics[3]) {
      tokenId = BigInt(transferLog.topics[3]).toString();
    }
  } catch {
    // 交易可能仍在确认中，不阻塞
  }

  return {
    txHash,
    tokenId,
    blockExplorerUrl: BLOCK_EXPLORER + "/tx/" + txHash,
  };
}

/** 编码 claim() calldata */
function encodeClaimData(
  player: Address,
  storyId: Hex,
  seasonId: Hex,
  score: number,
  grade: number,
  nonce: Hex,
  deadline: bigint,
  signature: Hex,
): Hex {
  const claimAbi = parseAbi([
    "function claim(address player, bytes32 storyId, bytes32 seasonId, uint32 score, uint8 grade, bytes32 nonce, uint256 deadline, bytes signature) external returns (uint256)",
  ]);
  // 使用 viem 的 encodeFunctionData
  return encodeFunctionData({ abi: claimAbi, functionName: "claim", args: [
    player, storyId, seasonId, score, grade, nonce, deadline, signature,
  ]});
}


export { isWeb3Configured };
