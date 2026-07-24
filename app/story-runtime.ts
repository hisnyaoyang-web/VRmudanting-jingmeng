export type StoryAction = "left" | "right" | "up" | "down" | "salute" | "run" | "flying";
export type StoryGrade = "excellent" | "good" | "bad";

export type CastMember = {
  name: string;
  portrait?: string;
  side: "left" | "center" | "right";
};

export type DialogueBeat = {
  speaker: string;
  text: string;
  expression?: string;
  durationMs?: number;
};

export type StoryCue = {
  id: string;
  atMs: number;
  windowMs: number;
  action: StoryAction;
  label: string;
  points: number;
  required: boolean;
};

export type StoryCondition = {
  path: "current.grade" | "current.scoreRatio" | "history.playCount" | "history.lastGrades";
  op: "eq" | "gte" | "tailEquals" | "in";
  value: unknown;
};

export type StoryBranch = {
  id: string;
  priority: number;
  default?: boolean;
  when?: StoryCondition[];
  beats: DialogueBeat[];
  nextStoryId?: string;
};

export type StoryPackage = {
  schemaVersion: "1.0";
  id: string;
  title: string;
  customerId: string;
  assetBaseUrl?: string;
  cast: Record<string, CastMember>;
  intro: {
    textPlayback: { charsPerSecond: number };
    beats: DialogueBeat[];
  };
  performance: {
    durationMs: number;
    textPlayback: { charsPerSecond: number };
    lines: Array<{ atMs: number; speaker: string; text: string }>;
    cues: StoryCue[];
    scoring: {
      perfectRatio: number;
      goodRatio: number;
      grades: Array<{ id: StoryGrade; minScoreRatio: number }>;
    };
  };
  outroBranches: StoryBranch[];
};

export type CustomerHistory = {
  customerId: string;
  playCount: number;
  lastGrades: StoryGrade[];
};

const ACTIONS = new Set<StoryAction>(["left", "right", "up", "down", "salute", "run", "flying"]);

export function validateStory(input: unknown): StoryPackage {
  if (!input || typeof input !== "object") throw new Error("剧情 JSON 必须是对象");
  const story = input as Partial<StoryPackage>;
  if (story.schemaVersion !== "1.0") throw new Error("仅支持剧情接口 1.0");
  if (!story.id || !story.title || !story.customerId) throw new Error("剧情缺少 id、title 或 customerId");
  if (!story.cast || !story.intro || !story.performance || !story.outroBranches) {
    throw new Error("剧情缺少 cast、intro、performance 或 outroBranches");
  }
  if (story.performance.durationMs < 1000 || story.performance.durationMs > 120000) {
    throw new Error("演出时长必须在 1–120 秒之间");
  }
  for (const cue of story.performance.cues) {
    if (!ACTIONS.has(cue.action) || cue.atMs < 0 || cue.windowMs <= 0) {
      throw new Error(`动作提示 ${cue.id || "unknown"} 无效`);
    }
  }
  if (!story.outroBranches.some((branch) => branch.default)) {
    throw new Error("剧情必须提供 default 结束分支");
  }
  return story as StoryPackage;
}

export function resolveAsset(storyUrl: string, story: StoryPackage, asset?: string) {
  if (!asset) return "";
  const base = story.assetBaseUrl ? new URL(story.assetBaseUrl, storyUrl) : new URL(".", storyUrl);
  return new URL(asset, base).toString();
}

export function loadHistory(customerId: string): CustomerHistory {
  const empty = { customerId, playCount: 0, lastGrades: [] as StoryGrade[] };
  try {
    const saved = localStorage.getItem(`shadowplay:history:${customerId}`);
    if (!saved) return empty;
    const parsed = JSON.parse(saved) as CustomerHistory;
    return parsed.customerId === customerId ? parsed : empty;
  } catch {
    return empty;
  }
}

export function recordGrade(customerId: string, grade: StoryGrade): CustomerHistory {
  const current = loadHistory(customerId);
  const next = {
    customerId,
    playCount: current.playCount + 1,
    lastGrades: [...current.lastGrades, grade].slice(-8),
  };
  localStorage.setItem(`shadowplay:history:${customerId}`, JSON.stringify(next));
  return next;
}

function getPath(path: StoryCondition["path"], state: { current: { grade: StoryGrade; scoreRatio: number }; history: CustomerHistory }) {
  if (path === "current.grade") return state.current.grade;
  if (path === "current.scoreRatio") return state.current.scoreRatio;
  if (path === "history.playCount") return state.history.playCount;
  return state.history.lastGrades;
}

function matches(condition: StoryCondition, state: { current: { grade: StoryGrade; scoreRatio: number }; history: CustomerHistory }) {
  const actual = getPath(condition.path, state);
  if (condition.op === "eq") return actual === condition.value;
  if (condition.op === "gte") return Number(actual) >= Number(condition.value);
  if (condition.op === "in") return Array.isArray(condition.value) && condition.value.includes(actual);
  if (condition.op === "tailEquals") {
    if (!Array.isArray(actual) || !Array.isArray(condition.value)) return false;
    return actual.slice(-condition.value.length).every((value, index) => value === condition.value[index]);
  }
  return false;
}

export function resolveBranch(
  story: StoryPackage,
  grade: StoryGrade,
  scoreRatio: number,
  history: CustomerHistory,
) {
  const state = { current: { grade, scoreRatio }, history };
  const branches = [...story.outroBranches].sort((a, b) => b.priority - a.priority);
  return branches.find((branch) => !branch.default && (branch.when ?? []).every((condition) => matches(condition, state)))
    ?? branches.find((branch) => branch.default)
    ?? branches[branches.length - 1];
}

export function gradeScore(story: StoryPackage, scoreRatio: number): StoryGrade {
  return [...story.performance.scoring.grades]
    .sort((a, b) => b.minScoreRatio - a.minScoreRatio)
    .find((item) => scoreRatio >= item.minScoreRatio)?.id ?? "bad";
}
