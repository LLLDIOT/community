-- 004-club-console.sql —— 社团端改造：招新广场 + 面试决策/候补递补 + 按人权限
--
-- 对应需求：
--   ① 双面板入口：全校社团总览（可查看任意社团的招新情况与投递人数）+ 本社团管理面板
--   ② 登录后可修改本社团的「信息录入标准」与「投递时间」
--   ③ 通过筛选决定候选人「录用 / 调剂」
--   ④ 最终面试时标注真正录用者，并给候补者标序号（1 号 / 2 号…）以按序递补招满员
--   ⑤ 完善社团端筛选（页面美化 + 每个人的权限）
--
-- 设计原则：只新增列 / 新增表，不改动既有列与状态机语义，
--           保证 001~003 已落库的数据与 filled_count 统计口径完全不变。

-- ── ① 社团：信息录入标准 + 投递时间窗（社团级默认）──────────────────
-- entry_criteria：「我们要求投递者提交什么/达到什么标准」，与 description（社团介绍）区分开
ALTER TABLE club ADD COLUMN entry_criteria TEXT NOT NULL DEFAULT '';
-- 社团级投递时间窗；批次(recruitment)上的 start_at/end_at 优先级更高，未填时回落到这里
ALTER TABLE club ADD COLUMN apply_start_at TEXT;
ALTER TABLE club ADD COLUMN apply_end_at   TEXT;

-- ── ② 投递：面试决策层（与 status 状态机并行，互不覆盖）─────────────
-- status  = 流程走到哪一步（新收到→待筛选→面试中→已录取/已淘汰→已归档）
-- decision= 面试结论（'' 未定 | hired 录用 | waitlist 候补 | adjust 调剂 | reject 淘汰）
ALTER TABLE application ADD COLUMN decision TEXT NOT NULL DEFAULT '';
ALTER TABLE application ADD COLUMN waitlist_rank     INTEGER; -- 候补序号 1,2,3…（同岗位内唯一）
ALTER TABLE application ADD COLUMN adjust_position_id TEXT;   -- 调剂去向岗位
ALTER TABLE application ADD COLUMN decided_at        TEXT;    -- 标注时间
ALTER TABLE application ADD COLUMN decided_by        TEXT;    -- 标注人（club_account.id）

CREATE INDEX IF NOT EXISTS idx_application_decision ON application(position_id, decision);
CREATE INDEX IF NOT EXISTS idx_application_waitlist ON application(position_id, waitlist_rank);

-- ── ③ 按人权限：社团账号 + 登录会话 ──────────────────────────────────
-- role: owner 社长(全部) / interviewer 面试官(可决策) / viewer 观察员(只读)
CREATE TABLE IF NOT EXISTS club_account (
  id            TEXT PRIMARY KEY,
  club_id       TEXT NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,   -- scrypt 派生值（hex）
  salt          TEXT NOT NULL,   -- 随机盐（hex）
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'interviewer'
                CHECK (role IN ('owner','interviewer','viewer')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_club_account_club ON club_account(club_id);

CREATE TABLE IF NOT EXISTS club_session (
  token      TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES club_account(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_club_session_account ON club_session(account_id);

-- ── ④ 存量回填：已录取的记录补上决策标注，保证看板/统计口径一致 ──────
UPDATE application
   SET decision = 'hired',
       decided_at = COALESCE(reviewed_at, updated_at)
 WHERE status = 'admitted' AND decision = '';
