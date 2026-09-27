/**
 * 重置社团账号密码 / 查看账号
 *
 * 为什么需要它：`initial-accounts.txt` 是**追加**写入的，一个社团若被清空账号后重启，
 * 会再生成一条新记录，文件里于是残留旧口令；而"忘记社长密码"没有任何补救入口。
 * 本脚本直接对数据库操作，是唯一的人工兜底手段。
 *
 * 用法：
 *   node scripts/reset-club-password.mjs                      # 列出所有账号（不显示密码）
 *   node scripts/reset-club-password.mjs --club 计算机协会      # 重置该社团社长密码（随机）
 *   node scripts/reset-club-password.mjs --user owner_f69511   # 重置指定账号密码（随机）
 *   node scripts/reset-club-password.mjs --user xxx --password 自定义密码
 *
 * 重置后会：把新口令打印到控制台 + 追加写入 data/initial-accounts.txt，
 * 并让该账号已登录的会话全部失效。
 */
import { randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db } from '../src/db/connection.js';
import { nowIso } from '../src/utils/id.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--club') out.club = argv[++i];
    else if (a === '--user') out.user = argv[++i];
    else if (a === '--password') out.password = argv[++i];
  }
  return out;
}

function derive(password, salt) {
  return scryptSync(String(password), salt, 64).toString('hex');
}

function appendNote(clubName, username, password) {
  try {
    const dataDir = path.resolve(__dirname, '../data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(
      path.join(dataDir, 'initial-accounts.txt'),
      `# ${nowIso()} 密码重置\n${clubName}\t账号=${username}\t密码=${password}\n`,
      'utf8'
    );
  } catch (e) {
    console.warn('[reset] 未能写入 initial-accounts.txt:', e.message);
  }
}

const args = parseArgs(process.argv.slice(2));

const all = db
  .prepare(
    `SELECT a.id, a.username, a.display_name, a.role, a.is_active, a.club_id, c.name AS club_name
     FROM club_account a JOIN club c ON c.id = a.club_id
     ORDER BY c.name, CASE a.role WHEN 'owner' THEN 0 WHEN 'interviewer' THEN 1 ELSE 2 END`
  )
  .all();

if (!args.club && !args.user) {
  console.log('\n当前社团账号（共 %d 个）：\n', all.length);
  for (const a of all) {
    console.log(
      `  ${a.club_name.padEnd(12)} ${a.username.padEnd(16)} ${a.role.padEnd(12)} ${a.is_active ? '启用' : '停用'}  ${a.display_name || ''}`
    );
  }
  console.log('\n重置密码：');
  console.log('  node scripts/reset-club-password.mjs --club 社团名');
  console.log('  node scripts/reset-club-password.mjs --user 账号名 [--password 自定义密码]\n');
  process.exit(0);
}

let target = null;
if (args.user) {
  target = all.find((a) => a.username === args.user);
  if (!target) {
    console.error(`✗ 找不到账号：${args.user}`);
    process.exit(1);
  }
} else {
  const matches = all.filter((a) => a.club_name === args.club);
  if (matches.length === 0) {
    console.error(`✗ 找不到社团：${args.club}`);
    console.error('  可用社团：' + [...new Set(all.map((a) => a.club_name))].join('、'));
    process.exit(1);
  }
  target = matches.find((a) => a.role === 'owner') || matches[0];
}

const password = args.password || randomBytes(6).toString('base64url');
if (password.length < 6) {
  console.error('✗ 密码至少 6 位');
  process.exit(1);
}

const salt = randomBytes(16).toString('hex');
const hash = derive(password, salt);

const tx = db.transaction(() => {
  db.prepare(
    'UPDATE club_account SET password_hash = ?, salt = ?, is_active = 1, updated_at = ? WHERE id = ?'
  ).run(hash, salt, nowIso(), target.id);
  // 让该账号已登录的会话全部失效
  db.prepare('DELETE FROM club_session WHERE account_id = ?').run(target.id);
});
tx();

appendNote(target.club_name, target.username, password);

console.log('\n✓ 密码已重置\n');
console.log(`  社团  ：${target.club_name}`);
console.log(`  账号  ：${target.username}（${target.role}）`);
console.log(`  新密码：${password}`);
console.log('\n  已登录的会话已全部失效，请用新密码重新登录。');
console.log('  新口令同时追加写入 server/data/initial-accounts.txt\n');
