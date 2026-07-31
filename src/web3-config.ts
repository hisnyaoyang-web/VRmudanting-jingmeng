/**
 * 区块链配置
 *
 * 第一个项目沿用自身的终幕入口与视觉风格，但改为使用第二个项目同款的
 * WalletConnect + 直接 mint 流程，避免在前端暴露签名私钥。
 */

/** Injective EVM Testnet Chain ID */
export const CHAIN_ID = 1439;

/** ShadowRelic NFT 合约地址（从 Vite 环境变量读取） */
export const NFT_CONTRACT_ADDRESS = (import.meta.env.VITE_NFT_CONTRACT_ADDRESS ?? "").trim();

/** WalletConnect Project ID（在 https://cloud.reown.com 创建） */
export const WALLETCONNECT_PROJECT_ID = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "").trim();

/** 站点地址，用于 WalletConnect 元数据 */
export const SITE_URL = (import.meta.env.VITE_SITE_URL ?? "").trim();

/** RPC URL */
export const RPC_URL = "https://k8s.testnet.json-rpc.injective.network/";

/** 区块浏览器 */
export const BLOCK_EXPLORER = "https://testnet.blockscout.injective.network";

export function hasWalletConnectProjectId(): boolean {
  return WALLETCONNECT_PROJECT_ID.length > 0;
}

export function hasContractAddress(): boolean {
  return NFT_CONTRACT_ADDRESS.length > 0;
}

/** 检查 Web3 铸造闭环是否已配置 */
export function isWeb3Configured(): boolean {
  return hasWalletConnectProjectId() && hasContractAddress();
}
