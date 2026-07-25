# 幕影铸梦

一个同时验证 PICO WebSpatial、Three.js 深度遮挡、可信节奏成绩和 Injective EVM
玩家所有权的 dGame MVP。

## 已实现

- WebSpatial 空间化舞台与控制面板（普通浏览器自动降级为二维布局）
- R3F 低多边形皮影戏台
- 10 秒固定关节动画
- 前景雕柱与皮影之间的真实深度遮挡
- 暖色背光、半透明皮影、透光幕布和投影
- 动画结束后解锁领取流程
- WalletConnect 二维码连接手机 MetaMask
- Injective EVM Testnet（Chain ID `1439`）切链与真实 ERC-721 mint
- 交易等待、错误和区块浏览器反馈
- 三档难度、每日影纹、跨设备进度和可信赛季榜
- 服务端复算输入事件，不接受客户端自报分数
- EIP-712 限时领取凭证、章节/赛季唯一 NFT 和持有者内容解锁
- Solidity + OpenZeppelin + Foundry 安全测试

## 本地启动

要求 Node.js 22.13+。

```bash
cp .env.example .env.local
npm install
npm run dev
```

桌面预览地址为 `http://localhost:3000`。

## 必填配置

在 `.env.local` 填写：

```dotenv
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<Reown Cloud Project ID>
NEXT_PUBLIC_NFT_CONTRACT_ADDRESS=<部署后的合约地址>
GAME_SIGNER_PRIVATE_KEY=<仅服务端使用的 0x 私钥>
OFOX_API_KEY=<仅服务端使用的生图服务密钥>
```

WalletConnect Project ID 可在 Reown Cloud 创建。它是公开的前端项目标识，不是钱包私钥。
`GAME_SIGNER_PRIVATE_KEY` 与 `OFOX_API_KEY` 都只能配置为部署平台密钥，禁止使用
`NEXT_PUBLIC_` 前缀或写入 Git。签名账户只负责签发成绩凭证，不应持有资金或合约 owner 权限。

持久化使用 D1 的逻辑绑定 `DB`，生成的迁移位于 `drizzle/`；NFT 图片和 metadata
使用 R2 的逻辑绑定 `NFT_ASSETS`。

## 部署 NFT 合约

先安装 Foundry，然后在项目根目录执行：

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std --no-git --shallow
forge test

forge create src/ShadowRelic.sol:ShadowRelic \
  --rpc-url injectiveEvm \
  --legacy \
  --account injTest \
  --gas-price 160000000 \
  --gas-limit 2000000 \
  --broadcast \
  --constructor-args \
  "https://<your-site>/api/nft/metadata/" \
  "<GAME_SIGNER_ADDRESS>"
```

将返回的合约地址写入 `.env.local`，重启开发服务器。部署账户需要提前从
Injective 测试网水龙头领取测试 INJ。

建议验证合约：

```bash
forge verify-contract \
  --rpc-url injectiveEvm \
  --verifier blockscout \
  --verifier-url "https://testnet.blockscout.injective.network/api" \
  <CONTRACT_ADDRESS> \
  src/ShadowRelic.sol:ShadowRelic \
  --constructor-args $(cast abi-encode "constructor(string,address)" \
  "https://<your-site>/api/nft/metadata/" "<GAME_SIGNER_ADDRESS>")
```

合约域名固定为 `Shadow Relic`、版本 `1`、Injective EVM Testnet Chain ID `1439`。
部署后必须把新地址同时写入前端配置与签名服务，再执行一次真实的三日资格测试。

## API

公开 API 使用 `/api/v1` 前缀，所有响应包含 `ok`，错误包含稳定的 `code` 与面向用户的
`message`，并返回 `x-api-version`。完整 OpenAPI 3.1 规范见
[`docs/openapi.yaml`](docs/openapi.yaml)。

- `POST /api/v1/runs/start`：创建带服务端时间戳、nonce 和赛季信息的演出；
- `POST /api/v1/runs/finish`：提交最多 128 条输入事件，由服务端复算并签发领取凭证；
- `GET /api/v1/leaderboard`：查询每钱包最佳可信成绩；
- `GET /api/v1/progress/:address`：恢复影纹、最佳成绩和链上资产解锁。

## PICO OS 6 Emulator

PICO OS 6 已内置 WebSpatial Runtime，不需要生成 APK：

1. 安装并启动官方 PICO Emulator。
2. 保持 `npm run dev` 运行。
3. 在模拟器 PICO Browser 访问 `http://10.0.2.2:3000/`。
4. 点击地址栏中的 **Run as a standalone app**。
5. 检查舞台与控制面板是否以空间内容显示。
6. 播放完成后点击领取，使用手机 MetaMask 扫描 WalletConnect 二维码。
7. 在手机确认切换至 Injective EVM Testnet 1439 并发送 mint。
8. 等待应用显示交易哈希，再打开 Blockscout 核验。

如果模拟器不能访问开发服务器，确认本项目的 Vite `server.host` 已启用，并检查
macOS 防火墙是否允许 Node 接收局域连接。

## 验收清单

- [ ] 动画固定播放并在约 10 秒后结束
- [ ] 武将经过左侧雕柱时被正确遮挡
- [ ] 幕布有暖色透光，皮影不是纯黑贴图
- [ ] 动画结束前不能连接钱包
- [ ] 手机扫码后显示真实钱包地址
- [ ] 钱包网络为 Chain ID 1439
- [ ] mint 产生真实测试网交易哈希
- [ ] Blockscout 可查到交易与 NFT 所有者
- [ ] PICO Emulator standalone WebSpatial 模式录屏

## 安全说明

项目不会存储助记词或私钥。部署账户使用 Foundry keystore；用户交易由手机钱包签名。
所有演示交易均在测试网进行。
