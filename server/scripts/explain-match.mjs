/**
 * 打印一次匹配计算的完整过程（每一步的中间值）
 *
 * 用法：
 *   node scripts/explain-match.mjs                     # 用真实库
 *   $env:DB_PATH='...\demo.db'; node scripts/explain-match.mjs   # 用演示库
 *
 * 作用：把「文本组装 → 向量 → 余弦 → 校准 → 技能命中 → 加权」每一步的
 * 真实数值打出来，便于讲解与核对，而不是只看公式。
 */
import { db } from '../src/db/connection.js';
import * as emb from '../src/ml/embeddingService.js';
import * as sem from '../src/ml/semanticMatchService.js';
import { parseSkills } from '../src/ml/skillTags.js';

const line = (c = '─') => console.log(c.repeat(78));
const h = (t) => { console.log(''); line('═'); console.log(t); line('═'); };

await emb.loadModel();
const st = emb.getStatus();

h('参数');
console.log(`  模型            ${st.model}`);
console.log(`  向量维度        ${st.dim}`);
console.log(`  匹配模式        ${st.enabled && st.ready ? '语义 + 标签' : '规则（模型未就绪）'}`);
console.log(`  校准区间        [${process.env.ML_CALIB_MIN || 0.46}, ${process.env.ML_CALIB_MAX || 0.75}]`);
console.log(`  融合权重        语义 ${process.env.ML_W_SEMANTIC || 0.6} / 标签 ${process.env.ML_W_TAG || 0.4}`);
console.log(`  数据库          ${process.env.DB_PATH || 'server/data/club.db'}`);

const resumes = db.prepare('SELECT * FROM resume').all();
const positions = db
  .prepare(
    `SELECT p.*, c.name AS club_name FROM position p
     JOIN recruitment r ON r.id = p.recruitment_id
     JOIN club c ON c.id = r.club_id`
  )
  .all();

h(`数据规模：${resumes.length} 份简历 × ${positions.length} 个岗位`);

/* ── 选一对：先算出所有组合，挑一个高分的和一个低分的 ── */
const cache = new Map();
async function vecOf(type, id, text) {
  const key = `${type}:${id}:${text}`;
  if (!cache.has(key)) cache.set(key, await emb.embedOwner(type, id, text));
  return cache.get(key);
}

const pairs = [];
for (const r of resumes) {
  const rv = await vecOf('resume', r.id, sem.buildResumeText(r));
  for (const p of positions) {
    const pv = await vecOf('position', p.id, sem.buildPositionText(p));
    const m = sem.scorePair(rv, pv, r.skills, p.required_skills);
    pairs.push({ r, p, rv, pv, m });
  }
}
pairs.sort((a, b) => b.m.score - a.m.score);

const best = pairs[0];
const worst = pairs[pairs.length - 1];

/* ── 详细展开一对 ── */
async function explain(pair, tag) {
  const { r, p, rv, pv, m } = pair;
  h(`${tag}：${r.student_name} × ${p.club_name} / ${p.title}`);

  console.log('① 输入数据');
  console.log(`   简历技能   ${r.skills || '（空）'}`);
  console.log(`   岗位期望   ${p.required_skills || '（空）'}`);

  console.log('');
  console.log('② 文本组装（喂给模型的字符串，实际含换行）');
  const rt = sem.buildResumeText(r);
  const pt = sem.buildPositionText(p);
  console.log('   —— 简历侧 ——');
  rt.split('\n').forEach((x) => console.log('     ' + (x.length > 66 ? x.slice(0, 66) + '…' : x)));
  console.log('   —— 岗位侧 ——');
  pt.split('\n').forEach((x) => console.log('     ' + (x.length > 66 ? x.slice(0, 66) + '…' : x)));

  console.log('');
  console.log('③ 编码成向量');
  console.log(`   简历向量   维度 ${rv.length}，前 4 维 [${rv.slice(0, 4).map((v) => v.toFixed(4)).join(', ')}]`);
  console.log(`   岗位向量   维度 ${pv.length}，前 4 维 [${pv.slice(0, 4).map((v) => v.toFixed(4)).join(', ')}]`);
  console.log('   两者都已归一化，所以余弦 = 点积');

  console.log('');
  console.log('④ 余弦相似度（原始值）');
  const cos = m.semantics.cosine;
  console.log(`   cos = ${cos.toFixed(4)}`);

  console.log('');
  console.log('⑤ 校准：把原始余弦映射到 0~100');
  const min = Number(process.env.ML_CALIB_MIN || 0.46);
  const max = Number(process.env.ML_CALIB_MAX || 0.75);
  console.log(`   公式       (${cos.toFixed(4)} − ${min}) / (${max} − ${min}) × 100 = ${m.semantics.calibrated}`);
  console.log(`   语义分     ${m.semantics.calibrated}`);

  console.log('');
  console.log('⑥ 技能命中（字面完全相同才算命中）');
  console.log(`   命中       ${m.hitSkills.join('、') || '无'}`);
  console.log(`   缺失       ${m.missingSkills.join('、') || '无'}`);
  const total = m.hitSkills.length + m.missingSkills.length;
  console.log(`   标签分     ${m.hitSkills.length} / ${total} = ${m.tags.score}`);

  console.log('');
  console.log('⑦ 加权求综合分');
  if (total > 0) {
    const w1 = Number(process.env.ML_W_SEMANTIC || 0.6);
    const w2 = Number(process.env.ML_W_TAG || 0.4);
    console.log(`   ${w1} × ${m.semantics.calibrated} + ${w2} × ${m.tags.score} = ${(w1 * m.semantics.calibrated + w2 * m.tags.score).toFixed(1)} → 取整 ${m.score}`);
  } else {
    console.log(`   岗位没写期望技能，直接用语义分：${m.score}`);
  }
  console.log('');
  console.log(`   ▶ 综合分 ${m.score}　（返回字段 method = ${m.method}）`);
}

await explain(best, '高分样例');
await explain(worst, '低分样例');

/* ── 排序：同一份简历的所有岗位 ── */
h(`排序示例：${best.r.student_name} 的岗位排序`);
const mine = pairs.filter((x) => x.r.id === best.r.id).sort((a, b) => b.m.score - a.m.score);
console.log('  排名  岗位                    语义   标签   综合   余弦');
mine.slice(0, 10).forEach((x, i) => {
  console.log(
    `  ${String(i + 1).padStart(2)}    ${(x.p.title || '').padEnd(20)}` +
    `${String(x.m.semantics.calibrated).padStart(6)} ${String(x.m.tags.score).padStart(6)} ` +
    `${String(x.m.score).padStart(6)} ${x.m.semantics.cosine.toFixed(4).padStart(8)}`
  );
});
if (mine.length > 10) console.log(`  … 共 ${mine.length} 个岗位`);

/* ── 分布 ── */
h('全量分布');
const scores = pairs.map((x) => x.m.score).sort((a, b) => a - b);
const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
console.log(`  组合数 ${pairs.length}　最低 ${scores[0]}　中位 ${scores[Math.floor(scores.length / 2)]}　最高 ${scores[scores.length - 1]}　均值 ${avg.toFixed(1)}`);
const buckets = { '0': 0, '1-25': 0, '26-50': 0, '51-75': 0, '76-100': 0 };
scores.forEach((v) => {
  if (v === 0) buckets['0'] += 1;
  else if (v <= 25) buckets['1-25'] += 1;
  else if (v <= 50) buckets['26-50'] += 1;
  else if (v <= 75) buckets['51-75'] += 1;
  else buckets['76-100'] += 1;
});
console.log('  分段：' + Object.entries(buckets).map(([k, v]) => `${k}=${v}`).join('  '));

console.log('');
line('═');
console.log('说明：余弦值已被校准参数拉伸，绝对值不跨模型可比；换模型必须重新标定。');
line('═');
