# 梦入牡丹亭 · 寻回杜丽娘 — 技术文档

> 面向开发者：架构、构建、状态机、渲染管线、音游集成、资产规格

## 1. 技术栈

| 层 | 技术 | 说明 |
| --- | --- | --- |
| 构建 | Vite 7 + TypeScript 5 | 单页应用，`tsconfig` 仅做类型检查（`noEmit`），实际编译由 Vite 接管 |
| 长卷舞台 | 原生 DOM + CSS 变换 | 四层视差画卷，靠 `translate3d` 平移 |
| 皮影人偶 | Three.js 0.185 + GLTFLoader | 独立透明 WebGL 画布，叠加在长卷之上 |
| 音游 | React 19 + @react-three/fiber 9 + drei 10 | R3F 戏台场景、下落音符、键盘判定，按需挂载/卸载 |
| 剧情数据 | JSON（`StoryPackage` schema 1.0） | 独立于代码，可热替换 |

依赖清单见 `package.json`：
`three`、`react`、`react-dom`、`@react-three/fiber`、`@react-three/drei`。
开发依赖：`typescript`、`vite`、各 `@types` 包。

## 2. 项目结构

```text
皮影戏小游戏/
├── index.html              入口 HTML，定义长卷 DOM 骨架（四层 + 屏柱 SVG）
├── package.json            脚本：dev / build / preview
├── vite.config.ts          Vite 配置（排除 three 预打包以兼容中文路径）
├── tsconfig.json           严格模式，仅 src/，react-jsx
├── src/
│   ├── main.ts             引导：创建 FlatStage、启动 RAF 循环、加载皮影
│   ├── scene.ts            核心控制器 FlatStage：状态机、相机、长卷、UI 注入、音游桥接
│   ├── puppet.ts           Puppet 类：Three.js 皮影渲染（GLB 加载、动作重定向、材质抠像）
│   ├── style.css           长卷舞台样式（四层、视差、屏柱、UI 浮层定位）
│   ├── rhythm.ts           (遗留辅助，已被 src/rhythm/ 取代)
│   ├── tiny.ts             (空占位)
│   └── rhythm/             原版音游逐字移植
│       ├── rhythm-mount.ts         挂载/卸载 React 音游到 DOM 容器
│       ├── rhythm-experience.tsx   音游主组件（状态机、对话、评分、键盘输入）
│       ├── shadow-stage.tsx        R3F 戏台场景（皮影模型、灯光、音符、UI）
│       ├── game-rules.ts           评分规则（难度、判定窗口、perfect/good/miss）
│       └── story-runtime.ts        剧情 JSON 校验、资产解析、结局分支
├── public/
│   ├── scenes/             长卷场景分层图（s1/s2 的 back/mid/front，PNG）
│   ├── piying/             皮影 GLB 模型与贴图
│   ├── stage/              月门戏台背景
│   ├── mirror/             铜镜图片（已抠绿，RGBA PNG）
│   ├── papercut/           剪纸装饰素材
│   └── stories/moongate-night/story.json   音游剧情数据
├── scripts/                离线工具脚本（GLB 检查、抠图）
└── docs/                   本文档
```

## 3. 渲染架构

### 3.1 长卷四层视差

整个舞台是一条连续画卷（`.panorama`），宽度为视口的 4.2 倍（`3 × SCENE_W`，`SCENE_W = 1.4`），内含三段：

```text
┌──────────────┬──────────────┬──────────────┐
│  场景1 闺房   │  戏台（中段）  │  场景2 花园   │
│  33.3%       │  33.3%       │  33.3%       │
└──────────────┴──────────────┴──────────────┘
```

每段场景由三层图片叠加（后景、中后景、前景），构成四层 z-index 轴：

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

**关键约束**：前景层（z-index 6）比角色层（z-index 5）高，因此前景图必须保持透明区域——不能整张贴图，否则会盖住角色。花园的中后景/前景是绿幕抠图层，运行时由 `chromaKeyLayer()` 去除 `rgb(0,255,0)` 后注入为 background-image。

### 3.2 相机跟随

角色（`charX`）在世界坐标系移动，相机（`camX`）跟随：

```text
camX → clamp(charX - 0.42, 0, SCROLL_MAX)
```

每帧用阻尼平滑：`camX += (target - camX) × min(1, dt × 6)`。

平移通过 `panorama.style.transform = translate3d(-camX × vw, 0, 0)` 实现。
角色画布的 `left` 直接设为 `charX × vw`（世界坐标 → 像素），由平移的 panorama 带走。

### 3.3 皮影人偶（Puppet 类）

独立的 Three.js 渲染器，输出透明画布，叠在长卷角色层上。

**模型加载**：一个带骨骼的主模型（`piying-man-rig-hi.glb`）+ 三个动捕动画 GLB（walk/run/flying）。动捕动画通过 `retargetClip()` 按"静止姿态差值"重定向到主骨架。

**材质抠像**：`preparePuppetMaterial()` 在着色器中插入 discard 逻辑，剔除：
- 编辑器绿色骨骼辅助色（`g > 0.72, r < 0.34, b < 0.34`）
- 黄色辅助标记
- 编辑器灰色
- 过亮像素（亮度 > 0.965）

**动作状态**：`idle`（停在 hi 第一帧）、`walk`（循环）、`hi`（单次）、`run`（循环）、`flying`（单次，配 Y 位移）。

**朝向翻转**：用阻尼插值 `scale.x` 实现平滑转身，不是硬翻转。

## 4. 状态机

`FlatStage` 是核心控制器，内部维护一个线性状态机。所有剧情靠"走到区域 + 计时器"自动推进，全程无强制按键。

```text
intro ──[点击开始]──→ approach ──[走到门口]──→ (4次自动敲门) ──→ leaveText
    ──[4.5s]──→ rewardHands ──[3.6s]──→ freeRoam ──[走到戏台中心]──→ toTheatre
    ──[自动挂载音游]──→ rhythm ──[音游结束回调]──→ rhythmDone ──[2.4s]──→ gardenRoam
    ──[走到对话点]──→ gardenTalk ──[6句自动对话]──→ rewardFeet ──[3.6s]──→ toMirror
    ──[走到镜面]──→ assemble ──[自动拼合6.8s]──→ rewardTorso ──[3.6s]──→ ripple
    ──[2.2s]──→ finale ──[重新/结束]
```

### 关键世界坐标（视口宽比例）

```text
CHAMBER  = { left: 0.168, door: 1.064, start: 0.42 }
SEAM1    = 1.4     (第一道接缝)
THEATRE  = { enter: 1.512, center: 2.1, exit: 2.688 }
SEAM2    = 2.8     (第二道接缝)
GARDEN   = { left: 2.912, talk: 3.08, mirror: 3.738 }
WORLD    = [0.04, 4.16]
```

触发容差统一为 `0.06`（视口宽比例）。

### 输入

| 输入 | 效果 |
| --- | --- |
| ← / A（按住） | 向左移动 |
| → / D（按住） | 向右移动 |
| 触屏左半屏按住 | 向左移动 |
| 触屏右半屏按住 | 向右移动 |
| 鼠标移动 | 触发轻微视差（`tmx`/`tmy`） |

移动在任何状态都生效（音游期间暂停长卷移动）。无任何交互键——剧情全自动。

## 5. 音游集成

音游是原版 React 项目的逐字移植，封装为可挂载/卸载的组件。

### 5.1 挂载流程

1. `freeRoam` 状态下角色走到 `THEATRE.center`，触发 `enter("toTheatre")`
2. `enter("toTheatre")` 调用 `ensureTheatre()`：创建 `#rhythm-stage` 覆盖层（position:fixed, z-index:40），立即显示
3. `mountRhythm()` 用 `createRoot` 把 `RhythmExperience` 组件渲染进容器
4. 状态切到 `rhythm`，长卷移动暂停，相机锁定在戏台中心

### 5.2 音游内部状态机

```text
loading ──[fetch story.json]──→ intro ──[对话自动播放]──→ performance ──[音乐结束]──→ outro ──[自动]──→ onFinish回调
```

intro 和 outro 的对话会自动逐字播放并自动推进（无需点击）。performance 阶段为下落音符 + 键盘判定。

### 5.3 评分规则（game-rules.ts）

三档难度（入门/正戏/名角），影响判定窗口宽度和音符数量。判定分 perfect / good / miss，按得分比例给出 excellent / good / bad 评级。

### 5.4 卸载流程

音游 `onFinish` 回调 → `enter("rhythmDone")` → `hideTheatre()`：淡出覆盖层，300ms 后 `unmountRhythm()` 卸载 React 树，移除 DOM。角色出现在戏台出口，继续走向花园。

## 6. UI 系统

所有 UI 浮层由 `FlatStage` 在运行时注入到 DOM（`UI_STYLE` 常量），CSS 内联在 scene.ts 中。包括：

| 元素 | 作用 |
| --- | --- |
| `#md-intro` | 开场说明页 + "开始体验"按钮 |
| `#md-act` | 幕题（第一/二/三幕），自动淡入淡出 |
| `#md-sub` | 字幕条（台词 + 说话者），底部居中 |
| `#md-reward` | 碎片奖励卡片，自动弹出自动消失 |
| `#md-mirror` | 铜镜（图片 + 碎片徽章） |
| `#md-door` | 闺房门暖光 |
| `#md-ripple` | 水波过场 |
| `#md-finale` | 结算页（评级 + 关键词 + 重新/结束按钮） |

## 7. 开发指南

### 本地运行

```bash
npm install      # 安装依赖
npm run dev      # 启动开发服务器（默认 http://localhost:5199）
npm run build    # 生产构建
npm run preview  # 预览构建产物
npx tsc --noEmit # 类型检查（无输出）
```

### 调整剧情参数

所有剧情节点的世界坐标在 `src/scene.ts` 顶部常量区（`CHAMBER`、`THEATRE`、`GARDEN` 等）。自动推进的时间间隔（`KNOCK_INTERVAL`、`TALK_INTERVAL`、`REWARD_HOLD` 等）也在同一区域。

### 添加场景段

1. 在 `index.html` 的每个 `.layer` 内增加 `.half` div
2. 在 `style.css` 增加对应的背景图类
3. 更新 `SCENE_W` 和 `--scene-w`（CSS 变量）
4. 更新世界坐标常量和 `WORLD_RIGHT`

### 铜镜图片处理

铜镜源图（`mirror-raw.png`）为绿幕拍摄。使用 `scripts/cutout.mjs` 或 sharp 进行色度抠像：绿色背景（`g >> r, b`）→ alpha=0，软边过渡，去溢色。输出为 RGBA PNG。

## 8. 已知限制

- 音游剧情（`story.json`）的 outro 分支未使用 `grade`/`minRatio` 字段，结局选择依赖数组顺序。
- `.ref-rhythm/` 是原版参考项目快照，不参与构建，仅供对照。
- 项目路径含中文字符，Vite 预打包 three 会失败，已在 `vite.config.ts` 中排除。
- 前景层不能贴满图（z-index 6 > 角色层 5），否则遮挡角色。
