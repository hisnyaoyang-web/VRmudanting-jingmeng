import { runtimeBindings } from "./runtime";

export function database() {
  const env = runtimeBindings();
  if (!env.DB) throw new Error("DATABASE_UNAVAILABLE");
  return env.DB;
}

export async function ensureSchema() {
  const db = database();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, wallet_address TEXT, story_id TEXT NOT NULL,
      story_version TEXT NOT NULL, season_id TEXT NOT NULL, difficulty TEXT NOT NULL,
      challenge_date TEXT NOT NULL, nonce TEXT NOT NULL, started_at INTEGER NOT NULL,
      finished_at INTEGER, input_digest TEXT, score INTEGER, grade TEXT,
      verified INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS progress (
      wallet_address TEXT NOT NULL, story_id TEXT NOT NULL, best_score INTEGER NOT NULL DEFAULT 0,
      best_grade TEXT NOT NULL DEFAULT 'bad', fragments INTEGER NOT NULL DEFAULT 0,
      play_count INTEGER NOT NULL DEFAULT 0, last_reward_date TEXT, last_played_at INTEGER NOT NULL,
      UNIQUE(wallet_address, story_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claims (
      wallet_address TEXT NOT NULL, story_id TEXT NOT NULL, season_id TEXT NOT NULL,
      nonce TEXT NOT NULL UNIQUE, voucher_digest TEXT NOT NULL, score INTEGER NOT NULL,
      grade TEXT NOT NULL, tx_hash TEXT, token_id TEXT, status TEXT NOT NULL DEFAULT 'issued',
      created_at INTEGER NOT NULL, UNIQUE(wallet_address, story_id, season_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS unlocks (
      wallet_address TEXT NOT NULL, unlock_id TEXT NOT NULL, source TEXT NOT NULL,
      unlocked_at INTEGER NOT NULL, UNIQUE(wallet_address, unlock_id)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS runs_wallet_idx ON runs(wallet_address)"),
    db.prepare("CREATE INDEX IF NOT EXISTS runs_leaderboard_idx ON runs(story_id, season_id, score DESC)"),
  ]);
}

export function normalizeAddress(value: unknown) {
  const address = String(value || "").toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(address) ? address : null;
}
