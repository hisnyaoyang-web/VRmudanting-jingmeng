# 园中影铺剧情接口 v1

剧情包由一个 JSON 文件和若干图片、音频资源组成。游戏运行时代码只负责加载、
播放、输入判定、计分和分支选择；新增或修改剧情不需要改 React/Three.js 代码。

## 1. 接入方式

运行时接收一个 `storyUrl`：

```text
/stories/moongate-night/story.json
https://content.example.com/shadowplay/moongate-night/story.json
```

- 本地剧情包放在 `public/stories/<story-id>/`。
- 远程地址必须使用 HTTPS，并允许浏览器跨域 GET。
- 相对资源地址以 JSON 文件所在目录为基准；也可以通过 `assetBaseUrl` 指定资源根目录。
- 服务端应返回 `Content-Type: application/json; charset=utf-8`。
- v1 资源格式：立绘使用 PNG/WebP，音频使用 MP3/OGG。

## 2. 顶层结构

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schemaVersion` | `"1.0"` | 接口版本 |
| `id` | string | 全局唯一剧情 ID |
| `title` | string | 剧情名称 |
| `customerId` | string | 用于累计该客人的演出历史 |
| `assetBaseUrl` | string? | 可选资源根目录 |
| `cast` | object | 角色与立绘 |
| `intro` | object | 上场 GAL 对话 |
| `performance` | object | 演出正文、动作判定和评分 |
| `outroBranches` | array | 结束剧情状态机 |

## 3. 人物与立绘

```json
{
  "cast": {
    "madam_luo": {
      "name": "罗夫人",
      "portrait": "./portraits/madam-luo.webp",
      "side": "right"
    }
  }
}
```

`side` 可为 `left`、`center`、`right`。人物面板由 WebSpatial 悬浮在舞台上方；
普通浏览器自动降级为二维 GAL 对话框。

## 4. 上场对话

`intro.beats` 按数组顺序播放。`durationMs` 缺省时，运行时根据
`textPlayback.charsPerSecond` 计算展示时长。

```json
{
  "intro": {
    "textPlayback": { "charsPerSecond": 6 },
    "beats": [
      {
        "speaker": "madam_luo",
        "text": "掌柜，今夜还演《月门照影》？",
        "expression": "calm",
        "durationMs": 2800
      }
    ]
  }
}
```

## 5. 演出时间轴

台词根据 `atMs` 在固定时间轴上匀速显示。动作提示在 `atMs` 到
`atMs + windowMs` 之间接受输入。

支持的 v1 动作：

```text
left, right, up, down, salute, run, flying
```

```json
{
  "performance": {
    "durationMs": 18000,
    "textPlayback": { "charsPerSecond": 7 },
    "lines": [
      {
        "atMs": 0,
        "speaker": "narrator",
        "text": "月照空庭，武生推门而入。"
      }
    ],
    "cues": [
      {
        "id": "enter-salute",
        "atMs": 1800,
        "windowMs": 700,
        "action": "salute",
        "label": "入门见礼",
        "points": 100,
        "required": true
      }
    ],
    "scoring": {
      "perfectRatio": 0.28,
      "goodRatio": 0.68,
      "grades": [
        { "id": "excellent", "minScoreRatio": 0.82 },
        { "id": "good", "minScoreRatio": 0.55 },
        { "id": "bad", "minScoreRatio": 0 }
      ]
    }
  }
}
```

命中精度按动作窗口中心计算；错误动作和超时均记为失拍。最终状态至少包含：

```json
{
  "current": { "score": 460, "scoreRatio": 0.76, "grade": "good" },
  "history": {
    "customerId": "madam_luo",
    "playCount": 2,
    "lastGrades": ["bad", "good"]
  }
}
```

历史状态第一版保存在设备本地；未来接账号系统时可替换存储层，不改变剧情格式。

## 6. 结束剧情状态机

分支按 `priority` 从高到低匹配，命中第一条后停止。`when` 中的条件全部成立才算
匹配。v1 支持：

- `eq`：值相等
- `gte`：数值大于等于
- `tailEquals`：数组末尾与给定数组一致
- `in`：值属于给定数组

```json
{
  "id": "bad-then-good",
  "priority": 80,
  "when": [
    {
      "path": "history.lastGrades",
      "op": "tailEquals",
      "value": ["bad", "good"]
    }
  ],
  "beats": [
    {
      "speaker": "madam_luo",
      "text": "昨日手生，今日却稳住了。你这掌柜，肯下功夫。",
      "durationMs": 3600
    }
  ],
  "nextStoryId": "lost-opera-house"
}
```

每个剧情必须提供 `default: true` 的兜底分支。

## 7. 资源与校验约束

- JSON 最大 512KB。
- 单张立绘建议不超过 300KB，最长边不超过 1536px。
- 一折演出建议 15–90 秒，动作判定不超过 30 个。
- `id`、角色 key、cue `id` 仅使用小写字母、数字和连字符。
- 运行时加载后必须先校验字段；无效剧情显示错误页，不进入舞台。
- JSON 中不接受 HTML、JavaScript 或任意可执行代码。
- 远程资源应设置 CORS，并建议通过内容哈希或版本化 URL 发布。

## 8. 推荐目录

```text
public/stories/moongate-night/
├── story.json
├── portraits/
│   ├── madam-luo.webp
│   └── shopkeeper.webp
└── audio/
    ├── intro.mp3
    └── performance.mp3
```

完整示例见：

```text
public/stories/moongate-night/story.json
```
