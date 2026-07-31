# 钱包 / NFT 配置

当前项目已改为复用第二个项目的 Web3 接入方式：

- `wagmi` 管理钱包连接、切链和合约调用
- `@tanstack/react-query` 轮询交易确认
- `WalletConnect` 用于手机钱包扫码连接
- `ShadowRelic.mint()` 直接完成测试网 ERC-721 铸造

终幕中的「铸造 NFT」按钮保留在原位；未配置环境变量时，主线体验不受影响。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `src/web3-config.ts` | Vite 环境变量读取、链配置、是否启用的判断 |
| `src/web3.ts` | wagmi 配置、Injective Testnet、ShadowRelic mint ABI |
| `src/nft-panel.ts` | 终幕 NFT 面板挂载器 |
| `src/nft-panel-view.tsx` | React 钱包连接 / mint 面板 |
| `src/story-stage.ts` | 终幕已接入「铸造 NFT」按钮 |

## 启用步骤

### 1. 部署 ShadowRelic 合约

可直接复用第二个项目里的最小合约：

```solidity
contract ShadowRelic is ERC721, Ownable {
    uint256 public nextTokenId;
    string private baseTokenURI;

    constructor(string memory initialBaseURI)
        ERC721("Shadow Relic", "SHADOW")
        Ownable(msg.sender)
    {
        baseTokenURI = initialBaseURI;
    }

    function mint() external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _safeMint(msg.sender, tokenId);
    }
}
```

部署到 Injective EVM Testnet 后，记下合约地址。

### 2. 创建 WalletConnect Project ID

前往 [Reown Cloud](https://cloud.reown.com) 创建项目，获取 Project ID。

### 3. 填写环境变量

在项目根目录创建 `.env.local`：

```dotenv
VITE_SITE_URL=http://localhost:5173
VITE_WALLETCONNECT_PROJECT_ID=<Reown Cloud Project ID>
VITE_NFT_CONTRACT_ADDRESS=<部署后的合约地址>
```

### 4. 启动项目

```bash
cp .env.example .env.local
npm install
npm run dev
```

配置完成后，通关终幕时即可在面板里完成：

- 钱包扫码连接
- 自动切换到 Injective 1439
- 调用 `mint()`
- 等待交易确认并跳转 Blockscout

## 技术要点

- **链**：Injective EVM Testnet（Chain ID `1439`）
- **钱包**：WalletConnect 二维码优先，适合手机钱包和头显联动
- **合约**：最小 ERC-721 `mint()`，不再要求前端持有签名私钥
- **安全性**：移除了原先前端内置 `gameSigner` 私钥的风险点
