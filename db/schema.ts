import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  walletAddress: text("wallet_address"),
  storyId: text("story_id").notNull(),
  storyVersion: text("story_version").notNull(),
  seasonId: text("season_id").notNull(),
  difficulty: text("difficulty").notNull(),
  challengeDate: text("challenge_date").notNull(),
  nonce: text("nonce").notNull(),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  inputDigest: text("input_digest"),
  score: integer("score"),
  grade: text("grade"),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
}, (table) => [
  index("runs_wallet_idx").on(table.walletAddress),
  index("runs_leaderboard_idx").on(table.storyId, table.seasonId, table.score),
]);

export const progress = sqliteTable("progress", {
  walletAddress: text("wallet_address").notNull(),
  storyId: text("story_id").notNull(),
  bestScore: integer("best_score").notNull().default(0),
  bestGrade: text("best_grade").notNull().default("bad"),
  fragments: integer("fragments").notNull().default(0),
  playCount: integer("play_count").notNull().default(0),
  lastRewardDate: text("last_reward_date"),
  lastPlayedAt: integer("last_played_at").notNull(),
}, (table) => [
  uniqueIndex("progress_wallet_story_unique").on(table.walletAddress, table.storyId),
]);

export const claims = sqliteTable("claims", {
  walletAddress: text("wallet_address").notNull(),
  storyId: text("story_id").notNull(),
  seasonId: text("season_id").notNull(),
  nonce: text("nonce").notNull(),
  voucherDigest: text("voucher_digest").notNull(),
  score: integer("score").notNull(),
  grade: text("grade").notNull(),
  txHash: text("tx_hash"),
  tokenId: text("token_id"),
  status: text("status").notNull().default("issued"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("claims_wallet_story_season_unique").on(table.walletAddress, table.storyId, table.seasonId),
  uniqueIndex("claims_nonce_unique").on(table.nonce),
]);

export const unlocks = sqliteTable("unlocks", {
  walletAddress: text("wallet_address").notNull(),
  unlockId: text("unlock_id").notNull(),
  source: text("source").notNull(),
  unlockedAt: integer("unlocked_at").notNull(),
}, (table) => [
  uniqueIndex("unlocks_wallet_id_unique").on(table.walletAddress, table.unlockId),
]);
