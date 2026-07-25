# 园中影铺：Injective 前端与 PICO 部署经验

本文记录当前项目从本地开发、Injective EVM Testnet 联调到 PICO Emulator / 真机验收的实际流程。它面向接手项目的开发者，不是通用教程；命令、端口和文件路径均以本仓库当前实现为准。

## 1. 当前技术栈与部署边界

- React 19、Next.js 16 API 形态；
- `vinext + Vite` 构建；
- Cloudflare Worker 承载页面和 API；
- D1 保存演出、成绩、领取凭证与解锁状态；
- R2 保存 NFT 图片和 metadata；
- wagmi、viem、WalletConnect 负责钱包连接；
- Injective EVM Testnet 承载 ERC-721 合约；
- WebSpatial SDK 负责 PICO OS 6 的空间 UI；
- React Three Fiber / Three.js 负责戏台；
- WebXR 是沉浸式舞台入口，与 WebSpatial 空间 DOM 是两套不同的渲染路径。

PICO OS 6 已包含 WebSpatial Runtime，因此本项目在 PICO 上以网页 URL 分发，不需要为了 WebSpatial 单独生成 APK。普通浏览器仍显示二维页面；只有从 PICO 地址栏选择 **Run as a standalone app** 后，页面才会进入 WebSpatial Runtime。

## 2. 环境准备

要求 Node.js `22.13.0+`。

```bash
cd /Users/akuya/Desktop/PICO/shadowplay-webspatial
cp .env.example .env.local
npm install
```

本地和部署平台需要配置：

```dotenv
NEXT_PUBLIC_SITE_URL=https://你的稳定公网域名
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=你的_Reown_Project_ID
NEXT_PUBLIC_NFT_CONTRACT_ADDRESS=0x部署后的合约地址
GAME_SIGNER_PRIVATE_KEY=0x仅服务端使用的签名私钥
OFOX_API_KEY=仅服务端使用的生图服务密钥
```

注意：

- `NEXT_PUBLIC_*` 会被打进前端包，不得放私钥；
- `GAME_SIGNER_PRIVATE_KEY` 和 `OFOX_API_KEY` 只能存在于服务端密钥配置；
- 更换站点域名或合约地址后必须重新构建和部署；
- 游戏签名账户不应兼任合约 owner，也不应存放大额资金；
- 当前 `.openai/hosting.json` 已绑定 D1 `DB` 和 R2 `NFT_ASSETS`，不要重新创建或杜撰项目 ID；
- 正式环境必须应用 `drizzle/` 中的数据库迁移。

## 3. 本地启动与基础检查

```bash
npm run dev
```

默认桌面地址：

```text
http://localhost:3000/
```

构建和测试：

```bash
npm run build
npm test
```

开发服务器能被 PICO 访问的关键配置在 `vite.config.ts`：

```ts
server: {
  host: true,
}
```

不要把它改回只监听 `localhost`。

## 4. Injective EVM Testnet 配置

当前项目使用以下网络：

| 配置 | 值 |
| --- | --- |
| EVM Chain ID | `1439` |
| 原生资产 | `INJ` |
| RPC | `https://k8s.testnet.json-rpc.injective.network/` |
| Explorer | `https://testnet.blockscout.injective.network/` |
| Faucet | `https://testnet.faucet.injective.network/` |

Injective 原生链 ID 与 EVM Chain ID 不是同一种标识。本项目前端、EIP-712 domain 和合约交互都必须使用数字 `1439`。

前端网络定义位于 `app/web3.ts`。连接和领取时的实际流程是：

1. WalletConnect 连接手机钱包；
2. 请求钱包切换到 Injective EVM Testnet `1439`；
3. 前端调用合约的 `claim(...)`，不是无参数的 `mint()`；
4. 等待链上交易回执；
5. 前端把交易哈希发送给 `/api/relic/claim`；
6. 服务端核对合约地址、`Transfer` mint 事件和接收者；
7. 服务端生成藏品图片并把图片、metadata 写入 R2。

### WalletConnect 部署经验

`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` 来自 Reown Dashboard。正式域名应加入项目的 origin allowlist；修改 allowlist 后可能不会立即生效。

以下地址的语义不同：

- `localhost:3000`：只对开发电脑自己有效；
- `10.0.2.2:3000`：PICO Emulator 访问宿主 Mac 的特殊地址；
- `192.168.x.x:3000` 等：同一局域网内真机访问开发电脑；
- 公网 HTTPS 域名：正式钱包连接、回跳、NFT metadata 和 WebXR 联调应使用的地址。

手机钱包无法访问 Mac 的 `localhost`，也无法把 `10.0.2.2` 当作 Mac。PICO 本地页面可以展示 WalletConnect 二维码，但正式联调更推荐直接打开 HTTPS 公网部署。

### 合约地址必须保持一致

下面三处必须使用同一个合约地址：

- 前端 `NEXT_PUBLIC_NFT_CONTRACT_ADDRESS`；
- `/api/v1/runs/finish` 的 EIP-712 verifying contract；
- `/api/relic/claim` 的交易回执校验目标。

不一致会导致 `InvalidSigner`、签名无效，或者链上成功但 NFT 后处理失败。

## 5. 部署 ERC-721 合约

安装 Foundry 依赖并运行测试：

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std --no-git --shallow
forge test
```

部署前使用 Foundry keystore 管理测试网部署账户，并从测试网 Faucet 领取 INJ。当前仓库使用：

```bash
forge create src/ShadowRelic.sol:ShadowRelic \
  --rpc-url injectiveEvm \
  --legacy \
  --account injTest \
  --gas-price 160000000 \
  --gas-limit 2000000 \
  --broadcast \
  --constructor-args \
  "https://你的公网域名/api/nft/metadata/" \
  "0xGAME_SIGNER_ADDRESS"
```

经验：

- metadata base URI 必须是稳定公网 HTTPS 地址；
- base URI 末尾必须保留 `/`；
- `--legacy`、gas price 和 gas limit 是当前测试网联调配置，不应被当成永久常量；网络升级或部署失败时先检查 Injective 官方网络参数；
- 部署后将新地址写入部署环境，重新构建前端；
- 若换域名，需要合约 owner 调用 `setBaseURI(...)`；
- 在 Blockscout 核对合约、交易和 NFT owner。

NFT 的图片和 metadata 依赖公网 API、R2 和生图服务，因此目前不是“数据完全在链上”。即使 mint 已成功，R2 或生图服务未配置仍会造成藏品图片暂时不可见。

## 6. PICO Emulator 本地部署

保持本地服务运行：

```bash
npm run dev
```

在 PICO Emulator 浏览器中访问：

```text
http://10.0.2.2:3000/
```

然后在地址栏选择：

```text
Run as a standalone app
```

只切换浏览器的“电脑模式 / 手机模式”不会启用 WebSpatial。这是此前“浏览器没有认 WebSpatial”的主要原因之一。

Emulator 本地预览 WebSpatial 时可以使用 HTTP。`10.0.2.2` 只适用于 Emulator，从 Mac 自己的浏览器访问它没有验证意义。

### WebSpatial 识别依赖

当前项目中的关键实现包括：

- `app/layout.tsx` 挂载 `SpatialProvider`，并链接 `/app.webmanifest`；
- `app/spatial-provider.tsx` 使用 `SSRProvider`；
- `app/shadowplay-app.tsx` 保留 `/** @jsxImportSource @webspatial/react-sdk */`；
- 空间节点使用 `enable-xr`，根节点使用 `enable-xr-monitor`；
- `app/app.webmanifest/route.ts` 以同源 route 返回 manifest；
- manifest 使用 `display: "standalone"` 并包含 `xr_main_scene`；
- manifest 响应类型为 `application/manifest+json`；
- `public/icons/` 中存在 512 和 1024 像素 PWA 图标。

本地检查 manifest：

```bash
curl -i http://localhost:3000/app.webmanifest
```

应确认：

- HTTP 200；
- `Content-Type: application/manifest+json`；
- JSON 中有 `display: "standalone"`；
- JSON 中有 `xr_main_scene`；
- 图标 URL 均能正常打开。

不要把当前同源 manifest route 改回容易产生 origin 偏差的静态或框架隐式配置。

## 7. PICO 真机局域网部署

真机和 Mac 必须在同一个可互访的局域网。查询 Mac Wi-Fi 地址：

```bash
ipconfig getifaddr en0
```

假设得到 `192.168.1.23`，在 PICO 真机访问：

```text
http://192.168.1.23:3000/
```

先在 Mac 上验证监听：

```bash
curl -i http://192.168.1.23:3000/app.webmanifest
```

如果真机打不开：

1. 确认 `npm run dev` 仍在运行，端口以终端输出为准；
2. 确认 `server.host: true`；
3. 允许 macOS 防火墙中的 Node 入站连接；
4. 避免访客 Wi-Fi、企业网 AP 隔离或不同 VLAN；
5. 检查 VPN 是否改变路由；
6. 先用同一 Wi-Fi 下的手机浏览器访问该地址。

真机打开页面后同样需要选择 **Run as a standalone app**。

## 8. WebXR 与 HTTPS

WebSpatial 和 WebXR 不应混为一谈：

- WebSpatial：让 DOM 面板在 PICO Runtime 中空间化；
- Three.js：在网页 Canvas 内渲染 3D 戏台；
- WebXR：进入 `immersive-vr` 后接管沉浸空间，原 WebSpatial 页面不会与 WebXR 内容同时显示。

真实头显上的 WebXR 通常要求 secure context。`localhost` 是浏览器特例，但局域网 HTTP 地址通常不是。因此：

- `http://10.0.2.2:3000` 适合 Emulator 的 WebSpatial 快速预览；
- `http://192.168.x.x:3000` 适合真机页面和局域网排错；
- 完整 WebXR、钱包和正式演示优先使用可信 HTTPS 公网域名。

PICO 出现黑屏或掉帧时，先降低 DPR、贴图尺寸和阴影成本；必要时从 `PCFSoftShadowMap` 回退到更基础的 shadow map。WebSpatial DOM 的深度与 Three.js Canvas 内的世界坐标也不是同一套坐标。

## 9. 正式前端部署

正式部署前：

```bash
npm run build
npm test
```

部署平台必须具备：

- Worker 运行环境；
- D1 绑定名 `DB`；
- R2 绑定名 `NFT_ASSETS`；
- 正确执行的 Drizzle migrations；
- 五个环境变量；
- 可公开访问的 HTTPS 域名；
- Reown allowlist 中的正式 origin。

推荐顺序：

1. 部署前端、API、D1 和 R2，获得稳定 HTTPS 域名；
2. 设置 `NEXT_PUBLIC_SITE_URL` 为该域名；
3. 创建游戏签名账户；
4. 使用正式 metadata base URI 部署合约；
5. 将合约地址写回部署环境并重新构建；
6. 在 Reown 中加入正式 origin；
7. 在桌面完成一次真实领取；
8. 在 PICO standalone 模式完成一次真实领取；
9. 在 Blockscout 核对交易、Token ID 和 owner；
10. 打开 metadata/image URL，确认钱包或市场能够读取。

## 10. 常见故障

### 页面能开，但所有内容仍在一个二维浏览器框里

- 没有点击 **Run as a standalone app**；
- manifest 没有被 Runtime 识别；
- `SSRProvider` 或 `jsxImportSource` 被移除；
- 当前 UA 不包含 `WebSpatial/`，项目按预期降级为二维页面。

### Emulator 打不开本机服务

- 地址误用了 `localhost` 或 Mac 局域网 IP；
- 正确地址通常是 `http://10.0.2.2:3000/`；
- Vite 没有监听外部地址；
- 防火墙阻止 Node 入站。

### 真机打不开本机服务

- 地址误用了 `10.0.2.2`；
- 真机应使用 Mac 的局域网 IP；
- 两台设备不在同一网络，或 AP 开启了客户端隔离。

### WalletConnect 二维码出现，但连接失败

- Project ID 未配置；
- 当前 origin 不在 Reown allowlist；
- 钱包不支持或没有正确添加 Injective EVM Testnet；
- 手机不能访问页面 metadata 中填写的 `localhost` 地址；
- allowlist 更新仍在传播。

### 钱包已连接，但领取失败

- 钱包没有切换到 Chain ID `1439`；
- 合约地址与服务端签名 domain 不一致；
- 领取签名超过 30 分钟有效期；
- 当前合约会限制同一 wallet/story/season 重复领取；
- 领取资格尚未满足；
- `GAME_SIGNER_PRIVATE_KEY` 未配置。

### 链上成功，但 NFT 图片没有生成

- `OFOX_API_KEY` 未配置或服务异常；
- R2 `NFT_ASSETS` 未绑定；
- `/api/relic/claim` 未找到对应 mint `Transfer`；
- D1 中没有该钱包的有效成绩凭证；
- 合约 base URI 仍指向旧域名。

## 11. 发布验收清单

- [ ] `npm run build` 和 `npm test` 通过；
- [ ] manifest、512/1024 图标可公开访问；
- [ ] 桌面普通浏览器二维降级正常；
- [ ] PICO Emulator 使用 `10.0.2.2` 打开；
- [ ] PICO standalone 后出现 WebSpatial 悬浮层；
- [ ] 真机能通过局域网或公网域名打开；
- [ ] WebXR 在可信 HTTPS 环境可进入；
- [ ] WalletConnect 能连接真实手机钱包；
- [ ] 钱包成功切换到 Injective EVM Testnet `1439`；
- [ ] `claim(...)` 产生真实测试网交易；
- [ ] Blockscout 可查交易、Token ID 与 owner；
- [ ] NFT metadata 与图片 URL 可公开读取；
- [ ] 重复领取被正确拒绝；
- [ ] 前端仓库和浏览器资源中不存在服务端私钥。

## 12. 参考资料

- [Injective EVM 网络信息](https://docs.injective.network/cn/developers-evm/network-information)
- [WebSpatial Getting Started](https://webspatial.dev/docs/introduction/getting-started)
- [WebSpatial App 与 Runtime](https://webspatial.dev/docs/concepts/webspatial-app)
- [WalletConnect JavaScript 安装与 Origin Allowlist](https://docs.walletconnect.network/app-sdk/javascript/installation)

