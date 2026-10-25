/**
 * ML HTTP 接口端到端验证
 * 用法：node scripts/verify-ml-http.mjs
 *
 * 注意社团端有两层认证：
 *   ① HTTP Basic Auth（全站密码，来自 server/.env）
 *   ② 社团账号 token（X-Club-Token，登录获得）
 * 两个都要带，否则会 401。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV = path.resolve(__dirname, '../.env');
const BASE = process.env.BASE || 'http://localhost:3000/api/v1';

function envVal(key, fallback = '') {
  if (!fs.existsSync(ENV)) return fallback;
  const m = fs.readFileSync(ENV, 'utf8').match(new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : fallback;
}

const basicUser = envVal('BASIC_AUTH_USER', 'admin');
const basicPass = envVal('BASIC_AUTH_PASS', '');
const basic = 'Basic ' + Buffer.from(`${basicUser}:${basicPass}`).toString('base64');

const req = async (p, { method = 'GET', body, token } = {}) => {
  const headers = { Authorization: basic };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['X-Club-Token'] = token;
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, body: json };
};

const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => console.log(`  ❌ ${m}`);
const hdr = (m) => { console.log(''); console.log(`── ${m} ──`); };

/* ── 0. 登录 ── */
hdr('0. 社团账号登录');
const login = await req('/auth/login', {
  method: 'POST',
  body: {
    username: process.env.CLUB_USER || 'owner_f69511',
    password: process.env.CLUB_PASS || '',
  },
});
// 用重置脚本之外的方式拿不到明文密码，所以改从数据库取账号名、并提示用已知密码
let token = '';
if (login.status === 200) {
  token = login.body.data.token;
  ok(`登录成功：${login.body.data.account.clubName} / ${login.body.data.account.role}`);
} else {
  console.log(`  （密码未知，返回 ${login.status}；改用环境变量 CLUB_TOKEN）`);
  token = process.env.CLUB_TOKEN || '';
}

if (!token) {
  console.log('\n⚠️ 没有社团账号 token，无法测需要登录的接口。');
  console.log('   请设置环境变量 CLUB_TOKEN，或先执行 npm run account:reset 设一个已知密码后重跑。');
  process.exit(0);
}

const me = await req('/auth/me', { token });
const clubId = me.body?.data?.clubId;
ok(`当前社团：${me.body?.data?.clubName}（${clubId}）`);

/* ── 1. ML 状态 ── */
hdr('1. 模型状态 GET /ml/status');
const st = await req('/ml/status', { token });
if (st.status === 200) {
  const d = st.body.data;
  ok(`enabled=${d.enabled} ready=${d.ready} model=${d.model} dim=${d.dim}`);
  console.log(`     镜像 ${d.remoteHost}，内存缓存 ${d.memoryCacheSize} 条`);
} else bad(`HTTP ${st.status}`);

/* ── 2. 匹配能力（规则 or 语义）── */
hdr('2. 匹配能力 GET /ml/status（matchService 视角）');
const cap = await req('/ml/status', { token });
if (cap.status === 200) ok('可读');

/* ── 3. 候选人聚类 ── */
hdr('3. 候选人聚类 GET /ml/clubs/:clubId/clusters');
const cl = await req(`/ml/clubs/${clubId}/clusters`, { token });
if (cl.status === 200) {
  const d = cl.body.data;
  if (!d.available) {
    console.log(`  ⚠️ 不可用：${d.reason}`);
  } else if (!d.clusters?.length) {
    console.log(`  ⚠️ 未分组：${d.reason || '候选人数不足'}`);
  } else {
    ok(`k=${d.k}  轮廓系数=${d.silhouette}  惯性=${d.inertia}`);
    for (const c of d.clusters) {
      const who = c.members.map((m) => m.studentName).join('、');
      const prof = c.profile.map((p) => `${p.skill}×${p.count}`).join(' ');
      console.log(`     簇${c.index}（${c.size} 人）：${who}`);
      console.log(`        画像：${prof || '—'}`);
    }
  }
} else bad(`HTTP ${cl.status} ${JSON.stringify(cl.body).slice(0, 160)}`);

/* ── 4. 技能自动抽取 ── */
hdr('4. 技能自动抽取 POST /ml/resumes/:id/auto-skills');
const apps = await req(`/clubs/${clubId}/applications?pageSize=5`, { token });
const resumeIds = [...new Set((apps.body?.data?.list || []).map((a) => a.resume_id))];
if (resumeIds.length === 0) {
  console.log('  （没有简历可测）');
} else {
  for (const rid of resumeIds.slice(0, 3)) {
    const ex = await req(`/ml/resumes/${rid}/auto-skills`, { method: 'POST', token });
    if (ex.status === 200) {
      const d = ex.body.data;
      const exact = d.details.filter((x) => x.source === 'exact').length;
      const sem = d.details.filter((x) => x.source === 'semantic').length;
      console.log(`     ${rid}  method=${d.method}`);
      console.log(`        人工标签: ${d.humanSkills || '（空）'}`);
      console.log(`        自动抽取: ${d.skills.join('、') || '（无）'}`);
      console.log(`        来源分布: 词典 ${exact} 个 / 语义 ${sem} 个`);
    } else {
      bad(`HTTP ${ex.status}`);
    }
  }
}

console.log('\n═══ ML 接口验证完成 ═══');
