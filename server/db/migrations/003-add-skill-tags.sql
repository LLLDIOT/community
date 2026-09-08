-- 003-add-skill-tags.sql
-- 简历技能标签 + 岗位期望技能标签（逗号分隔的标签列表，如 "Vue,Node,沟通"）
-- 用于简历↔岗位匹配度计算。

ALTER TABLE resume ADD COLUMN skills TEXT;          -- 简历：个人技能/特长标签
ALTER TABLE position ADD COLUMN required_skills TEXT; -- 岗位：期望技能标签

-- 存量数据回填：给已有的测试岗位/简历示例标签（可空，不影响运行）
UPDATE resume SET skills = 'Vue,Node.js,项目协作' WHERE student_name = '王小明' AND skills IS NULL;
UPDATE resume SET skills = '文案,活动组织,沟通' WHERE student_name = '赵小红' AND skills IS NULL;
UPDATE resume SET skills = 'AI,Python,数据分析' WHERE student_name = '钱多多' AND skills IS NULL;
UPDATE resume SET skills = '设计,海报,审美' WHERE student_name = '孙小美' AND skills IS NULL;

UPDATE position SET required_skills = 'HTML,CSS,JavaScript,Vue' WHERE title = '前端开发干事' AND required_skills IS NULL;
UPDATE position SET required_skills = '活动组织,沟通,文案' WHERE title = '活动策划干事' AND required_skills IS NULL;
