/**
 * 在服务器上导入本机导出的数据（搬家收尾）
 *
 * 用法（把导出目录整个传到服务器后）：
 *   node scripts/import-data.mjs --from /root/community-export
 *   node scripts/import-data.mjs --from /root/community-export --force   # 覆盖已有数据
 *
 * 行为：
 *   - 校验来源目录里有 club.db
 *   - 若 server/data/club.db 已存在且非空，必须加 --force 才覆盖（防手滑清库）
 *   - 覆盖前自动把现有库备份成 club.db.bak-<时间戳>
 *   - 顺带把 uploads/ 合并过去
 *
 * 重要：运行前请先停掉服务（否则文件被占用 / 写入丢失）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
// 目标位置支持环境变量覆盖：便于在本地用临时目录做演练（不碰真实库）
const DATA_DIR = process.env.DATA_DIR || path.join(SERVER_DIR, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(SERVER_DIR, 'uploads');

function parseArgs(argv) {
  const out = { force: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--from') out.from = argv[++i];
    else if (argv[i] === '--force') out.force = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.from) {
  console.error('用法：node scripts/import-data.mjs --from <导出目录> [--force]');
  process.exit(1);
}

const srcDir = path.resolve(args.from);
const srcDb = path.join(srcDir, 'club.db');
if (!fs.existsSync(srcDb)) {
  console.error(`✗ 在 ${srcDir} 里找不到 club.db`);
  process.exit(1);
}

// 先验证来源库确实可用（避免把坏文件盖到生产库上）
try {
  const probe = new Database(srcDb, { readonly: true });
  const ver = probe.pragma('user_version', { simple: true });
  const clubs = probe.prepare('SELECT COUNT(*) AS c FROM club').get().c;
  probe.close();
  console.log(`[import] 来源库校验通过：迁移版本=${ver}，社团数=${clubs}`);
} catch (e) {
  console.error('✗ 来源库无法打开，已中止：', e.message);
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const targetDb = process.env.DB_PATH || path.join(DATA_DIR, 'club.db');

// 已有数据时的保护：非空库必须显式 --force
if (fs.existsSync(targetDb) && fs.statSync(targetDb).size > 0 && !args.force) {
  let existingClubs = 0;
  try {
    const p = new Database(targetDb, { readonly: true });
    existingClubs = p.prepare('SELECT COUNT(*) AS c FROM club').get().c;
    p.close();
  } catch {
    /* 打不开就当空库处理 */
  }
  if (existingClubs > 0) {
    console.error(`✗ 目标库已有 ${existingClubs} 个社团。确认要覆盖请加 --force`);
    console.error('  提示：覆盖前会自动备份为 club.db.bak-<时间戳>');
    process.exit(1);
  }
}

// 备份现有库（连同 WAL，保证备份完整）
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
for (const suffix of ['', '-wal', '-shm']) {
  const f = targetDb + suffix;
  if (fs.existsSync(f)) {
    fs.copyFileSync(f, `${targetDb}.bak-${stamp}${suffix}`);
  }
}
console.log(`[import] 现有库已备份为 club.db.bak-${stamp}*`);

// 覆盖主库，并清掉可能残留的 WAL（否则旧 WAL 会覆盖新库内容）
fs.copyFileSync(srcDb, targetDb);
for (const suffix of ['-wal', '-shm']) {
  const f = targetDb + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
console.log('[import] club.db 已导入（并清除残留 WAL）');

// 合并 uploads
let copied = 0;
const srcUploads = path.join(srcDir, 'uploads');
if (fs.existsSync(srcUploads)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  for (const name of fs.readdirSync(srcUploads)) {
    const s = path.join(srcUploads, name);
    if (!fs.statSync(s).isFile()) continue;
    fs.copyFileSync(s, path.join(UPLOADS_DIR, name));
    copied += 1;
  }
}
console.log(`[import] 附件已合并：${copied} 个`);

// 复核
const check = new Database(targetDb, { readonly: true });
console.log('\n导入后各表行数：');
for (const t of ['club', 'recruitment', 'position', 'resume', 'application', 'club_account']) {
  try {
    console.log(`  ${t.padEnd(15)} ${check.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c}`);
  } catch {
    console.log(`  ${t.padEnd(15)} (无此表)`);
  }
}
check.close();

console.log('\n✓ 完成。现在可以启动服务，用你原来的社长账号密码登录。');
