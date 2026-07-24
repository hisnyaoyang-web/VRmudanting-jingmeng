# 动态 NFT 分发

## 玩家流程

1. 演出结束后播放 1.8 秒谢幕动画。
2. 玩家连接钱包并点击「铸」。
3. 钱包在 Injective EVM Testnet 提交 `mint()`。
4. 服务端校验交易回执、目标合约、铸造事件与接收钱包。
5. 校验通过后调用 OFOX 的 GPT-Image-2 接口生成皮影虚拟形象。
6. 图片和 ERC-721 metadata 写入 R2；同一 tokenId 重试时直接复用，不重复生图。

## 环境变量

服务端必须配置：

```dotenv
OFOX_API_KEY=替换为已轮换的新密钥
```

浏览器端继续使用：

```dotenv
NEXT_PUBLIC_NFT_CONTRACT_ADDRESS=0x59C743c515Aa06d2FBf027f7F83b5e5691a6f1a9
```

不要把 `OFOX_API_KEY` 写进 `NEXT_PUBLIC_*`、源码或提交记录。

## 合约 metadata 地址

现有合约需要由 owner 执行一次：

```solidity
setBaseURI("https://shadow-relic-spatial.trace26287703579.chatgpt.site/api/nft/metadata/")
```

设置后，`tokenURI(0)` 会解析为：

```text
https://shadow-relic-spatial.trace26287703579.chatgpt.site/api/nft/metadata/0
```

这一步是链上写操作，需要合约 owner 钱包签名。

## 接口

### `POST /api/relic/claim`

请求：

```json
{
  "txHash": "0x...",
  "address": "0x...",
  "grade": "excellent",
  "score": 920,
  "storyId": "moongate-night",
  "storyTitle": "月下见礼"
}
```

成功响应：

```json
{
  "tokenId": "0",
  "imageUrl": "https://.../api/nft/image/0",
  "metadataUrl": "https://.../api/nft/metadata/0",
  "reused": false
}
```

### `GET /api/nft/image/:tokenId`

返回对应的 PNG 图片。

### `GET /api/nft/metadata/:tokenId`

返回 ERC-721 metadata JSON。
