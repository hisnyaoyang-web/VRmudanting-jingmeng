# 区块链集成说明

本文件夹已融入 Injective EVM Testnet 的链上 NFT 铸造能力。
玩家完成全程体验后，可在结算界面将「杜丽娘」铸为 ERC-721 链上信物。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `web3-config.ts` | 链 ID、合约地址、签名密钥、WalletConnect Project ID |
| `web3.ts` | 链定义、ShadowRelic ABI、钱包连接、EIP-712 签名、claim 交易 |
| `nft-panel.ts` | 结算界面的 NFT 铸造面板 UI |
| `story-stage.ts` | S12 结算已接入「铸造 NFT」按钮 |

## 启用步骤

### 1. 部署 ShadowRelic 合约

合约源码在 `.ref-rhythm/contracts/src/ShadowRelic.sol`。

```bash
cd .ref-rhythm/contracts
forge install OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std --no-git --shallow
forge test

# 先从 Injective 测试网水龙头领取测试 INJ
forge create src/ShadowRelic.sol:ShadowRelic \
  --rpc-url injectiveEvm --legacy \
  --account injTest --gas-price 160000000 --gas-limit 2000000 --broadcast \
  --constructor-args "https://YOUR_SITE/api/nft/metadata/" "GAME_SIGNER_ADDRESS"
```

### 2. 生成签名密钥

```bash
cast wallet new
# 记下地址和私钥
# 将地址设为合约的 gameSigner（部署时或部署后调用 setGameSigner）
```

### 3. 创建 WalletConnect Project ID

前往 https://cloud.reown.com 创建项目，获取 Project ID。

### 4. 填写配置

编辑 `experience2/web3-config.ts`：

```typescript
export const NFT_CONTRACT_ADDRESS = "0x...";     // 部署后的合约地址
export const GAME_SIGNER_PRIVATE_KEY = "0x...";   // 签名密钥（仅 demo 用）
export const WALLETCONNECT_PROJECT_ID = "...";     // Reown Cloud
```

配置完成后，结算界面的「铸造 NFT」按钮自动激活。

## 技术要点

- **合约**：ERC-721 + EIP-712 类型化签名验证，防重放、防重复领取
- **链**：Injective EVM Testnet（Chain ID 1439）
- **钱包**：浏览器扩展（MetaMask 等）+ WalletConnect 二维码（手机扫码 / VR 头显）
- **签名**：客户端用 gameSigner 私钥签 EIP-712 voucher，玩家钱包提交 claim 交易
- **安全提示**：生产环境应由服务端签名，不要在前端暴露 gameSigner 私钥
