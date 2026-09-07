-- 001-init.sql —— 社团招新系统初始表结构
-- SQLite 方言。对应 docs/DATA_MODEL.md。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS club (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  scale         INTEGER NOT NULL DEFAULT 0,
  scale_label   TEXT,
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT,
  logo_path     TEXT,
  contact_name  TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  is_visible    INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recruitment (
  id         TEXT PRIMARY KEY,
  club_id    TEXT NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  start_at   TEXT,
  end_at     TEXT,
  remark     TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recruitment_club ON recruitment(club_id, status);

CREATE TABLE IF NOT EXISTS position (
  id              TEXT PRIMARY KEY,
  recruitment_id  TEXT NOT NULL REFERENCES recruitment(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  requirement     TEXT NOT NULL DEFAULT '',
  headcount       INTEGER NOT NULL DEFAULT 1,
  filled_count    INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_position_recruitment ON position(recruitment_id);

CREATE TABLE IF NOT EXISTS resume (
  id              TEXT PRIMARY KEY,
  student_name    TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  school          TEXT,
  major           TEXT,
  grade           TEXT,
  content         TEXT,
  attachment_path TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS application (
  id          TEXT PRIMARY KEY,
  position_id TEXT NOT NULL REFERENCES position(id) ON DELETE CASCADE,
  resume_id   TEXT NOT NULL REFERENCES resume(id) ON DELETE CASCADE,
  type_tag    TEXT NOT NULL DEFAULT 'other',
  status      TEXT NOT NULL DEFAULT 'new'
              CHECK (status IN ('new','screening','interviewing','admitted','rejected','archived')),
  score       INTEGER,
  note        TEXT,
  reviewed_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (position_id, resume_id)
);
CREATE INDEX IF NOT EXISTS idx_application_position ON application(position_id);
CREATE INDEX IF NOT EXISTS idx_application_resume   ON application(resume_id);
CREATE INDEX IF NOT EXISTS idx_application_filter   ON application(type_tag, status);

CREATE TABLE IF NOT EXISTS tag (
  id         TEXT PRIMARY KEY,
  club_id    TEXT REFERENCES club(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#409EFF',
  UNIQUE (club_id, name)
);

CREATE TABLE IF NOT EXISTS application_tags (
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  tag_id         TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  PRIMARY KEY (application_id, tag_id)
);
