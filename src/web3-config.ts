/**
 * 区块链配置
 * 
 * 部署 ShadowRelic 合约后，在此填写地址与签名密钥。
 * 合约源码见 .ref-rhythm/contracts/src/ShadowRelic.sol
 * 部署方法见 README-wallet.md
 *
 * 未配置时 NFT 按钮显示「区块链功能待配置」，游戏其余部分正常。
 */

/** Injective EVM Testnet Chain ID */
export const CHAIN_ID = 1439;

/** ShadowRelic NFT 合约地址（部署后填写） */
export const NFT_CONTRACT_ADDRESS = "";

/** 游戏签名者私钥（0x 前缀，仅用于客户端签发领奖凭证）
 *  该地址必须已在合约中设为 gameSigner。
 *  生产环境应由服务端签名，前端不应持有此密钥。 */
export const GAME_SIGNER_PRIVATE_KEY = "";

/** WalletConnect Project ID（在 https://cloud.reown.com 创建） */
export const WALLETCONNECT_PROJECT_ID = "";

/** RPC URL */
export const RPC_URL = "https://k8s.testnet.json-rpc.injective.network/";

/** 区块浏览器 */
export const BLOCK_EXPLORER = "https://testnet.blockscout.injective.network";

/** 本作 storyId / seasonId（用于合约 claim 的链上标识） */
export const STORY_ID = "mudanting-jingmeng";
export const SEASON_ID = "season-1";

/** 检查是否已配置 */
export function isWeb3Configured(): boolean {
  return !!NFT_CONTRACT_ADDRESS && !!GAME_SIGNER_PRIVATE_KEY;
}
