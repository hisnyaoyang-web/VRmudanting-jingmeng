import { database, ensureSchema } from "../../_lib/database";
import { apiError, apiJson } from "../../_lib/http";
import { currentChallenge } from "../../../game-rules";
import { getStory } from "../../_lib/story";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const storyId = url.searchParams.get("storyId") || "moongate-night";
    const seasonId = url.searchParams.get("seasonId") || currentChallenge().seasonId;
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));
    if (!getStory(storyId) || !/^[0-9]{4}-S[0-9]{2}$/.test(seasonId)) {
      return apiError("INVALID_REQUEST", "storyId 或 seasonId 无效", 400);
    }
    await ensureSchema();
    const rows = await database().prepare(
      `SELECT wallet_address, MAX(score) AS score,
       CASE MAX(CASE grade WHEN 'excellent' THEN 2 WHEN 'good' THEN 1 ELSE 0 END)
         WHEN 2 THEN 'excellent' WHEN 1 THEN 'good' ELSE 'bad' END AS grade,
       MAX(difficulty) AS difficulty
       FROM runs WHERE story_id = ? AND season_id = ? AND verified = 1 AND wallet_address IS NOT NULL
       GROUP BY wallet_address ORDER BY score DESC, MIN(finished_at) ASC LIMIT ?`,
    ).bind(storyId, seasonId, limit).all<{
      wallet_address: string; score: number; grade: string; difficulty: string;
    }>();
    return apiJson({
      storyId,
      seasonId,
      entries: (rows.results || []).map((row, index) => ({
        rank: index + 1,
        address: `${row.wallet_address.slice(0, 6)}…${row.wallet_address.slice(-4)}`,
        score: row.score,
        grade: row.grade,
        difficulty: row.difficulty,
      })),
    }, 200, { "cache-control": "public, max-age=30" });
  } catch (error) {
    console.error("leaderboard failed", error);
    return apiError("SERVICE_UNAVAILABLE", "排行榜暂不可用", 503);
  }
}
