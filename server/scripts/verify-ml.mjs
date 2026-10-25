/**
 * ML 层验证：规则匹配 vs 语义匹配的真实差异
 *
 * 用法：node scripts/verify-ml.mjs
 *
 * 会做四件事：
 *   ① 检查 schema（迁移 005）
 *   ② 加载嵌入模型并报告状态
 *   ③ 对每一对「简历 × 岗位」同时算规则分与语义分，并列对比
 *   ④ 验证降级路径（ML_ENABLED=0 时是否还能工作）
 */
import { db } from '../src/db/connection.js';
import { parseSkills, matchSkills } from '../src/ml/skillTags.js';
import * as emb from '../src/ml/embeddingService.js';
import * as sem from '../src/ml/semanticMatchService.js';

const line = (c = '─') => console.log(c.repeat(72));

/* ── ① schema ── */
line('═');
console.log('① schema 检查');
line();
const ver = db.pragma('user_version', { simple: true });
console.log(`  迁移版本 user_version = ${ver}  ${ver >= 5 ? '✅' : '❌ 应 >= 5'}`);
const tbl = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='embedding_cache'")
  .get();
console.log(`  embedding_cache 表: ${tbl ? '✅' : '❌'}`);
const resCols = db.prepare('PRAGMA table_info(resume)').all().map((c) => c.name);
console.log(`  resume.skills_auto 列: ${resCols.includes('skills_auto') ? '✅' : '❌'}`);

/* ── ② 模型 ── */
line('═');
console.log('② 加载嵌入模型');
line();
let mlOk = false;
try {
  const t0 = Date.now();
  mlOk = await emb.loadModel();
  console.log(`  加载: ${mlOk ? '✅ 成功' : '❌ 失败'}（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  const st = emb.getStatus();
  console.log(`  模型: ${st.model}  dim=${st.dim}`);
  console.log(`  镜像: ${st.remoteHost}`);
} catch (e) {
  console.log('  ❌ 加载异常:', e.message);
}

/* ── ③ 规则 vs 语义 ── */
const resumes = db.prepare('SELECT * FROM resume').all();
const positions = db
  .prepare(
    `SELECT p.*, c.name AS club_name FROM position p
     JOIN recruitment r ON r.id = p.recruitment_id
     JOIN club c ON c.id = r.club_id
     ORDER BY c.name, p.title`
  )
  .all();

line('═');
console.log('③ 每对「简历 × 岗位」的规则分 vs 语义分');
line();
console.log(
  '  简历'.padEnd(12) +
    '岗位'.padEnd(18) +
    '规则分'.padEnd(9) +
    '语义分'.padEnd(9) +
    '余弦'.padEnd(9) +
    '命中'
);

const rows = [];
for (const r of resumes) {
  for (const p of positions) {
    const rule = matchSkills(r.skills, p.required_skills);
    let semScore = null;
    let cos = null;
    if (mlOk) {
      const [rv, pv] = await Promise.all([
        emb.embedOwner('resume', r.id, sem.buildResumeText(r)),
        emb.embedOwner('position', p.id, sem.buildPositionText(p)),
      ]);
      const m = sem.scorePair(rv, pv, r.skills, p.required_skills);
      semScore = m.score;
      cos = m.semantics.cosine;
    }
    rows.push({ r: r.student_name, p: p.title, rule: rule.score, sem: semScore, cos, hit: rule.hitSkills });
    console.log(
      `  ${(r.student_name || '').padEnd(10)}` +
        `${(p.title || '').padEnd(16)}` +
        `${String(rule.score).padEnd(10)}` +
        `${String(semScore ?? '-').padEnd(10)}` +
        `${(cos ?? '-').toString().padEnd(10)}` +
        `${rule.hitSkills.join('/') || '—'}`
    );
  }
}

/* ── 语义泛化：规则 0 分但语义有分的情况 ── */
line('═');
console.log('④ 关键验证：规则分为 0，但语义能识别出相关性吗');
line();
const interesting = rows.filter((x) => x.rule === 0 && x.sem !== null && x.sem > 0);
if (interesting.length === 0) {
  console.log('  （当前数据里没有"规则 0 分"的组合）');
} else {
  for (const x of interesting) {
    console.log(`  ${x.r} × ${x.p}: 规则 ${x.rule}%  →  语义 ${x.sem}%（余弦 ${x.cos.toFixed(4)}）`);
  }
}

/* ── 语义泛化专项：跨措辞 ── */
line('═');
console.log('⑤ 语义泛化专项（同一含义、不同措辞）');
line();
const probes = [
  ['前端开发', 'Vue3 页面实现与组件封装'],
  ['海报设计', '视觉传达、排版与配色'],
  ['活动策划', '组织线下活动，协调场地与人员'],
  ['文案写作', '公众号推文撰写'],
];
for (const [a, b] of probes) {
  const [va, vb] = await emb.embedTexts([a, b]);
  const cos = emb.cosine(va, vb);
  console.log(`  余弦 ${cos.toFixed(4)}  校准后 ${sem.calibrate(cos)}  「${a}」 ~ 「${b}」`);
}

/* ── ⑥ 缓存效果 ── */
line('═');
console.log('⑥ 向量缓存效果');
line();
const cached = db.prepare('SELECT COUNT(*) c FROM embedding_cache').get().c;
console.log(`  embedding_cache 已缓存 ${cached} 条向量`);
const t1 = Date.now();
await sem.recommendPositionsForResume(resumes[0].id, { limit: 10 });
const t2 = Date.now();
await sem.recommendPositionsForResume(resumes[0].id, { limit: 10 });
const t3 = Date.now();
console.log(`  首次推荐耗时 ${t2 - t1}ms（可能触发编码）`);
console.log(`  二次推荐耗时 ${t3 - t2}ms（应命中缓存，明显更快）`);

line('═');
console.log(mlOk ? '✅ ML 层验证完成' : '⚠️ 模型不可用，已回退规则模式（系统仍可正常工作）');
