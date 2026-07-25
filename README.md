# 梦入牡丹亭 · 寻回杜丽娘

一款以皮影戏长卷为载体的互动叙事体验。玩家操控杜丽娘的影子，沿一条连续画卷从闺房走向花园，途中穿过一幕皮影戏台。全程无按键推进剧情——走到哪里，故事就发生到哪里。

## 快速开始

```bash
npm install      # 安装依赖
npm run dev      # 启动开发服务器
npx tsc --noEmit # 类型检查
npm run build    # 生产构建
```

开发服务器默认运行在 `http://localhost:5199/`。

## 操作方式

| 输入 | 效果 |
| --- | --- |
| ← / → 或 A / D（按住） | 左右移动 |
| 触屏 / 鼠标左半屏按住 | 向左移动 |
| 触屏 / 鼠标右半屏按住 | 向右移动 |

剧情全部自动展开，无需任何按键。音游阶段使用 WASDJ KL 进行音符判定。

## 文档

- [设计文档](docs/DESIGN.md) — 玩法流程、场景布局、视觉系统、叙事结构、交互规范
- [技术文档](docs/TECHNICAL.md) — 架构、构建、状态机、渲染管线、音游集成、资产规格

## 技术栈

Vite 7 · TypeScript 5 · Three.js 0.185 · React 19 · @react-three/fiber 9

## 项目结构

```text
src/
├── main.ts             引导与 RAF 循环
├── scene.ts            核心控制器（状态机、相机、长卷、UI、音游桥接）
├── puppet.ts           皮影人偶 Three.js 渲染
├── style.css           长卷舞台样式
└── rhythm/             原版音游（React + R3F）
public/
├── scenes/             场景分层图
├── piying/             皮影 GLB 模型
├── mirror/             铜镜图片
└── stories/            音游剧情 JSON
```
