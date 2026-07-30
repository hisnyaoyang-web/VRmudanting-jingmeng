# 梦入牡丹亭 · 寻回杜丽娘 — 技术文档

> 面向开发者：架构、构建、状态机、渲染管线、音游集成、UI 系统、开发指南

## 1. 技术栈

| 层 | 技术 | 说明 |
| --- | --- | --- |
| 构建 | Vite 7 + TypeScript 5 | 单页应用，`tsconfig` 仅做类型检查（`noEmit`），实际编译由 Vite 接管 |
| 长卷舞台 | 原生 DOM + CSS 变换 | 四层视差画卷，靠 `translate3d` 平移 |
| 皮影人偶 | Three.js 0.185 + GLTFLoader | 独立透明 WebGL 画布，叠加在长卷之上 |
| 嵌入式音游 | React 19 + @react-three/fiber 9 + drei 10 | R3F 戏台场景、下落音符、键盘判定，按需挂载 / 卸载 |
| 剧情数据 | JSON（`StoryPackage` schema） | 独立于代码，可热替换 |
| 链上交互（可选） | viem 2 + WalletConnect | NFT 铸造，未配置时自动降级为纯展示 |

依赖清单见 `package.json`：`three`、`react`、`react-dom`、`@react-three/fiber`、`@react-three/drei`、`viem`、`@walletconnect/ethereum-provider`。开发依赖：`typescript`、`vite`、各 `@types` 包。

## 2. 项目结构

```text
piying-game/
├── index.html              单一入口 HTML，定义长卷 DOM 骨架（四层 + 屏柱 SVG）
├── package.json            脚本：dev / build / preview
├── vite.config.ts          Vite 配置（排除 three 预打包以兼容中文路径）
├── tsconfig.json           严格模式，仅 src/，react-jsx
├── README.md               项目说明
├── .gitignore              node_modules / dist / .DS_Store 等
├── src/
│   ├── main.ts             引导：创建 StoryStage、启动 RAF 循环、加载皮影
│   ├── story-stage.ts      核心控制器 StoryStage：12 状态机、相机、长卷、UI 注入、音游桥接
│   ├── puppet.ts           Puppet 类：Three.js 皮影渲染（GLB 加载、动作重定向、材质抠像）
│   ├── effects.ts          特效引擎：敲门粒子、文字震碎、碎片凝聚、水波、花瓣
│   ├── vr-layer.ts         WebXR / VR 入口（可选，body.vr-active 时隐藏 2D 舞台）
│   ├── nft-panel.ts        结算 NFT 铸造面板（可选）
│   ├── web3.ts             链定义、ShadowRelic ABI、钱包连接、EIP-712 签名、claim 交易
│   ├── web3-config.ts      链 ID、合约地址、签名密钥、WalletConnect Project ID
│   ├── style.css           长卷舞台样式（四层视差、屏柱、UI 浮层、音游 HUD）
│   └── rhythm/             嵌入式音游逐字移植
│       ├── rhythm-mount.ts         挂载 / 卸载 React 音游到 DOM 容器
│       ├── rhythm-experience.tsx   音游主组件（loading/performance 阶段、评分、键盘输入、退出按钮）
│       ├── shadow-stage.tsx        R3F 戏台场景（皮影模型、灯光、音符、UI）
│       ├── game-rules.ts           评分规则（难度、判定窗口、perfect/good/miss）
│       └── story-runtime.ts        剧情 JSON 校验、资产解析、结局分支
├── public/
│   ├── scenes/             长卷场景分层图（s1/s2 的 back/mid/front，PNG）
│   ├── piying/             皮影 GLB 模型与贴图
│   ├── characters/         音游剧情角色立绘
│   ├── props/              碎片图 + 4 种杜丽娘形象立绘
│   ├── mirror/             铜镜图片（已抠绿，RGBA PNG）
│   ├── audio/
│   │   ├── main/           主线 BGM
│   │   ├── chamber/        对白 / 敲门 / 终幕音频
│   │   └── rhythm/         音游三关 BGM
│   ├── stage/              月门戏台背景
│   ├── papercut/           剪纸装饰素材
│   ├── video/              开场背景视频
│   └── stories/moongate-night/story.json   音游剧情数据
├── sources/audio/          外部音频源文件归档（FLAC / m4a 原始素材，便于重新剪辑；不参与构建）
├── scripts/                离线工具脚本（GLB 检查、抠图、音频切片、验证）
└── docs/                   本文档
```

## 3. 渲染架构

### 3.1 长卷四层视差

整个舞台是一条连续画卷（`.panorama`），内含三段（闺房 / 戏台 / 花园）。每段场景由三层图片叠加（后景 / 中后景 / 前景），构成多层 z-index 轴：

| 层 | CSS 类 | z-index | 说明 |
| --- | --- | --- | --- |
| 后景轨道 | `.layer-back` | 1 | 最远，视差最弱 |
| 中后景轨道 | `.layer-mid` | 2 | 视差中等 |
| 角色轨道 | `#puppet-layer` | 5 | 皮影人偶，透明 WebGL 画布 |
| 前景轨道 | `.layer-front` | 6 | 最近，可遮挡角色（前景植物、家具等） |
| 接缝 | `.seam` | 7 | 场景段之间的折纸阴影 |
| 剪纸屏柱 | `.scene-screen` | 8 | 两幕之间的装饰柱，角色可穿行 |
| 铜镜 | `#md-mirror` | 4 | 花园里的铜镜，在角色之后 |
| 门光 | `#md-door` | 6 | 闺房门暖光 |

**关键约束**：前景层（z-index 6）比角色层（z-index 5）高，因此前景图必须保持透明区域 —— 不能整张贴图，否则会盖住角色。花园的中后景 / 前景是绿幕抠图层，运行时由 `chromaKeyLayer()` 去除 `rgb(0,255,0)` 后注入为 background-image。

### 3.2 相机跟随

角色（`charX`）在世界坐标系移动，相机（`camX`）跟随：

```text
camX → clamp(charX - CAM_FOLLOW, 0, SCROLL_MAX)
```

每帧用阻尼平滑：`camX += (target - camX) × min(1, dt × 6)`。

平移通过 `panorama.style.transform = translate3d(-camX × vw, 0, 0)` 实现。角色画布的 `left` 直接设为 `charX × vw`（世界坐标 → 像素），由平移的 panorama 带走。

### 3.3 皮影人偶（Puppet 类）

独立的 Three.js 渲染器，输出透明画布，叠在长卷角色层上。

**模型加载**：一个带骨骼的主模型（`piying-man-rig-hi.glb`）+ 三个动捕动画 GLB（walk / run / flying）。动捕动画通过 `retargetClip()` 按"静止姿态差值"重定向到主骨架。

**材质抠像**：`preparePuppetMaterial()` 在着色器中插入 discard 逻辑，剔除：

- 编辑器绿色骨骼辅助色（`g > 0.72, r < 0.34, b < 0.34`）
- 黄色辅助标记
- 编辑器灰色
- 过亮像素（亮度 > 0.965）

**动作状态**：`idle`（停在 hi 第一帧）、`walk`（循环）、`hi`（单次）、`run`（循环）、`flying`（单次，配 Y 位移）。

**朝向翻转**：用阻尼插值 `scale.x` 实现平滑转身，不是硬翻转。

## 4. 状态机

`StoryStage` 是核心控制器，内部维护 12 个状态的线性状态机。所有剧情靠"走到区域 + 计时器 / 音频 ended"自动推进，全程几乎无强制按键。

```text
intro ──[点击开始]──→ approach ──[走到门口]──→ (4 次自动敲门) ──→ rewardHands
    ──[REWARD_HOLD]──→ freeRoam
    ──[走到戏台前]──→ gardenTalk ──[3 句对白音频结束]──→ talkEnd
    ──[点击「进入游戏」]──→ rhythm ──[音游 onFinish]──→ rewardFeet
    ──[走到镜前]──→ toMirror ──[触发]──→ assemble ──[4 句对白音频结束]──→ rewardTorso
    ──[REWARD_HOLD]──→ finale
```

### 4.1 状态列表（`GState`）

| 状态 | 进入条件 | 退出条件 |
| --- | --- | --- |
| `intro` | 启动 | 点击「开始体验」 |
| `approach` | intro 结束 | 走到门口（`DOOR_ZONE`） |
| `rewardHands` | 4 次敲门后 | `REWARD_HOLD` 计时 |
| `freeRoam` | rewardHands 后 | 走过 `SEAM1` |
| `gardenTalk` | 自由游荡到 `GARDEN.talk` | 3 句对白音频 ended |
| `talkEnd` | gardenTalk 后 | 点击「进入游戏」按钮 |
| `rhythm` | 点击按钮挂载音游 | 音游 `onFinish` / `onExit` |
| `rewardFeet` | 音游通关回到主线 | `REWARD_HOLD` 计时 |
| `toMirror` | 走到 `GARDEN.mirror` | 自动 |
| `assemble` | 触发拼合 | 4 句对白音频 ended |
| `rewardTorso` | 拼合完成 | `REWARD_HOLD` 计时 |
| `finale` | rewardTorso 后 | 用户重新 / 结束 |

### 4.2 关键世界坐标（视口宽比例）

```text
SCENE_W   = 1.4
CHAMBER   = { left: 0.168, right: 1.26, door: 1.064, start: 0.42 }
SEAM1     = 1.4
THEATRE   = { enter: 1.512, center: 2.1, exit: 2.688 }
SEAM2     = 2.8
GARDEN    = { left: 2.912, right: 4.06, talk: 3.08, mirror: 3.738 }
WORLD     = [0.04, 4.16]
```

触发容差统一为 `0.06`（视口宽比例）：`DOOR_ZONE / THEATRE_ZONE / TALK_ZONE / MIRROR_ZONE`。

### 4.3 时间常量

| 常量 | 值 | 用途 |
| --- | --- | --- |
| `KNOCK_INTERVAL` | 2.6s | 敲门间隔 |
| `REWARD_HOLD` | 4.0s | 碎片卡片显示时长 |
| `LEAVE_TEXT_HOLD` | 10.0s | 离开闺房字幕时长（兜底，优先靠音频 ended） |
| `WALK_SPEED` | 0.34 | 行走速度（视口宽 / 秒） |
| `RUN_SPEED` | 0.72 | 疾行速度（音游内） |

### 4.4 输入

| 输入 | 效果 |
| --- | --- |
| ← / A（按住） | 向左移动 |
| → / D（按住） | 向右移动 |
| 触屏左半屏按住 | 向左移动 |
| 触屏右半屏按住 | 向右移动 |
| 鼠标移动 | 触发轻微视差（`tmx` / `tmy`） |

移动在任何主线状态都生效（音游覆盖期间长卷移动暂停）。无任何推进剧情的交互键 —— 剧情全自动，仅"开始体验" / "点击进入游戏" / "退出" / "跳过" 等少数按钮。

## 5. 音频系统

### 5.1 主线 BGM

`public/audio/main/story-bgm.mp3`（瑞鸣《牡丹亭》，342s 立体声 192kbps）。`StoryStage.startStoryBgm()` 在 `intro` 结束时启动，循环播放、音量 0.42。

跨状态管理：

- `pauseStoryBgm()` —— `ensureTheatre()` 挂载音游时
- `resumeStoryBgm()` —— `hideTheatre()` 卸载音游时
- `stopStoryBgm()` —— `endExperience()` 结束体验时

终幕期间沿用主线 BGM 不切换（用户要求「不做单独的设置」）。

### 5.2 对白音频

`runDialogue(lines, fullAudioSrc, opts)` 是统一的对白播放器：

- 单段完整音频一次播放，不循环
- 字幕按字数比例分配时长：`lineDuration = (max(1, text.length) / totalChars) × audioDurationMs`
- 音频 `ended` 事件触发 `onDone`，0.6s 延迟后切状态
- 加载失败时按字数估算（`2500 + chars × 220ms`）兜底
- 显示「跳过对白」按钮，点击立即停音频并强制触发 `onDone`

**`dialogueToken` 守卫**：每次进入新对白自增 token，旧的 `setTimeout` 回调检查 token 决定是否执行 —— 防止快速切状态时旧对白的字幕泄漏到新状态。`fireDone(force)` 的 `force` 参数允许跳过按钮绕过守卫。

### 5.3 音效

- 敲门声 —— `knockSound()` 用 AudioContext 合成（140Hz → 45Hz 指数衰减 + 短噪声）
- 敲门女训 —— `KNOCK_AUDIO_SRC[]` 三段真实人声 mp3
- 入园 quote —— `GARDEN_QUOTE_SRC` 完整 12.4s 真实音频
- 终幕题词 —— `FINALE_VOICE_SRC[]` 三段 wav

### 5.4 音游 BGM

`public/audio/rhythm/level{1,2,3}.mp3`（来自王璐《牡丹亭·游园·皂罗袍》的不同片段）。每关 45s 不循环，由 `RhythmExperience` 内部 `new Audio(bgmUrl)` 创建，phase 切换 / 组件卸载时停止。

## 6. 音游集成

音游是原版 React 项目的逐字移植，封装为可挂载 / 卸载的组件，通过 `mountRhythm(container, props)` 嵌入到长卷舞台。

### 6.1 挂载 / 卸载流程

1. `talkEnd` 状态下点击「进入游戏」按钮 → `ensureTheatre(level)`
2. `ensureTheatre()` 创建 `#rhythm-stage` 覆盖层（position:fixed, z-index:40），调用 `mountRhythm(wrap, { level, onFinish, onExit })`
3. `mountRhythm()` 用 `createRoot` 把 `RhythmExperience` 组件渲染进容器
4. 主线 BGM 暂停，状态切到 `rhythm`，长卷移动暂停
5. 卸载：`hideTheatre()` 淡出覆盖层 300ms → `unmountRhythm(root)` 卸载 React 树 → 移除 DOM → 主线 BGM 恢复

`hideTheatre()` 立即清空 `theatreEl / rhythmRoot` 引用，使淡出动画期间可重新触发 `ensureTheatre()`（支持退出后重复进入、连续切关）。

### 6.2 音游内部状态机

```text
loading ──[fetch story.json]──→ performance ──[音乐结束]──→ onFinish 回调
```

**注意**：原版的 `intro` / `outro` 对话阶段已废弃 —— story 加载完成后 `perfStartedRef` 直接调用 `startPerformance()`，phase 永远不会变成 `intro` 或 `outro`。原 `setPhase` 调用只剩 `setPhase("performance")` 一处。

### 6.3 评分规则（`game-rules.ts`）

三档难度（apprentice / stage / master），影响判定窗口宽度和音符数量。判定分 perfect / good / miss，按得分比例给出 excellent / good / bad 评级。

`extendCues(base, durationMs)` 把基础 chart 循环延展到 45s，保持 note 密度。

### 6.4 关卡流程

`ensureTheatre(level)` 接受 1/2/3。通关后 `handleRhythmFinish(result)` 根据 `ratio` 和 `level` 显示不同选择卡片：

- 第 1 关 + ratio < 0.5 → 仅显示「再演这一折」（重玩第 1 关）
- 第 1/2 关通过 → 显示「进入下一折」+「回到主线」
- 第 3 关通过 → 仅显示「回到主线」

### 6.5 退出按钮

`RhythmExperience` 右上角常驻「退出」按钮（`performance` 阶段可见）。点击调用 `onExit?.()` 回调，在 `story-stage.ts` 中映射到 `hideTheatre() + enter("talkEnd")` —— talkEnd 状态重新调用 `showClickPrompt()`，玩家可重复进入。

## 7. UI 系统

所有 UI 浮层由 `StoryStage` 在运行时通过 `inject()` 注入到 DOM，CSS 主要在 `src/style.css`。

| 元素 | 作用 |
| --- | --- |
| `#md-intro` | 开场说明页 + 「开始体验」按钮 |
| `#md-act` | 幕题（第一/二/三幕），自动淡入淡出 |
| `#md-sub` | 字幕条（台词 + 说话者），底部居中 |
| `#md-reward` | 碎片奖励卡片，自动弹出自动消失 |
| `#md-mirror` | 铜镜（图片 + 碎片徽章） |
| `#md-door` | 闺房门暖光 |
| `#md-ripple` | 水波过场 |
| `#md-click-prompt` | 「点击进入游戏」按钮（仅 talkEnd 状态） |
| `#md-skip-dialogue` | 「跳过对白」按钮（仅 runDialogue 期间） |
| `#md-level-choice` | 音游关卡选择卡片（重玩 / 下一折 / 主线） |
| `#md-finale` | 结算页（4 种杜丽娘形象 + 题词 + 重新/结束按钮） |
| `#rhythm-stage` | 音游覆盖层（z-index:40，含 React 音游） |

**z-index 层级**： Theatre=40 < Skip=55 < Reward=70 < LevelChoice=75 < Finale=60（顺序定制以适配出场时机）。

## 8. 钱包 / NFT（可选）

`web3.ts` + `web3-config.ts` + `nft-panel.ts` 提供可选的链上铸造功能：

- 玩家通关后可铸造一个 ShadowRelic NFT 作为纪念
- 基于 viem + WalletConnect，EIP-712 签名 + 链上 claim
- 未配置 `NFT_CONTRACT_ADDRESS` / `GAME_SIGNER_PRIVATE_KEY` 时自动降级为"待配置"提示，不影响主线流程

配置详见 [`docs/wallet-setup.md`](wallet-setup.md)。

## 9. 开发指南

### 9.1 本地运行

```bash
npm install      # 安装依赖
npm run dev      # 启动开发服务器（默认 http://localhost:5173）
npm run build    # 生产构建
npm run preview  # 预览构建产物
npx tsc --noEmit # 类型检查（无输出）
```

### 9.2 调整剧情参数

所有剧情节点的世界坐标在 `src/story-stage.ts` 顶部常量区（`CHAMBER`、`THEATRE`、`GARDEN` 等）。自动推进的时间间隔（`KNOCK_INTERVAL`、`REWARD_HOLD` 等）也在同一区域。

### 9.3 调试钩子

- `window.__story` —— StoryStage 实例，可在 Console 中调用 `__story.enter("finale")` 等跳转到指定状态
- URL 参数 `?finale=awaken|explore|firm|free` —— 直接预览指定类型的结算页

### 9.4 添加场景段

1. 在 `index.html` 的每个 `.layer` 内增加 `.half` div
2. 在 `style.css` 增加对应的背景图类
3. 更新 `SCENE_W` 和 `--scene-w`（CSS 变量）
4. 更新世界坐标常量和 `WORLD_RIGHT`

### 9.5 铜镜 / 绿幕抠像

铜镜源图（`mirror-raw.png`）为绿幕拍摄。使用 `scripts/cutout.mjs` 或 sharp 进行色度抠像：绿色背景（`g >> r, b`）→ alpha=0，软边过渡，去溢色。输出为 RGBA PNG。

花园场景的 `s2-mid.png` / `s2-front.png` 同为绿幕层，运行时由 `chromaKeyLayer()` 在 canvas 上去绿后转 ObjectURL 注入。

## 10. 已知限制

- 音游剧情（`story.json`）的 outro 分支未使用 `grade` / `minRatio` 字段，结局选择依赖数组顺序。当前 intro 与 outro 阶段已在 UI 中跳过，仅保留 performance。
- `public/audio/chamber/` 中保留了多个旧版的对白切片文件（`garden-line{1,2,3}.wav`、`mirror-line{1,2,3,4}.wav`、`garden-quote.wav`），目前代码使用的是完整版（`garden-who-are-you.m4a` / `mirror-who-am-i.m4a` / `garden-quote.mp3`），切片文件仅供向后兼容。
- 项目路径含中文字符，Vite 预打包 three 会失败，已在 `vite.config.ts` 中排除（`optimizeDeps.exclude: ["three", ...]`）。
- 前景层不能贴满图（z-index 6 > 角色层 5），否则遮挡角色。
- `sources/audio/` 内含两个大文件（`rhythm-bgm-source.flac` 91MB、`main-bgm-source.flac` 63MB），超过 GitHub 推荐的 50MB 单文件阈值；push 时 GitHub 会给出大文件警告但仍接收。如需彻底解决可改用 [Git LFS](https://git-lfs.github.com)。
