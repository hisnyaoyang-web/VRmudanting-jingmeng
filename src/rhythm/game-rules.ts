import type { StoryAction, StoryGrade, StoryPackage } from "./story-runtime";

export type Difficulty = "apprentice" | "stage" | "master";
export type RunInput = { action: StoryAction; atMs: number };

export const DIFFICULTIES: Record<Difficulty, { label: string; windowScale: number; cueLimit?: number; scoreScale: number }> = {
  apprentice: { label: "入门", windowScale: 1.55, cueLimit: 4, scoreScale: 0.8 },
  stage: { label: "正戏", windowScale: 1, scoreScale: 1 },
  master: { label: "名角", windowScale: 0.72, scoreScale: 1.25 },
};

export function isDifficulty(value: unknown): value is Difficulty {
  return value === "apprentice" || value === "stage" || value === "master";
}

export function playableCues(story: StoryPackage, difficulty: Difficulty) {
  const config = DIFFICULTIES[difficulty];
  const cues = config.cueLimit ? story.performance.cues.slice(0, config.cueLimit) : story.performance.cues;
  return cues.map((cue) => ({ ...cue, windowMs: Math.round(cue.windowMs * config.windowScale) }));
}

export function scoreRun(story: StoryPackage, difficulty: Difficulty, events: RunInput[]) {
  const config = DIFFICULTIES[difficulty];
  const cues = playableCues(story, difficulty);
  const used = new Set<number>();
  let rawScore = 0;
  let bestCombo = 0;
  let combo = 0;
  const judgments: Array<"perfect" | "good" | "miss"> = [];

  for (const cue of cues) {
    let match = -1;
    let distance = Number.POSITIVE_INFINITY;
    events.forEach((event, index) => {
      const delta = Math.abs(event.atMs - cue.atMs);
      if (!used.has(index) && event.action === cue.action && delta < distance) {
        match = index;
        distance = delta;
      }
    });
    if (match < 0 || distance > cue.windowMs / 2) {
      judgments.push("miss");
      combo = 0;
      continue;
    }
    used.add(match);
    const perfect = distance / (cue.windowMs / 2) <= story.performance.scoring.perfectRatio;
    rawScore += Math.round(cue.points * (perfect ? 1 : 0.7));
    combo += 1;
    bestCombo = Math.max(bestCombo, combo);
    judgments.push(perfect ? "perfect" : "good");
  }

  const maxRaw = cues.reduce((sum, cue) => sum + cue.points, 0);
  const ratio = maxRaw ? rawScore / maxRaw : 0;
  const grade: StoryGrade = [...story.performance.scoring.grades]
    .sort((a, b) => b.minScoreRatio - a.minScoreRatio)
    .find((item) => ratio >= item.minScoreRatio)?.id ?? "bad";
  return {
    score: Math.round(rawScore * config.scoreScale),
    ratio,
    grade,
    bestCombo,
    judgments,
    maxScore: Math.round(maxRaw * config.scoreScale),
  };
}

export function currentChallenge(now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const yearStart = Date.UTC(now.getUTCFullYear(), 0, 1);
  const day = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - yearStart) / 86_400_000);
  const season = Math.floor(day / 28) + 1;
  return { date, seasonId: `${now.getUTCFullYear()}-S${String(season).padStart(2, "0")}` };
}
