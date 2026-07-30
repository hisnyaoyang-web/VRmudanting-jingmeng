# 梦入牡丹亭 · 寻回杜丽娘

一款以皮影戏长卷为载体的互动叙事体验。玩家操控杜丽娘的影子，沿一条连续画卷从闺房走向花园，途中穿过一幕皮影戏台。全程无按键推进剧情——走到哪里，故事就发生到哪里。

## 快速开始

```bash
npm install      # 安装依赖
npm run dev      # 启动开发服务器
npx tsc --noEmit # 类型检查
npm run build    # 生产构建
```

开发服务器默认运行在 `http://localhost:5173/`，打开根路径即为完整体验。

## 操作方式

| 输入 | 效果 |
| --- | --- |
| ← / → 或 A / D（按住） | 左右移动 |
| 触屏 / 鼠标左半屏按住 | 向左移动 |
| 触屏 / 鼠标右半屏按住 | 向右移动 |

剧情全部自动展开，无需任何按键。音游阶段使用 WASD + JKL 进行音符判定；对白期间右下角有「跳过」按钮；音游期间右上角有「退出」按钮可回到花园重新进入。

## 文档

- [设计文档](docs/DESIGN.md) — 玩法流程、场景布局、视觉系统、叙事结构、交互规范
- [技术文档](docs/TECHNICAL.md) — 架构、构建、状态机、渲染管线、音游集成、资产规格
- [钱包/NFT 配置](docs/wallet-setup.md) — 可选的链上铸造功能配置说明

## 技术栈

Vite 7 · TypeScript 5 · Three.js 0.185 · React 19 · @react-three/fiber 9

## 项目结构

```text
src/
├── main.ts             引导与 RAF 循环
├── story-stage.ts      核心控制器（状态机、相机、长卷、UI、音游桥接）
├── puppet.ts           皮影人偶 Three.js 渲染
├── effects.ts          粒子 / 屏幕特效
├── vr-layer.ts         WebXR / VR 入口（可选）
├── nft-panel.ts        结算 NFT 铸造面板（可选）
├── web3.ts / web3-config.ts  链上交互（可选，未配置时自动降级）
├── style.css           长卷舞台样式
└── rhythm/             嵌入式音游（React + R3F，WASD/JKL 落键）
public/
├── scenes/             场景分层图（s1/s2 后中前三层 + chroma key 绿幕图）
├── piying/             皮影 GLB 模型
├── characters/         结算 4 种杜丽娘形象立绘
├── props/              碎片 / 道具图
├── mirror/             铜镜图片
├── audio/              BGM 与对白音频（main / chamber / rhythm 三组）
└── stories/            音游剧情 JSON
sources/audio/          外部音频源文件归档（FLAC / m4a 原始素材，便于重新剪辑）
docs/                   设计与技术文档
```
