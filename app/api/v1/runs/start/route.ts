import { currentChallenge, isDifficulty } from "../../../../game-rules";
import { database, ensureSchema } from "../../../_lib/database";
import { apiError, apiJson, readJson } from "../../../_lib/http";
import { getStory, STORY_VERSION } from "../../../_lib/story";

type StartRequest = { storyId?: string; difficulty?: unknown };

export async function POST(request: Request) {
  try {
    const input = await readJson<StartRequest>(request);
    const storyId = String(input.storyId || "");
    if (!getStory(storyId) || !isDifficulty(input.difficulty)) {
      return apiError("INVALID_REQUEST", "storyId 或 difficulty 无效", 400);
    }
    await ensureSchema();
    const db = database();
    const runId = crypto.randomUUID();
    const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
    const nonce = `0x${Array.from(nonceBytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const challenge = currentChallenge();
    const startedAt = Date.now();
    await db.prepare(
      `INSERT INTO runs
       (id, story_id, story_version, season_id, difficulty, challenge_date, nonce, started_at, verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).bind(
      runId, storyId, STORY_VERSION, challenge.seasonId, input.difficulty,
      challenge.date, nonce, startedAt,
    ).run();
    return apiJson({
      runId,
      nonce,
      storyId,
      storyVersion: STORY_VERSION,
      seasonId: challenge.seasonId,
      challengeDate: challenge.date,
      difficulty: input.difficulty,
      startedAt,
    }, 201);
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE")) {
      return apiError("INVALID_REQUEST", "请求 JSON 无效或过大", 400);
    }
    console.error("start run failed", error);
    return apiError("SERVICE_UNAVAILABLE", "演出服务暂不可用", 503);
  }
}
