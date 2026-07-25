# WebSpatial 前后场 + WebXR 演出

## 运行模型

本项目遵循 WebSpatial Runtime 的合成边界：

1. 开场、钱包、难度、排行榜使用 WebSpatial 空间化 HTML；
2. 进入 `immersive-vr` 后，WebSpatial 页面由系统隐藏；
3. WebXR 内由 Three.js 渲染舞台、HUD、3D 节奏轨道和空间音效；
4. 演出完成后主动结束 XR session；
5. WebSpatial 页面恢复并展示结局、可信成绩和铸造流程。

WebSpatial UI 不尝试覆盖在 immersive WebXR 上方。需要在演出期间可见的信息必须在
Three.js 世界中绘制。

## 演出生命周期

```text
WebSpatial intro
  → phase=performance, playing=false
  → 玩家点击「登台演出」
  → requestSession("immersive-vr")
  → 创建新的 runId，重置输入和成绩
  → AudioContext 时钟启动
  → 3D 音符、动画、字幕和判定共用该时钟
  → 演出完成并提交服务端复算
  → session.end()
  → WebSpatial outro / claim
```

若玩家通过系统按钮提前退出 WebXR，本局标记为中止、清除 runId，不提交排行榜或奖励；
再次登台会创建一局全新演出。

## WebXR 内显示

- 舞台上方：故事、难度、得分、连击、当前判定；
- 舞台前方：弧面感的七轨判定区；
- 音符：发光八面体沿 Z 轴飞向判定环；
- 控制说明和台词：舞台下方 CanvasTexture 面板；
- 控制器：摇杆移动，扳机执行见礼/飞袖，握键疾行。

## 音频同步

`AudioContext.currentTime` 是 WebXR 演出的主时钟。Three.js frame loop 只读取时钟并计算
当前位置，不累加渲染帧 delta，因此短暂掉帧不会造成节奏永久漂移。

当前 MVP 使用程序化空间打击乐：

- 每 600 ms 从舞台左右交替发出低频板拍；
- 关键 cue 在对应轨道位置触发 HRTF 定位音；
- 视觉音符、空间音效和服务端 cue 时间使用相同的 3 秒 lead-in。

后续接入正式配乐时，主伴奏使用非定位 `AudioBufferSourceNode`，锣鼓、台词和判定反馈
继续使用 `PannerNode`，且所有 source 共用同一个 `audioStartTime`。

## PICO 验收

1. 在 PICO Browser 打开 HTTPS 正式地址；
2. 选择 **Run as a standalone app**；
3. 确认开场对话、钱包和信息面板为 WebSpatial 空间 UI；
4. 完成开场后，演出保持候场且显示「登台演出」；
5. 点击后进入 WebXR，原 HTML UI 按预期隐藏；
6. 确认舞台上方出现 Three.js HUD，舞台前方出现 3D 音轨；
7. 转头时左右板拍具有空间方向感；
8. 完整演出后应自动退出 WebXR 并恢复 WebSpatial 结算；
9. 系统按钮中途退出时不应发放影纹或提交成绩；
10. 再次登台后时间、音符、得分和输入必须从零开始。

可通过桌面 Chrome 的 `chrome://inspect/#devices` 连接 PICO Web App Runtime，检查：

- User-Agent 是否包含 `WebSpatial/`；
- `navigator.xr.isSessionSupported("immersive-vr")` 是否为 `true`；
- manifest 是否以 `application/manifest+json` 返回；
- session 的 `end` 事件是否触发；
- AudioContext 是否处于 `running`。
