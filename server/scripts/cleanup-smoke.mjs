/**
 * 一次性清理：移除冒烟测试残留
 *  - 无投递的「冒烟测试·*」简历
 *  - 被测试覆盖的社团录入标准 / 投递时间窗（恢复为迁移 004 的初始值）
 *  - 测试登录产生的会话
 * 用法：node scripts/cleanup-smoke.mjs
 */
import { db } from '../src/db/connection.js';

const before = {
  resume: db.prepare('SELECT COUNT(*) c FROM resume').get().c,
  application: db.prepare('SELECT COUNT(*) c FROM application').get().c,
  club: db.prepare('SELECT COUNT(*) c FROM club').get().c,
  club_session: db.prepare('SELECT COUNT(*) c FROM club_session').get().c,
};

// ① 删掉测试简历（仅限没有投递的，避免误伤）
const orphans = db
  .prepare(
    `SELECT id, student_name FROM resume
     WHERE student_name LIKE '冒烟测试%' OR student_name LIKE '联调测试%'
       AND NOT EXISTS (SELECT 1 FROM application a WHERE a.resume_id = resume.id)`
  )
  .all();
const delResume = db.prepare('DELETE FROM resume WHERE id = ?');
for (const r of orphans) delResume.run(r.id);
console.log(`删除测试简历 ${orphans.length} 条: ${orphans.map((r) => r.student_name).join(', ') || '（无）'}`);

// ①b 删掉"冒烟测试"候选人留下的投递（先删投递，简历才删得掉）
const smokeApps = db
  .prepare(
    `SELECT a.id, res.student_name FROM application a
     JOIN resume res ON res.id = a.resume_id
     WHERE res.student_name LIKE '冒烟测试%' OR student_name LIKE '联调测试%'`
  )
  .all();
const delApp = db.prepare('DELETE FROM application WHERE id = ?');
for (const a of smokeApps) delApp.run(a.id);
console.log(`删除测试投递 ${smokeApps.length} 条`);

// ①c 再清一次简历（此时已无投递关联）
const orphans2 = db
  .prepare(
    `SELECT id, student_name FROM resume
     WHERE student_name LIKE '冒烟测试%' OR student_name LIKE '联调测试%'
       AND NOT EXISTS (SELECT 1 FROM application a WHERE a.resume_id = resume.id)`
  )
  .all();
for (const r of orphans2) delResume.run(r.id);
console.log(`二次清理测试简历 ${orphans2.length} 条`);

// ①d 删掉测试期间新建的社团（会级联删掉其账号/批次/岗位）
const smokeClubs = db
  .prepare(`SELECT id, name FROM club WHERE name LIKE '冒烟测试%'`)
  .all();
const delClub = db.prepare('DELETE FROM club WHERE id = ?');
for (const c of smokeClubs) delClub.run(c.id);
console.log(`删除测试社团 ${smokeClubs.length} 个: ${smokeClubs.map((c) => c.name).join(', ') || '（无）'}`);

// ①e 清掉所有登录会话（都是测试产生的）
const delSessions0 = db.prepare('DELETE FROM club_session').run();
console.log(`清理登录会话 ${delSessions0.changes} 条`);

// ② 恢复被测试写入的社团字段为初始值（该列由迁移 004 新增，此前无业务数据）
const resetClub = db
  .prepare(
    `UPDATE club SET entry_criteria = '', apply_start_at = NULL, apply_end_at = NULL
     WHERE entry_criteria LIKE '%冒烟测试%'`
  )
  .run();
console.log(`重置社团录入标准/投递窗 ${resetClub.changes} 个`);

// ③ 清掉测试登录会话
const delSessions = db.prepare('DELETE FROM club_session').run();
console.log(`清理登录会话 ${delSessions.changes} 条`);

const after = {
  resume: db.prepare('SELECT COUNT(*) c FROM resume').get().c,
  application: db.prepare('SELECT COUNT(*) c FROM application').get().c,
  club: db.prepare('SELECT COUNT(*) c FROM club').get().c,
  club_session: db.prepare('SELECT COUNT(*) c FROM club_session').get().c,
};

console.log('\n计数变化：');
for (const k of Object.keys(before)) {
  const flag = before[k] === after[k] ? '=' : '→';
  console.log(`  ${k.padEnd(14)} ${before[k]} ${flag} ${after[k]}`);
}

console.log('\n剩余简历：');
for (const r of db.prepare('SELECT student_name, created_at FROM resume ORDER BY created_at').all()) {
  console.log(`  ${r.created_at}  ${r.student_name}`);
}
console.log('\n社团录入标准：');
for (const c of db.prepare('SELECT name, entry_criteria FROM club').all()) {
  console.log(`  ${c.name}: ${c.entry_criteria === '' ? '(空)' : c.entry_criteria}`);
}
