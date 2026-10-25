-- 005-ml-embeddings.sql —— 机器学习层：向量缓存 + 自动标签字段
--
-- 背景：把"智能匹配"从字符串求交升级为预训练语义嵌入。
-- 原则仍然是只新增、不改动既有列与语义。
--
--   ① embedding_cache：缓存文本向量，避免每次请求都跑模型推理
--      用 text_hash 做失效判断——简历/岗位文本一改，旧向量自动作废
--   ② resume.skills_auto：模型从简历正文里自动抽出的技能标签
--      与人工填的 skills 分开存，两者都保留：
--      人工标签可信但可能漏/懒得填，自动标签覆盖全但可能不准，
--      并行保留才有对比与校正的依据

-- ── ① 向量缓存 ──
CREATE TABLE IF NOT EXISTS embedding_cache (
  owner_type TEXT NOT NULL,   -- 'resume' | 'position'
  owner_id   TEXT NOT NULL,
  model      TEXT NOT NULL,   -- 模型标识，升级后可识别旧向量
  dim        INTEGER NOT NULL,
  vector     TEXT NOT NULL,   -- Float32 数组的 base64（512 维约 2.7KB）
  text_hash  TEXT NOT NULL,   -- 源文本的 sha1，用于失效
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_type, owner_id, model)
);

CREATE INDEX IF NOT EXISTS idx_embedding_owner ON embedding_cache(owner_type, owner_id);

-- ── ② 自动抽取的技能标签（与人工 skills 并存，不覆盖）──
ALTER TABLE resume ADD COLUMN skills_auto TEXT;

-- 存量数据：暂不回填，等下次自动抽取时写入
