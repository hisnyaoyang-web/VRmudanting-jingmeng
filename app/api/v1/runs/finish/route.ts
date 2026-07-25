import { privateKeyToAccount } from "viem/accounts";
import { encodePacked, keccak256, type Address, type Hex } from "viem";
import { isDifficulty, scoreRun, type RunInput } from "../../../../game-rules";
import { database, ensureSchema, normalizeAddress } from "../../../_lib/database";
import { apiError, apiJson, readJson } from "../../../_lib/http";
import { getStory } from "../../../_lib/story";
import { runtimeBindings } from "../../../_lib/runtime";

type FinishRequest = {
  runId?: string;
  address?: string;
  events?: RunInput[];
};

type RunRow = {
  id: string;
  story_id: string;
  season_id: string;
  difficulty: string;
  challenge_date: string;
  nonce: string;
  started_at: number;
  finished_at: number | null;
};

const claimTypes = {
  Claim: [
    { name: "player", type: "address" },
    { name: "storyId", type: "bytes32" },
    { name: "seasonId", type: "bytes32" },
    { name: "score", type: "uint32" },
    { name: "grade", type: "uint8" },
    { name: "nonce", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

function validEvents(value: unknown): value is RunInput[] {
  return Array.isArray(value) && value.length <= 128 && value.every((event) =>
    event && typeof event === "object"
    && ["left", "right", "up", "down", "salute", "run", "flying"].includes(String(event.action))
    && Number.isFinite(event.atMs) && event.atMs >= -500 && event.atMs <= 125_000
  );
}

function gradeNumber(grade: "excellent" | "good" | "bad") {
  return grade === "excellent" ? 2 : grade === "good" ? 1 : 0;
}

export async function POST(request: Request) {
  try {
    const input = await readJson<FinishRequest>(request);
    if (!input.runId || !validEvents(input.events)) {
      return apiError("INVALID_REQUEST", "runId 或 events 无效", 400);
    }
    const address = input.address ? normalizeAddress(input.address) : null;
    if (input.address && !address) return apiError("INVALID_REQUEST", "钱包地址无效", 400);

    await ensureSchema();
    const db = database();
    const run = await db.prepare("SELECT * FROM runs WHERE id = ?").bind(input.runId).first<RunRow>();
    if (!run) return apiError("NOT_FOUND", "演出不存在", 404);
    if (run.finished_at) return apiError("CONFLICT", "该演出已经结算", 409);
    if (!isDifficulty(run.difficulty)) return apiError("INTERNAL_ERROR", "演出难度损坏", 500);
    const story = getStory(run.story_id);
    if (!story) return apiError("NOT_FOUND", "故事不存在", 404);

    const elapsed = Date.now() - Number(run.started_at);
    if (elapsed < Math.max(2_000, story.performance.durationMs * 0.7) || elapsed > 10 * 60_000) {
      return apiError("INVALID_REQUEST", "演出用时异常，请重新开始", 422);
    }

    const result = scoreRun(story, run.difficulty, input.events);
    const digestBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input.events)));
    const digest = Array.from(new Uint8Array(digestBytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const now = Date.now();
    await db.prepare(
      `UPDATE runs SET wallet_address = ?, finished_at = ?, input_digest = ?,
       score = ?, grade = ?, verified = 1 WHERE id = ? AND finished_at IS NULL`,
    ).bind(address, now, digest, result.score, result.grade, run.id).run();

    let progress = { bestScore: result.score, bestGrade: result.grade, fragments: 0, playCount: 1 };
    if (address) {
      const current = await db.prepare(
        "SELECT best_score, best_grade, fragments, play_count, last_reward_date FROM progress WHERE wallet_address = ? AND story_id = ?",
      ).bind(address, story.id).first<{
        best_score: number; best_grade: string; fragments: number; play_count: number; last_reward_date: string | null;
      }>();
      const gradeRank = { bad: 0, good: 1, excellent: 2 } as const;
      const bestGrade = current && gradeRank[current.best_grade as keyof typeof gradeRank] > gradeRank[result.grade]
        ? current.best_grade : result.grade;
      const rewardedToday = current?.last_reward_date === run.challenge_date;
      const fragments = Math.min(3, Number(current?.fragments || 0) + (rewardedToday ? 0 : 1));
      progress = {
        bestScore: Math.max(Number(current?.best_score || 0), result.score),
        bestGrade: bestGrade as typeof result.grade,
        fragments,
        playCount: Number(current?.play_count || 0) + 1,
      };
      await db.prepare(
        `INSERT INTO progress
         (wallet_address, story_id, best_score, best_grade, fragments, play_count, last_reward_date, last_played_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(wallet_address, story_id) DO UPDATE SET
           best_score = excluded.best_score, best_grade = excluded.best_grade,
           fragments = excluded.fragments, play_count = excluded.play_count,
           last_reward_date = excluded.last_reward_date, last_played_at = excluded.last_played_at`,
      ).bind(
        address, story.id, progress.bestScore, progress.bestGrade, fragments, progress.playCount,
        rewardedToday ? current?.last_reward_date : run.challenge_date, now,
      ).run();
    }

    let voucher: null | Record<string, unknown> = null;
    const eligible = Boolean(address && progress.fragments >= 3 && result.grade === "excellent");
    const env = runtimeBindings();
    if (eligible && address && env.GAME_SIGNER_PRIVATE_KEY) {
      const existing = await db.prepare(
        "SELECT nonce, voucher_digest, score, grade FROM claims WHERE wallet_address = ? AND story_id = ? AND season_id = ?",
      ).bind(address, story.id, run.season_id).first<{
        nonce: Hex; voucher_digest: Hex; score: number; grade: string;
      }>();
      if (!existing) {
        const account = privateKeyToAccount(env.GAME_SIGNER_PRIVATE_KEY);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
        const storyHash = keccak256(encodePacked(["string"], [story.id]));
        const seasonHash = keccak256(encodePacked(["string"], [run.season_id]));
        const domain = {
          name: "Shadow Relic",
          version: "1",
          chainId: 1439,
          verifyingContract: (process.env.NEXT_PUBLIC_NFT_CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
        } as const;
        const message = {
          player: address as Address,
          storyId: storyHash,
          seasonId: seasonHash,
          score: result.score,
          grade: gradeNumber(result.grade),
          nonce: run.nonce as Hex,
          deadline,
        };
        const signature = await account.signTypedData({ domain, types: claimTypes, primaryType: "Claim", message });
        const voucherDigest = keccak256(signature);
        await db.prepare(
          `INSERT INTO claims
           (wallet_address, story_id, season_id, nonce, voucher_digest, score, grade, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'issued', ?)`,
        ).bind(address, story.id, run.season_id, run.nonce, voucherDigest, result.score, result.grade, now).run();
        voucher = { ...message, deadline: deadline.toString(), signature };
      }
    }

    return apiJson({
      runId: run.id,
      verified: true,
      ...result,
      progress,
      eligible,
      voucher,
      eligibility: eligible
        ? voucher ? "ready" : "signer_unavailable"
        : progress.fragments < 3 ? "collect_fragments" : "excellent_required",
    });
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE")) {
      return apiError("INVALID_REQUEST", "请求 JSON 无效或过大", 400);
    }
    console.error("finish run failed", error);
    return apiError("SERVICE_UNAVAILABLE", "结算服务暂不可用", 503);
  }
}
