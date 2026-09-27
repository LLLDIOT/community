/**
 * 导出本机数据（用于搬家到云服务器）
 *
 * 导出内容：
 *   - club.db 的一致性快照（先做 WAL checkpoint，保证写进主库文件）
 *   - uploads/ 里的简历附件
 *   - 账号清单（不含明文口令！口令是 scrypt 派生值，随库一起走，
 *     登录仍用你原来的密码；忘了就用 reset-club-password 在服务器上重置）
 *
 * 用法：
 *   node scripts/export-data.mjs                 # 导出到 ./export-<时间戳>/
 *   node scripts/export-data.mjs --out D:\bak    # 指定输出目录
 *
 * 产出目录里有：
 *   club.db            —— 直接放到服务器的 server/data/ 即可
 *   uploads/           —— 直接放到服务器的 server/uploads/
 *   MANIFEST.txt       —— 记录导出时间与各表行数，便于核对
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db/connection.js';
import { nowIso } from '../src/utils/id.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(SERVER_DIR, 'data');
const UPLOADS_DIR = path.join(SERVER_DIR, 'uploads');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'club.db');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') out.out = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = args.out ? path.resolve(args.out) : path.join(SERVER_DIR, `export-${stamp}`);

fs.mkdirSync(outDir, { recursive: true });

// ① 关键：先把 WAL 里的内容合并回主库文件，否则拷出来的 club.db 会缺最新写入
db.pragma('wal_checkpoint(TRUNCATE)');
console.log('[export] WAL 已 checkpoint，主库文件为完整快照');

// ② 拷数据库
const targetDb = path.join(outDir, 'club.db');
fs.copyFileSync(DB_PATH, targetDb);
const dbSize = fs.statSync(targetDb).size;
console.log(`[export] club.db → ${targetDb}（${(dbSize / 1024).toFixed(1)} KB）`);

// ③ 拷附件
let uploadCount = 0;
let uploadBytes = 0;
const targetUploads = path.join(outDir, 'uploads');
if (fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(targetUploads, { recursive: true });
  for (const name of fs.readdirSync(UPLOADS_DIR)) {
    const src = path.join(UPLOADS_DIR, name);
    if (!fs.statSync(src).isFile()) continue;
    fs.copyFileSync(src, path.join(targetUploads, name));
    uploadCount += 1;
    uploadBytes += fs.statSync(src).size;
  }
}
console.log(`[export] uploads/ → ${uploadCount} 个附件（${(uploadBytes / 1024).toFixed(1)} KB）`);

// ④ 清单（便于在服务器上核对行数是否一致）
const tables = ['club', 'recruitment', 'position', 'resume', 'application', 'tag', 'application_tags', 'club_account', 'club_session'];
const counts = {};
for (const t of tables) {
  try {
    counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  } catch {
    counts[t] = '(无此表)';
  }
}

const manifest = [
  '社团招新系统 · 数据导出清单',
  `导出时间：${nowIso()}`,
  `来源库  ：${DB_PATH}`,
  `迁移版本：${db.pragma('user_version', { simple: true })}`,
  '',
  '各表行数：',
  ...Object.entries(counts).map(([k, v]) => `  ${k.padEnd(18)} ${v}`),
  '',
  '部署到服务器后：',
  '  1) club.db 放到 server/data/club.db',
  '  2) uploads/ 里的文件放到 server/uploads/',
  '  3) 重启服务，用你原来的社长账号密码登录（口令随库一起迁移）',
  '  4) 核对行数是否与上面一致',
  '  5) 若忘记口令：cd server && npm run account:reset -- --club 社团名',
  '',
  '注意：本文件不含任何明文口令；club.db 里有账号的 scrypt 派生值，',
  '      属于敏感文件，请勿提交到公开仓库或随手分享。',
  '',
].join('\n');

fs.writeFileSync(path.join(outDir, 'MANIFEST.txt'), manifest, 'utf8');

console.log('\n[export] 完成。目录内容：');
console.log(manifest);
console.log(`输出目录：${outDir}`);
