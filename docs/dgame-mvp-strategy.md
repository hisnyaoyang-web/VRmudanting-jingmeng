# Shadowplay WebSpatial：dGame MVP 策略

更新日期：2026-07-25

## 一句话定位

一款“先玩、后拥有”的空间皮影节奏叙事游戏：玩家不用钱包即可完成演出；通关后可把代表性成绩铸成可验证、可展示、能解锁后续内容的链上影灵。

MVP 不做“全链游戏”，采用 **链下实时游戏 + 链上关键所有权**。目标不是让每次点击都上链，而是让玩家在三个时刻明确感知 Web3：

1. 我完成的高光演出有公开可验证的凭证；
2. 这个影灵确实在我的钱包里，并能跨设备恢复；
3. 持有它会改变下一次游戏体验。

## 现状判断

项目已经具备比普通 NFT Demo 更完整的游戏骨架：

- 18 秒节奏演出、移动与动作输入、评分和连击；
- 对话、剧情分支、重复游玩历史；
- WebSpatial / 普通 Web 双形态；
- WalletConnect、Injective EVM Testnet 和 ERC-721 mint；
- 根据故事、评级和分数生成动态 NFT 图像；
- 交易回执、Transfer 日志和 NFT 接收地址校验。

当前主要缺口：

- 缺少第二次、第二天继续玩的目标；
- NFT 铸造后没有反哺玩法，容易成为“一次性纪念图”；
- 成绩历史只存在 `localStorage`，不能跨设备，也不能可信排行；
- 合约 `mint()` 无限制，任意地址可无限铸造；
- NFT metadata 中的 `grade`、`score` 来自客户端请求，交易虽真实，成绩仍可伪造；
- 每次重玩都可以再 mint，没有故事/赛季/钱包维度的唯一性与稀缺规则；
- 手机钱包扫码和测试网 Gas 对非加密玩家仍是明显流失点。

## 常见 dGame 的可复用模式

| 模式 | 代表做法 | 对本项目的启发 | MVP 是否采用 |
|---|---|---|---|
| 免费入场，拥有后置 | Axie Origins 提供免费 starter，让玩家在接触 NFT 前先喜欢上玩法 | 钱包只能出现在通关之后，不能挡在开场 | 是 |
| 游戏行为链下/后台签名 | Pirate Nation 用 game wallet 和 gas sponsorship 消除频繁弹窗 | 实时节奏绝不能逐动作上链；领取应尽量免 Gas 或只签一次 | 是，先做一次签名；代付后置 |
| 任务—资源—合成 | Pirate Nation 用任务产资源，再用资源制作能解锁高级任务的物品 | 把评分变成“影纹碎片”，集齐后合成影灵，使重玩有目标 | 轻量采用 |
| 资产具有后续用途 | Axie 把 NFT 作为多个体验的基础资产，并用成长/装备强化依恋 | 已铸影灵要解锁皮肤、支线或称号，不能只在钱包里看 | 是 |
| 稀缺和消耗出口 | Crafting、升级、限定奖池提供资源 sink | MVP 不发 ERC-20；碎片链下消耗，最终藏品才上链 | 是 |
| 可交易与不可交易分层 | Pirate Nation 同时使用可交易资产和 soulbound 积分 | 荣誉/成就不可交易，收藏影灵可以转移，避免“买来的高手” | 第二阶段 |
| 好玩优先于收益 | Pixels 明确强调经济价值必须建立在游戏娱乐价值上 | 不用 Play-to-Earn、币价或空投作为核心卖点 | 是 |

参考资料：

- [Axie Infinity：免费 starter、符文与护符成长](https://whitepaper.axieinfinity.com/gameplay/battling)
- [Axie Infinity：资产效用、成长与经济可持续性](https://whitepaper.axieinfinity.com/gameplay/axie-population-and-long-term-sustainability)
- [Pirate Nation：任务、经验、资源和冷却](https://docs.piratenation.game/learn/the-game/quests)
- [Pirate Nation：资源与合成层级](https://docs.piratenation.game/learn/the-game/resources-and-crafting)
- [Pirate Nation：无弹窗、免 Gas 游戏方案](https://docs.piratenation.game/learn/about-our-tech/wallet-popup-free-and-gas-less-gameplay)
- [Pixels：娱乐价值优先的经济设计](https://docs.pixels.xyz/economics)
- [Immutable Passport：社交登录、嵌入式钱包和预授权交易](https://docs.immutable.com/docs/products/passport/overview)

## 推荐 MVP 核心循环

```text
游客进入
  → 30–60 秒剧情与节奏演出
  → 获得评分、影纹碎片、今日任务进度
  → 重玩提高评级 / 完成不同剧情条件
  → 登录或连接钱包保存进度
  → 集齐 3 枚影纹并完成一次“绝”级演出
  → 铸造本章唯一影灵
  → 影灵解锁专属皮肤 + 下一章隐藏对白
  → 次日挑战新谱面 / 赛季榜
```

### 为什么不是每局都 mint

每局铸造会制造垃圾资产、稀释纪念意义、增加钱包摩擦，也会让“生成图片”成本随重玩次数线性增加。推荐改为：

- 每个钱包、每个故事章节只能铸造 1 个主影灵；
- 后续更高成绩更新站内陈列属性和成绩证明，不重复铸 NFT；
- 或允许在赛季结束时“升格”一次，产生新的 metadata 版本；
- 普通成绩、碎片、连胜、任务进度不上链。

## Web3 程度与开发难度分层

| 层级 | 上链内容 | 玩家感知 | 开发/运维难度 | 建议 |
|---|---|---:|---:|---|
| A：纪念品 Demo | 通关后自由 mint NFT | 中 | 低 | 当前状态，不足以留存 |
| B：可验证收藏游戏 | 签名领取、章节唯一 NFT、持有者效用、公开陈列 | 高 | 中 | **MVP 推荐** |
| C：资产经济游戏 | ERC-1155 资源、合成、交易市场、赛季奖励 | 很高 | 高 | 有留存数据后再做 |
| D：全链游戏 | 动作、状态、随机数、结算均由合约执行 | 极高但摩擦也高 | 极高 | 不适合当前玩法 |

推荐目标是 B，Web3 功能占整体研发约 25%–35%，其余投入在内容变化、留存和手感。

## MVP 功能优先级

### P0：上线闭环必须完成

1. **游客先玩**
   - 首页不要求连接钱包；
   - 通关结算页才展示“保存旅程 / 铸造影灵”；
   - 钱包失败不阻止重玩和查看结局。

2. **服务端可信成绩**
   - 开局由服务端创建 `runId`、故事版本和随机 nonce；
   - 客户端提交输入事件流，而不是直接提交最终分数；
   - 服务端按同一谱面重算分数，签发短时效 EIP-712 claim voucher；
   - 合约验证 `storyId + seasonId + wallet + grade + score + nonce + deadline`；
   - nonce 只能使用一次。

3. **章节唯一影灵**
   - 合约限制每个钱包每个 `storyId/seasonId` 领取一次；
   - 保留 ERC-721，暂不引入 ERC-20；
   - metadata 只读取服务端已验证成绩；
   - NFT 图像生成失败不应导致资产永久缺图：先写占位 metadata，后台可重试。

4. **NFT 反哺玩法**
   - 持有本章影灵：解锁 1 款皮影材质/灯色；
   - `excellent`：额外解锁隐藏对白或结尾镜头；
   - 所有增益只改变外观和内容，不增加节奏判定优势。

5. **跨设备玩家档案**
   - 钱包地址作为可恢复身份；
   - 服务端保存最佳分数、最高评级、已看分支、碎片与每日任务；
   - 不把长期档案仅放在 `localStorage`。

### P1：验证留存

1. **每日一幕**
   - 每日固定故事 + 变体谱面；
   - 首次完成给 1 枚影纹，每天最多 1 枚；
   - 3 枚影纹 + 指定评级解锁铸造，最少形成 3 日目标。

2. **三档难度**
   - 入门：窗口放宽、只需 4 个动作；
   - 正戏：当前强度；
   - 名角：窗口缩短、加入连续动作；
   - NFT 只记录最高完成难度，不同难度不拆成不同资产。

3. **可信周榜**
   - 排行榜放服务端数据库，不逐局上链；
   - 仅展示服务端复算通过的成绩；
   - 钱包地址默认缩写，允许玩家设置站内昵称；
   - 每周前列发站内称号；赛季成就 NFT 后置。

4. **收藏陈列**
   - 个人“影匣”展示已拥有影灵、最佳演出和解锁分支；
   - WebSpatial 中可把影灵卡放在舞台侧墙；
   - 支持分享只读链接，形成自然传播。

### P2：确认 PMF 后再做

- 赛季不可转让成就（SBT）；
- ERC-1155 可交易服装或舞台装饰；
- 创作者上传剧情包、按游玩或铸造分成；
- 赞助方限定故事与联名藏品；
- 嵌入式钱包、账户抽象和 Gas sponsorship；
- 玩家间交易市场。

## 明确不做

MVP 阶段不做以下功能：

- ERC-20 游戏币、质押、挖矿、收益承诺或空投预期；
- NFT 先购后玩；
- 土地、繁殖、公会 DAO；
- 自建 NFT 市场；
- 实时 PvP；
- 每次输入、每局分数或普通材料上链；
- 付费装备带来判定或分数优势；
- 把“动态 AI 图片”当成唯一核心玩法。

这些功能会同时增加经济设计、合规、安全、机器人和流动性风险，但不能证明皮影节奏玩法本身有留存。

## 推荐数据模型

最小服务端表：

```text
players
  wallet_address, display_name, created_at

runs
  run_id, wallet_address?, story_id, story_version, season_id,
  started_at, finished_at, input_digest, score, grade, verified

progress
  wallet_address, story_id, best_score, best_grade,
  fragments, play_count, last_played_at

claims
  wallet_address, story_id, season_id, nonce,
  voucher_digest, tx_hash?, token_id?, status

unlocks
  wallet_address, unlock_id, source, unlocked_at
```

游客局可以先用匿名 session 保存；连接钱包后再把尚未领取的本地进度绑定。排行榜只接受已绑定并验证的 `runs`。

## 合约最小改造

建议把任意调用的 `mint()` 改成签名领取：

```solidity
claim(
  bytes32 storyId,
  bytes32 seasonId,
  uint32 score,
  uint8 grade,
  uint256 nonce,
  uint256 deadline,
  bytes signature
)
```

合约至少验证：

- 签名者是 `GAME_SIGNER`；
- `deadline` 未过期；
- nonce 未使用；
- `msg.sender` 包含在签名消息中；
- `wallet + storyId + seasonId` 尚未领取；
- 先写入领取状态，再 `_safeMint`；
- 支持暂停、轮换签名者和管理员回收错误签名权限。

不要让合约直接相信前端传入的 grade/score，也不要依赖“隐藏接口”防作弊。

## 4 周实现建议

### 第 1 周：可信闭环

- 建 runs / progress / claims 数据；
- 服务端重算现有 6 个 cue 的分数；
- 实现 voucher 和签名 claim 合约；
- 完成合约单测：重放、过期、伪签名、重复章节、暂停。

### 第 2 周：留存

- 每日一幕、3 枚影纹、三档难度；
- 最佳成绩与已看分支跨设备保存；
- 结算页改成“奖励 → 保存 → 铸造”的渐进流程。

### 第 3 周：资产效用

- 影灵持有检测；
- 专属皮肤/灯色与隐藏对白；
- 个人影匣和分享页；
- metadata 生成任务重试与占位图。

### 第 4 周：运营与验收

- 周榜、基础反作弊限流和异常输入检测；
- 新手漏斗埋点；
- PICO 真机 / 模拟器、移动钱包和普通浏览器回归；
- 小规模玩家测试，按数据决定是否做免 Gas。

## MVP 成功指标

优先看游戏指标，而不是 mint 数：

- 开场到完成首局：≥ 55%；
- 首局完成到主动重玩：≥ 25%；
- D1 回访：≥ 20%；
- 完成 3 日影纹目标：≥ 10%；
- 看到结算页后连接/登录成功：≥ 35%；
- 满足资格后完成铸造：≥ 60%；
- 铸造后使用专属外观或打开隐藏内容：≥ 40%；
- 钱包/链交互导致的错误率：≤ 5%。

若“主动重玩”和 D1 不达标，不应继续加代币或市场；应先增加谱面变化、反馈手感和剧情悬念。若资格用户的铸造转化低但重玩高，再优先投入嵌入式钱包与 Gas sponsorship。

## 最终建议

MVP 的产品表达应从“WebSpatial × Injective NFT Demo”升级为：

> 演好一幕，留下一个真正属于你的影子。

链是可信所有权与跨体验身份层，不是玩法主循环。最值得立刻投入的三件事依次是：

1. 服务端验分 + 签名领取，解决“真链假成绩”；
2. 3 日影纹目标 + 每日变体，解决一次性体验；
3. NFT 解锁皮肤和隐藏剧情，解决资产没有用途。

