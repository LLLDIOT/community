/**
 * 提交前密钥自查 —— 防止密码/凭据被误提交到公开仓库
 *
 * 用法：node scripts/check-no-secrets.mjs
 *
 * 背景：本项目曾把 `server/.env.bak-*`（含明文 BASIC_AUTH_PASS）提交进公开仓库。
 * 密码虽已作废，但这类失误必须有自动化拦截，不能靠人记得。
 *
 * 检查两类问题：
 *   ① 文件名黑名单：.env / .env.bak* / initial-accounts.txt / *.db / *.log
 *      —— 这些文件本身就含有凭据或个人数据，一律不该被跟踪
 *   ② 内容比对：把 .env 与 initial-accounts.txt 里的真实密码值，
 *      拿去在全部被跟踪文件里搜一遍，命中即报警
 *
 * 退出码：0 = 干净；1 = 发现问题
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_DIR, '..');

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

/* ── 取被跟踪的文件列表 ── */
let tracked = [];
try {
  tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
} catch (e) {
  console.error(red('无法执行 git ls-files：'), e.message);
  process.exit(1);
}

console.log(`检查 ${tracked.length} 个被跟踪文件…\n`);

/* ── ① 文件名黑名单 ── */
const NAME_RULES = [
  { re: /(^|\/)\.env$/, why: '运行配置，含明文密码' },
  { re: /\.env\.bak/, why: '.env 的备份，含明文密码' },
  { re: /initial-accounts\.txt$/, why: '初始账号密码清单' },
  { re: /\.(db|db-wal|db-shm|sqlite3?)$/, why: '数据库文件，含学生个人信息' },
  { re: /(^|\/)uploads\//, why: '简历附件，属个人隐私' },
  { re: /\.log$/, why: '日志可能含请求内容与凭据' },
];

const nameHits = [];
for (const f of tracked) {
  for (const r of NAME_RULES) {
    if (r.re.test(f)) {
      nameHits.push({ file: f, why: r.why });
      break;
    }
  }
}

/* ── ② 内容比对：收集真实密钥值 ── */
const secrets = [];

function collectFromEnvFile(p, label) {
  if (!fs.existsSync(p)) return;
  const txt = fs.readFileSync(p, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    const [, key, val] = m;
    if (!/PASS|SECRET|TOKEN|KEY/i.test(key)) continue;
    if (!val || val.length < 4) continue;
    // 明显的占位符不算泄露
    if (/^(change-me|your-|xxx|<|example|test$|123456$)/i.test(val)) continue;
    secrets.push({ label: `${label}:${key}`, value: val });
  }
}

collectFromEnvFile(path.join(SERVER_DIR, '.env'), '.env');
// 已作废的历史备份也纳入比对：即使密码轮换过，也不该出现在仓库里
for (const f of fs.readdirSync(SERVER_DIR).filter((x) => x.startsWith('.env.bak'))) {
  collectFromEnvFile(path.join(SERVER_DIR, f), f);
}

const accountsFile = path.join(SERVER_DIR, 'data', 'initial-accounts.txt');
if (fs.existsSync(accountsFile)) {
  for (const line of fs.readFileSync(accountsFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/密码=(\S+)/);
    if (m && m[1].length >= 4) secrets.push({ label: 'initial-accounts:密码', value: m[1] });
  }
}

// 去重 + 过滤掉过于常见、会产生大量误报的短值
const uniqSecrets = [...new Map(secrets.map((s) => [s.value, s])).values()].filter(
  (s) => s.value.length >= 4 && !/^\d{1,5}$/.test(s.value)
);

console.log(`比对 ${uniqSecrets.length} 个真实密钥值…\n`);

const contentHits = [];
const TEXT_EXT = /\.(js|mjs|cjs|json|md|txt|vue|css|html|yml|yaml|sh|ps1|bat|env|example|toml|ini|sql|gitignore|gitattributes)$/i;

for (const f of tracked) {
  if (!TEXT_EXT.test(f) && !f.includes('.env')) continue;
  const full = path.join(REPO_ROOT, f);
  let st;
  try {
    st = fs.statSync(full);
  } catch {
    continue;
  }
  if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;
  let txt;
  try {
    txt = fs.readFileSync(full, 'utf8');
  } catch {
    continue;
  }
  for (const s of uniqSecrets) {
    if (txt.includes(s.value)) contentHits.push({ file: f, label: s.label });
  }
}

/* ── 汇总 ── */
let bad = 0;

if (nameHits.length > 0) {
  bad += nameHits.length;
  console.log(red('✗ 不该被跟踪的文件：'));
  for (const h of nameHits) console.log(`    ${h.file}   （${h.why}）`);
  console.log(yellow('    修复：git rm --cached <文件>，并在 .gitignore 里加规则\n'));
}

if (contentHits.length > 0) {
  bad += contentHits.length;
  console.log(red('✗ 文件内容里出现了真实密钥：'));
  for (const h of contentHits) console.log(`    ${h.file}   命中 ${h.label}`);
  console.log(yellow('    修复：删掉该值，并立即轮换对应密码\n'));
}

if (bad === 0) {
  console.log(green('✅ 未发现密钥泄露风险'));
  process.exit(0);
}

console.log(red(`共 ${bad} 处问题 —— 请修复后再提交`));
process.exit(1);
