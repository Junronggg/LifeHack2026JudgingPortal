PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 210000,
  role TEXT NOT NULL CHECK (role IN ('judge', 'admin')),
  judge_type TEXT CHECK (judge_type IN ('general', 'company') OR judge_type IS NULL),
  company_category_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (role = 'admin' AND judge_type IS NULL AND company_category_id IS NULL)
    OR (role = 'judge' AND judge_type = 'general' AND company_category_id IS NULL)
    OR (role = 'judge' AND judge_type = 'company' AND company_category_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS scores (
  team_id TEXT NOT NULL,
  judge_id TEXT NOT NULL,
  impact INTEGER NOT NULL CHECK (impact BETWEEN 0 AND 10),
  innovation INTEGER NOT NULL CHECK (innovation BETWEEN 0 AND 10),
  execution INTEGER NOT NULL CHECK (execution BETWEEN 0 AND 10),
  presentation INTEGER NOT NULL CHECK (presentation BETWEEN 0 AND 10),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  weighted_score REAL NOT NULL CHECK (weighted_score BETWEEN 0 AND 10),
  submitted_at TEXT NOT NULL,
  PRIMARY KEY (team_id, judge_id),
  FOREIGN KEY (judge_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS scores_team_idx ON scores(team_id);
CREATE INDEX IF NOT EXISTS scores_judge_idx ON scores(judge_id);
