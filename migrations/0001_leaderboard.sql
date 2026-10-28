CREATE TABLE IF NOT EXISTS game_sessions (
	session_id TEXT PRIMARY KEY,
	alias TEXT NOT NULL,
	seed INTEGER NOT NULL,
	issued_at INTEGER NOT NULL,
	consumed_at INTEGER
);

CREATE TABLE IF NOT EXISTS leaderboard_entries (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id TEXT NOT NULL UNIQUE,
	alias TEXT NOT NULL,
	score INTEGER NOT NULL,
	recycled_count INTEGER NOT NULL,
	compliance_rate INTEGER NOT NULL,
	co2_saved_grams INTEGER NOT NULL,
	orientation_used TEXT NOT NULL,
	ip_hash TEXT NOT NULL,
	day_bucket TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_all_time
	ON leaderboard_entries(score DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_leaderboard_daily
	ON leaderboard_entries(day_bucket, score DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_leaderboard_rate_limit
	ON leaderboard_entries(ip_hash, created_at DESC);
