/** 演示数据集一致性检查：超额录取、同社团重复投递、候补序号唯一性、岗位已录数。 */
import { db } from '../src/db/connection.js';

const line = (t) => console.log(`\n${t}`);

line('① 是否超额录取（filled_count <= headcount）');
const over = db.prepare('SELECT title, headcount, filled_count FROM position WHERE filled_count > headcount').all();
console.log(over.length ? '  ❌ ' + over.map((x) => `${x.title} ${x.filled_count}/${x.headcount}`).join(', ') : '  ✅ 无');

line('② 同一份简历是否向同一社团重复投递');
const dup = db.prepare(
  `SELECT r.student_name, c.name AS club, COUNT(*) AS n
   FROM application a
   JOIN resume r ON r.id = a.resume_id
   JOIN position p ON p.id = a.position_id
   JOIN recruitment rec ON rec.id = p.recruitment_id
   JOIN club c ON c.id = rec.club_id
   GROUP BY a.resume_id, c.id HAVING n > 1`
).all();
console.log(dup.length ? '  ❌ ' + dup.slice(0, 5).map((x) => `${x.student_name}@${x.club}×${x.n}`).join(', ') : '  ✅ 无');

line('③ 候补序号在同一岗位内是否唯一');
const wlDup = db.prepare(
  `SELECT position_id, waitlist_rank, COUNT(*) AS n FROM application
   WHERE decision = 'waitlist' GROUP BY position_id, waitlist_rank HAVING n > 1`
).all();
console.log(wlDup.length ? '  ❌ ' + wlDup.length + ' 处重复' : '  ✅ 唯一');

line('④ filled_count 是否等于 was_admitted 计数');
const mismatch = db.prepare(
  `SELECT p.id, p.title, p.filled_count,
          (SELECT COUNT(*) FROM application a WHERE a.position_id = p.id AND a.was_admitted = 1) AS real
   FROM position p`
).all().filter((x) => x.filled_count !== x.real);
console.log(mismatch.length ? '  ❌ ' + mismatch.length + ' 个岗位不一致' : '  ✅ 全部一致');

line('⑤ 决策与状态是否自洽');
const bad = db.prepare(
  `SELECT status, decision, COUNT(*) AS n FROM application
   WHERE (status = 'admitted' AND decision != 'hired')
      OR (status = 'rejected' AND decision NOT IN ('reject','adjust'))
   GROUP BY status, decision`
).all();
console.log(bad.length ? '  ❌ ' + JSON.stringify(bad) : '  ✅ 自洽');

line('⑥ 关键字段是否有值（展示需要）');
const stat = db.prepare(
  `SELECT COUNT(*) AS total,
          SUM(phone IS NOT NULL) AS has_phone,
          SUM(email IS NOT NULL) AS has_email,
          SUM(content IS NOT NULL AND content != '') AS has_content,
          SUM(skills IS NOT NULL AND skills != '') AS has_skills
   FROM resume`
).get();
console.log(`  简历 ${stat.total} 份，有电话 ${stat.has_phone}、有邮箱 ${stat.has_email}、有正文 ${stat.has_content}、有技能 ${stat.has_skills}`);

const appStat = db.prepare(
  `SELECT COUNT(*) AS total, SUM(score IS NOT NULL) AS has_score, SUM(decision != '') AS decided FROM application`
).get();
console.log(`  投递 ${appStat.total} 条，有面试评分 ${appStat.has_score}、有决策 ${appStat.decided}`);

line('⑦ 各社团候选人数与聚类可行性（需 ≥6）');
for (const r of db.prepare(
  `SELECT c.name, COUNT(a.id) AS c FROM club c
   LEFT JOIN recruitment r ON r.club_id = c.id
   LEFT JOIN position p ON p.recruitment_id = r.id
   LEFT JOIN application a ON a.position_id = p.id
   GROUP BY c.id ORDER BY c DESC`
).all()) {
  console.log(`  ${r.name.padEnd(16)} ${String(r.c).padStart(3)} 人${r.c >= 6 ? '' : '  ← 不足，不会分组'}`);
}
