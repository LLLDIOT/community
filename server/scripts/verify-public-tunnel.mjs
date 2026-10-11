/**
 * 公网端到端验证：从公网学生端投递 → 检查是否落到本机数据库 → 清理
 * 用法：node scripts/verify-public-tunnel.mjs <公网地址>
 * 例：  node scripts/verify-public-tunnel.mjs http://12d78ad2.r6.cpolar.top
 */
import { db } from '../src/db/connection.js';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法：node scripts/verify-public-tunnel.mjs <公网地址>');
  process.exit(1);
}

const count = () => ({
  resume: db.prepare('SELECT COUNT(*) c FROM resume').get().c,
  application: db.prepare('SELECT COUNT(*) c FROM application').get().c,
});

const before = count();
console.log('投递前：', before);

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  return { status: r.status, body: await r.json().catch(() => null) };
};

// ① 公网取社团与岗位
const clubs = await j(`${BASE}/api/v1/clubs?page=1&pageSize=5`);
const club = clubs.body.data.list[0];
const detail = await j(`${BASE}/api/v1/clubs/${club.id}`);
const pos = detail.body.data.recruitments[0].positions[0];
console.log(`① 公网读到：${detail.body.data.name} / ${pos.title}`);

// ② 公网建简历
const resume = await j(`${BASE}/api/v1/resumes`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    studentName: '公网验证·临时',
    grade: '大一', major: '软件工程', skills: 'Vue', content: '【公网验证】脚本自动清理',
  }),
});
console.log(`② 公网建简历：HTTP ${resume.status} id=${resume.body?.data?.id}`);
const resumeId = resume.body.data.id;

// ③ 公网投递
const apply = await j(`${BASE}/api/v1/positions/${pos.id}/applications`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ resumeId, typeTag: 'technical' }),
});
console.log(`③ 公网投递：HTTP ${apply.status} id=${apply.body?.data?.id}`);
const appId = apply.body.data.id;

// ④ 公网查进度
const progress = await j(`${BASE}/api/v1/applications/${appId}`);
console.log(`④ 公网查进度：状态=${progress.body?.data?.status} 岗位=${progress.body?.data?.position_title}`);

// ⑤ 关键：这条件投递是否真的进了本机数据库
const after = count();
console.log('投递后：', after);

const row = db
  .prepare(
    `SELECT a.id, a.status, res.student_name, pos.title AS position_title
     FROM application a
     JOIN resume res ON res.id = a.resume_id
     JOIN position pos ON pos.id = a.position_id
     WHERE a.id = ?`
  )
  .get(appId);

console.log('\n════════ 结论 ════════');
if (row && after.application === before.application + 1) {
  console.log('✅ 公网投递真实落库：');
  console.log(`   应用 id : ${row.id}`);
  console.log(`   姓名    : ${row.student_name}`);
  console.log(`   岗位    : ${row.position_title}`);
  console.log(`   状态    : ${row.status}`);
  console.log(`   投递数  : ${before.application} → ${after.application}`);
} else {
  console.log('❌ 未在数据库中找到这条投递');
}

// ⑥ 清理
const tx = db.transaction(() => {
  db.prepare('DELETE FROM application WHERE id = ?').run(appId);
  db.prepare('DELETE FROM resume WHERE id = ?').run(resumeId);
  db.prepare('DELETE FROM club_session').run();
});
tx();

const final = count();
console.log(`\n清理后：简历 ${final.resume} / 投递 ${final.application}` +
  (final.resume === before.resume && final.application === before.application ? '  ✅ 已还原' : '  ⚠️ 未完全还原'));
