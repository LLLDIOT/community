/**
 * 一次性检查：申请详情接口是否返回 skills_auto（抽屉要展示它）
 * 用法：node scripts/check-skills-auto.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
const get = (k, d = '') => (env.match(new RegExp(`^${k}\\s*=\\s*(.*)$`, 'm')) || [, d])[1].trim();
const basic = 'Basic ' + Buffer.from(`${get('BASIC_AUTH_USER', 'admin')}:${get('BASIC_AUTH_PASS')}`).toString('base64');
const BASE = 'http://localhost:3000/api/v1';

const req = async (p, opts = {}) => {
  const r = await fetch(BASE + p, {
    ...opts,
    headers: { Authorization: basic, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const login = await req('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username: 'owner_f69511', password: 'Srf7pS8r' }),
});
if (login.status !== 200) {
  console.error('登录失败，请先在脚本里改成你当前的社长密码');
  process.exit(1);
}
const token = login.body.data.token;
const clubId = login.body.data.account.clubId;

const list = await req(`/clubs/${clubId}/applications?pageSize=5`, { headers: { 'X-Club-Token': token } });
const first = list.body?.data?.list?.[0];
console.log(`取到投递：${first?.id}`);

const detail = await req(`/applications/${first.id}`, { headers: { 'X-Club-Token': token } });
const d = detail.body?.data || {};
console.log('\n详情接口返回的相关字段：');
console.log(`  skills      = ${JSON.stringify(d.skills)}`);
console.log(`  skills_auto = ${JSON.stringify(d.skills_auto)}`);
if ('skills_auto' in d) {
  console.log('\n✅ 详情接口已返回 skills_auto —— 抽屉重新打开时能看到已抽取结果');
} else {
  console.log('\n❌ 详情接口没有返回 skills_auto');
}
