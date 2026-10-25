/**
 * 匹配算法的"ML 视角"量化分析
 *
 * 目的：用真实数据对比三种相似度，说明当前实现处在什么位置、升级能带来什么。
 *   ① 现状：二值集合精确匹配，score = |命中| / |岗位期望|
 *   ② IDF 加权：把稀有技能权重提高（"Vue" 比 "沟通" 更有区分度）
 *   ③ 余弦相似度：二值向量上的对称度量
 *
 * 用法：node scripts/analyze-matching.mjs
 */
import { db } from '../src/db/connection.js';
import { parseSkills } from '../src/services/matchService.js';

const resumes = db.prepare('SELECT id, student_name, skills FROM resume').all();
const positions = db
  .prepare(
    `SELECT p.id, p.title, p.required_skills, c.name AS club_name
     FROM position p
     JOIN recruitment r ON r.id = p.recruitment_id
     JOIN club c ON c.id = r.club_id
     ORDER BY c.name, p.title`
  )
  .all();

/* ── 语料统计：技能在「岗位」和「简历」两侧的文档频率 ── */
const posSkillSets = positions.map((p) => new Set(parseSkills(p.required_skills)));
const resSkillSets = resumes.map((r) => new Set(parseSkills(r.skills)));

const dfPos = new Map();
const dfRes = new Map();
for (const s of posSkillSets) for (const t of s) dfPos.set(t, (dfPos.get(t) || 0) + 1);
for (const s of resSkillSets) for (const t of s) dfRes.set(t, (dfRes.get(t) || 0) + 1);

const N = positions.length;
const idf = (t) => Math.log((N + 1) / ((dfPos.get(t) || 0) + 1)) + 1;

/* ── 三种打分 ── */
function scoreExact(resumeSkills, requiredSkills) {
  if (requiredSkills.length === 0) return { score: 0, hit: [] };
  const rs = new Set(resumeSkills);
  const hit = requiredSkills.filter((s) => rs.has(s));
  return { score: Math.round((hit.length / requiredSkills.length) * 100), hit };
}

function scoreIdf(resumeSkills, requiredSkills) {
  if (requiredSkills.length === 0) return { score: 0, hit: [] };
  const rs = new Set(resumeSkills);
  const hit = requiredSkills.filter((s) => rs.has(s));
  const num = hit.reduce((a, s) => a + idf(s), 0);
  const den = requiredSkills.reduce((a, s) => a + idf(s), 0);
  return { score: den > 0 ? Math.round((num / den) * 100) : 0, hit };
}

function scoreCosine(resumeSkills, requiredSkills) {
  if (requiredSkills.length === 0 || resumeSkills.length === 0) return { score: 0, hit: [] };
  const rs = new Set(resumeSkills);
  const req = new Set(requiredSkills);
  let dot = 0;
  for (const s of req) if (rs.has(s)) dot += 1;
  const norm = Math.sqrt(req.size) * Math.sqrt(rs.size);
  return { score: Math.round((dot / norm) * 100), hit: [...req].filter((s) => rs.has(s)) };
}

/* ── 输出 ── */
console.log('════════ 语料概况 ════════');
console.log(`  简历 ${resumes.length} 份，岗位 ${positions.length} 个`);
console.log('\n  技能文档频率（df = 出现在多少个岗位的期望里）：');
const allTokens = [...dfPos.keys()].sort((a, b) => (dfPos.get(b) - dfPos.get(a)) || a.localeCompare(b));
console.log('    技能'.padEnd(14) + '岗位df'.padEnd(10) + '简历df'.padEnd(10) + 'IDF');
for (const t of allTokens) {
  console.log(
    `    ${t.padEnd(14)}${String(dfPos.get(t) || 0).padEnd(10)}${String(dfRes.get(t) || 0).padEnd(10)}${idf(t).toFixed(3)}`
  );
}

console.log('\n════════ 逐对比较（只列有过命中的组合）════════');
console.log(
  '  简历'.padEnd(10) + '岗位'.padEnd(16) + '精确'.padEnd(7) + 'IDF'.padEnd(7) + '余弦'.padEnd(7) + '命中'
);
let rows = 0;
for (const r of resumes) {
  const rs = parseSkills(r.skills);
  for (const p of positions) {
    const req = parseSkills(p.required_skills);
    const a = scoreExact(rs, req);
    if (a.hit.length === 0) continue;
    const b = scoreIdf(rs, req);
    const c = scoreCosine(rs, req);
    console.log(
      `  ${(r.student_name || '').padEnd(10)}${(p.title || '').padEnd(16)}` +
        `${String(a.score).padEnd(7)}${String(b.score).padEnd(7)}${String(c.score).padEnd(7)}` +
        `${a.hit.join('/')}`
    );
    rows += 1;
  }
}
if (rows === 0) console.log('  （当前数据没有命中组合）');

/* ── 排序一致性：两种打分下 top1 是否相同 ── */
console.log('\n════════ 排序影响（每份简历的 top1 岗位）════════');
for (const r of resumes) {
  const rs = parseSkills(r.skills);
  const scored = positions.map((p) => {
    const req = parseSkills(p.required_skills);
    return { title: p.title, exact: scoreExact(rs, req).score, idf: scoreIdf(rs, req).score };
  });
  const topExact = [...scored].sort((a, b) => b.exact - a.exact)[0];
  const topIdf = [...scored].sort((a, b) => b.idf - a.idf)[0];
  const same = topExact && topIdf && topExact.title === topIdf.title;
  console.log(
    `  ${(r.student_name || '').padEnd(10)} 精确→${(topExact?.title || '-').padEnd(14)}(${topExact?.exact ?? 0}%)  ` +
      `IDF→${(topIdf?.title || '-').padEnd(14)}(${topIdf?.idf ?? 0}%)  ${same ? '一致' : '⚠ 不同'}`
  );
}

/* ── 如果要做 Learning-to-Rank：现有 schema 能提供什么 ── */
console.log('\n════════ 若做 Learning-to-Rank：现有数据能提供什么 ════════');
const feat = db
  .prepare(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN a.decision != '' THEN 1 ELSE 0 END) AS labeled,
            SUM(CASE WHEN a.decision = 'hired' THEN 1 ELSE 0 END) AS pos,
            SUM(CASE WHEN a.decision = 'reject' THEN 1 ELSE 0 END) AS neg,
            SUM(CASE WHEN res.grade IS NOT NULL AND res.grade != '' THEN 1 ELSE 0 END) AS has_grade,
            SUM(CASE WHEN res.skills IS NOT NULL AND res.skills != '' THEN 1 ELSE 0 END) AS has_skills,
            SUM(CASE WHEN a.score IS NOT NULL THEN 1 ELSE 0 END) AS has_interview_score
     FROM application a JOIN resume res ON res.id = a.resume_id`
  )
  .get();
console.log(`  样本总数 n = ${feat.n}`);
console.log(`  已有明确结论（可当标签） = ${feat.labeled}   其中 录用=${feat.pos} 淘汰=${feat.neg}`);
console.log(`  有年级特征 = ${feat.has_grade}   有技能特征 = ${feat.has_skills}   有人工评分 = ${feat.has_interview_score}`);
console.log('');
if (feat.labeled < 100) {
  console.log(`  → 标注样本仅 ${feat.labeled} 条，远低于排序模型常用的 10^3 量级。`);
  console.log('    现阶段**训不出可信模型**，规则引擎是正确选择；应先把标注结构化沉淀下来。');
} else {
  console.log('  → 标注样本已具备一定规模，可考虑 LTR 基线。');
}
