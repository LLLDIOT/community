/**
 * 校准校验 —— 打印「余弦 → 校准分 → 混合综合分」的真实对照表
 *
 * 用法：node scripts/verify-calibration.mjs
 *
 * 为什么需要这个脚本：
 *   校准参数（ML_CALIB_MIN / ML_CALIB_MAX）换模型或换数据后必须重新标定。
 *   凭印象写文档/调参极容易出错（本项目就曾把上限设成 0.82 —— 一个永远达不到的值，
 *   导致所有分数被压到 70 以下而不报错）。
 *   这个脚本直接把真实数值算出来，让"标定"变成可核对的动作。
 */
import { db } from '../src/db/connection.js';
import * as emb from '../src/ml/embeddingService.js';
import * as sem from '../src/ml/semanticMatchService.js';
import { SKILL_VOCAB } from '../src/ml/skillExtractor.js';

await emb.loadModel();

const resumes = db.prepare('SELECT * FROM resume').all();
const positions = db
  .prepare(
    `SELECT p.*, c.name AS club_name FROM position p
     JOIN recruitment r ON r.id = p.recruitment_id
     JOIN club c ON c.id = r.club_id
     ORDER BY c.name, p.title`
  )
  .all();

const calMin = Number(process.env.ML_CALIB_MIN || 0.46);
const calMax = Number(process.env.ML_CALIB_MAX || 0.75);

console.log('════════ 校准参数 ════════');
console.log(`  ML_CALIB_MIN = ${calMin}`);
console.log(`  ML_CALIB_MAX = ${calMax}`);
console.log(`  公式：校准分 = clamp((余弦 - ${calMin}) / (${calMax} - ${calMin}), 0, 1) × 100`);
console.log(`  词表规模 SKILL_VOCAB = ${SKILL_VOCAB.length} 项`);
console.log('');

const rows = [];
for (const r of resumes) {
  for (const p of positions) {
    const [rv, pv] = await Promise.all([
      emb.embedOwner('resume', r.id, sem.buildResumeText(r)),
      emb.embedOwner('position', p.id, sem.buildPositionText(p)),
    ]);
    const cos = emb.cosine(rv, pv);
    const cal = sem.calibrate(cos);
    const m = sem.scorePair(rv, pv, r.skills, p.required_skills);
    const totalTags = m.hitSkills.length + m.missingSkills.length;
    rows.push({
      student: r.student_name || '',
      title: p.title || '',
      cos,
      cal,
      hit: totalTags ? `${m.hitSkills.length}/${totalTags}` : '—',
      tag: m.tags.score,
      score: m.score,
    });
  }
}
rows.sort((a, b) => b.cal - a.cal);

console.log('════════ 逐对真实数值（按校准分降序）════════');
console.log(
  '  简历'.padEnd(12) + '岗位'.padEnd(18) + '余弦'.padEnd(10) + '校准分'.padEnd(10) +
    '命中'.padEnd(8) + '标签分'.padEnd(10) + '综合分'
);
for (const x of rows) {
  console.log(
    '  ' + x.student.padEnd(10) + x.title.padEnd(16) + x.cos.toFixed(4).padEnd(10) +
      String(x.cal).padEnd(10) + x.hit.padEnd(8) + String(x.tag).padEnd(10) + String(x.score)
  );
}

const cals = rows.map((x) => x.cal);
const minCal = Math.min(...cals);
const maxCal = Math.max(...cals);
console.log('');
console.log('════════ 分布诊断 ════════');
console.log(`  校准分区间：${minCal} ~ ${maxCal}（跨度 ${maxCal - minCal}）`);
if (maxCal < 80) {
  console.log('  ⚠️ 最高分不足 80 —— 校准上限 ML_CALIB_MAX 可能设得过高（达不到），区分度被压缩。');
} else if (maxCal > 99 && minCal > 30) {
  console.log('  ⚠️ 下限偏高 —— ML_CALIB_MIN 可能设得过低，无关项也会得分。');
} else {
  console.log('  ✅ 跨度合理，校准参数与当前模型/数据匹配。');
}
console.log('');
console.log('  修参数：ML_CALIB_MIN / ML_CALIB_MAX 环境变量，改完重跑本脚本确认分布。');
