/**
 * 一次性：清掉"联调测试"遗留记录（其姓名因 PowerShell 编码问题被写坏，无法用 LIKE 匹配）
 * 用法：node scripts/cleanup-stray.mjs
 */
import { db } from '../src/db/connection.js';

const KEEP = ['王小明', '赵小红', '钱多多', '孙小美'];

const strays = db
  .prepare('SELECT id, student_name FROM resume')
  .all()
  .filter((r) => !KEEP.includes(r.student_name));

const delApp = db.prepare('DELETE FROM application WHERE resume_id = ?');
const delRes = db.prepare('DELETE FROM resume WHERE id = ?');

const tx = db.transaction(() => {
  for (const r of strays) {
    const a = delApp.run(r.id).changes;
    delRes.run(r.id);
    console.log(`  删除简历 ${r.id} (name=${JSON.stringify(r.student_name)})，连带投递 ${a} 条`);
  }
  db.prepare('DELETE FROM club_session').run();
});
tx();

console.log('\n最终状态：');
for (const t of ['club', 'recruitment', 'position', 'resume', 'application', 'club_account', 'club_session']) {
  console.log(`  ${t.padEnd(15)} ${db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c}`);
}
console.log('  简历名单：' + db.prepare('SELECT student_name FROM resume ORDER BY created_at').all().map((r) => r.student_name).join('、'));
