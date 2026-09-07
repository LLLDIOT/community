-- 002-add-was-admitted.sql
-- application 增加 was_admitted：记录"是否曾录取"，使岗位 filled_count
-- 在录取者后续被归档后仍能正确统计"本岗位累计已录取人数"。

ALTER TABLE application ADD COLUMN was_admitted INTEGER NOT NULL DEFAULT 0;

-- 存量回填：当前即为 admitted 的记录置 1（历史 archived 无法反推，忽略）
UPDATE application SET was_admitted = 1 WHERE status = 'admitted';
