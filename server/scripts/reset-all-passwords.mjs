/**
 * 把所有密码统一改成指定值（默认 12345）
 *
 * 用法：
 *   node scripts/reset-all-passwords.mjs            # 改成本脚本内置的默认值
 *   node scripts/reset-all-passwords.mjs 新密码      # 临时指定
 *
 * 会做三件事：
 *   ① 改写 server/.env 的 BASIC_AUTH_PASS（原文件自动备份）
 *   ② 重置 club_account 里**所有**账号的密码（scrypt + 新盐）
 *   ③ 清空 club_session，让所有已登录会话立即失效
 *
 * 为什么绕开接口：账号接口有"密码至少 6 位"的校验，而 12345 只有 5 位。
 * 这里直接写库（哈希方式与 authService.hashPassword 完全一致），所以登录仍然正常。
 *
 * ⚠️ 安全提示：这个密码强度极低。若站点正挂在公网，任何人试几次即可进入管理台，
 *    能够查看简历、删改社团/批次/岗位/投递。请仅在演示或内网环境下使用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync } from 'node:crypto';

import { db } from '../src/db/connection.js';
import { nowIso } from '../src/utils/id.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '../.env');

const NEW_PASSWORD = String(process.argv[2] || '12345');

/** 与 authService.hashPassword 完全一致的派生方式 */
function derive(password, salt) {
  return scryptSync(String(password), salt, 64).toString('hex');
}
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: derive(password, salt) };
}

console.log('════════ 统一重置所有密码 ════════');
console.log(`新密码：${NEW_PASSWORD}（${NEW_PASSWORD.length} 位）`);
if (NEW_PASSWORD.length < 8) {
  console.log('⚠️  这个密码强度很低。如果站点在公网，等于对所有人开放管理台。');
}
console.log('');

/* ── ① 全站 Basic Auth ── */
console.log('① 全站访问密码（server/.env）');
if (!fs.existsSync(ENV_PATH)) {
  console.log('   ❌ 找不到 server/.env，跳过');
} else {
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const backup = `${ENV_PATH}.bak-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`;
  fs.writeFileSync(backup, raw, 'utf8');
  console.log(`   已备份：${path.basename(backup)}`);

  const lines = raw.split(/\r?\n/);
  let found = false;
  const out = lines.map((line) => {
    if (/^BASIC_AUTH_PASS\s*=/.test(line)) {
      found = true;
      return `BASIC_AUTH_PASS=${NEW_PASSWORD}`;
    }
    return line;
  });
  if (!found) out.push(`BASIC_AUTH_PASS=${NEW_PASSWORD}`);
  // 必须不带 BOM：dotenv 解析首行时 BOM 会让第一个键名变成 "\uFEFFBASIC_AUTH_USER"
  fs.writeFileSync(ENV_PATH, out.join('\n'), { encoding: 'utf8' });
  console.log(`   ✅ BASIC_AUTH_PASS 已改为 ${NEW_PASSWORD}`);
  console.log('   （需重启服务才生效）');
}

/* ── ② 所有社团账号 ── */
console.log('');
console.log('② 社团账号密码');
const accounts = db.prepare('SELECT id, club_id, username, display_name, role FROM club_account ORDER BY club_id').all();
if (accounts.length === 0) {
  console.log('   没有账号，跳过');
} else {
  const upd = db.prepare(
    'UPDATE club_account SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?'
  );
  const now = nowIso();
  const run = db.transaction(() => {
    for (const a of accounts) {
      const { salt, hash } = hashPassword(NEW_PASSWORD);
      upd.run(hash, salt, now, a.id);
    }
  });
  run();
  for (const a of accounts) {
    console.log(`   ✅ ${a.username.padEnd(16)} ${a.display_name || ''}（${a.role}）→ ${NEW_PASSWORD}`);
  }
}

/* ── ③ 会话失效 ── */
console.log('');
console.log('③ 清理已登录会话');
const before = db.prepare('SELECT COUNT(*) c FROM club_session').get().c;
db.prepare('DELETE FROM club_session').run();
console.log(`   已删除 ${before} 个会话（所有已登录设备需要重新登录）`);

/* ── 汇总 ── */
console.log('');
console.log('════════ 完成 ════════');
console.log('需要做的事：');
console.log('   1) 重启服务让全站密码生效：重启 Community-Server 计划任务');
console.log('   2) 浏览器会弹 Basic Auth 框，用户名 admin，密码 ' + NEW_PASSWORD);
console.log('   3) 然后用社团账号登录，密码同样是 ' + NEW_PASSWORD);
if (NEW_PASSWORD.length < 8) {
  console.log('');
  console.log('⚠️ 如需恢复强密码，执行：node scripts/reset-all-passwords.mjs <新的强密码>');
}
