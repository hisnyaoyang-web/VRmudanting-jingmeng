import { database, ensureSchema, normalizeAddress } from "../../../_lib/database";
import { apiError, apiJson } from "../../../_lib/http";

export async function GET(_request: Request, context: { params: Promise<{ address: string }> }) {
  try {
    const { address: raw } = await context.params;
    const address = normalizeAddress(raw);
    if (!address) return apiError("INVALID_REQUEST", "钱包地址无效", 400);
    await ensureSchema();
    const rows = await database().prepare(
      "SELECT story_id, best_score, best_grade, fragments, play_count, last_reward_date, last_played_at FROM progress WHERE wallet_address = ?",
    ).bind(address).all();
    const unlocks = await database().prepare(
      "SELECT unlock_id, source, unlocked_at FROM unlocks WHERE wallet_address = ? ORDER BY unlocked_at DESC",
    ).bind(address).all();
    return apiJson({ address, stories: rows.results || [], unlocks: unlocks.results || [] });
  } catch (error) {
    console.error("progress failed", error);
    return apiError("SERVICE_UNAVAILABLE", "进度服务暂不可用", 503);
  }
}
