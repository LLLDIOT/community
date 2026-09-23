/**
 * adapter-test.mjs —— 直接加载真实的 portal-adapter.js 并驱动它完成投递
 * 验证：适配层代码本身可用（结构适配、模板生成、真实落库、记录查询）
 * 用 mock 的 window / localStorage / fetch 让浏览器版代码在 Node 里运行
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:3000';

// ---- 浏览器环境 mock ----
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = globalThis;

// fetch：把相对路径补成后端绝对地址
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => nativeFetch(url.startsWith('http') ? url : BASE + url, opts);

// ---- 加载真实的适配层代码 ----
const adapterSrc = fs.readFileSync(path.join(__dirname, 'public', 'portal-adapter.js'), 'utf8');
// 适配层是 IIFE，直接 eval 即会挂到 window.PortalAPI
new Function(adapterSrc)();
const API = globalThis.PortalAPI;
if (!API) throw new Error('PortalAPI 未挂载');

console.log('=== [A] 结构适配与模板生成 ===');
const clubs = await API.listClubs();
console.log('社团列表:', clubs.map((c) => `${c.name}(${c.icon})`).join(', '));

const club = await API.getClub(clubs[0].id);
console.log(`社团「${club.name}」 分类=${club.category} 介绍=${club.intro.slice(0, 20)}...`);
console.log('岗位数:', club.positions.length, '->', club.positions.map((p) => `${p.name}[${p.closed ? '已截止' : '开放'}]`).join(', '));
console.log('模板:', club.resumeTemplate.title, '| 字段数:', club.resumeTemplate.fields.length);
console.log('模板字段:', club.resumeTemplate.fields.map((f) => `${f.key}(${f.source})`).join(', '));

const openPos = club.positions.find((p) => !p.closed);
if (!openPos) throw new Error('无开放岗位可投递');

console.log('\n=== [B] 学生档案持久化（localStorage）===');
const profile = API.loadProfile();
profile.name = '适配层测试' + Date.now().toString().slice(-5);
profile.college = '计算机学院';
profile.major = '软件工程';
profile.grade = '大二';
profile.phone = '13700002222';
profile.email = 'adapter@stu.edu.cn';
profile.skills = 'Vue, Node.js';
profile.experiences = ['2025.03-2025.06 参与课程项目开发', '', ''];
profile.awards = ['校级三等奖', '', ''];
profile.intro = '希望通过社团提升工程实践能力。';
API.saveProfile(profile);
const reloaded = API.loadProfile();
console.log('写入后重读姓名:', reloaded.name, '| 技能:', reloaded.skills);
console.log('持久化:', reloaded.name === profile.name ? '✅ localStorage 正常' : '❌ 失败');

console.log('\n=== [C] 真实投递（走 adapter.apply → 后端落库）===');
const templateData = {
  name: profile.name,
  basic_info: `${profile.college} · ${profile.major} · ${profile.grade}`,
  contact: `${profile.phone} / ${profile.email}`,
  skills: profile.skills,
  experience: profile.experiences.filter(Boolean).join('\n'),
  awards: profile.awards.filter(Boolean).join('\n'),
  self_intro: profile.intro,
};
const application = await API.apply({
  club,
  position: openPos,
  student: profile,
  templateData,
  templateFields: club.resumeTemplate.fields,
});
console.log(`投递成功: ${application.id} | 状态=${application.status} | 岗位=${application.position_title}`);

console.log('\n=== [D] 我的投递记录（adapter.listApplications）===');
const records = await API.listApplications();
records.slice(0, 3).forEach((r) => {
  console.log(`- ${r.clubName} / ${r.positionName} | 状态=${r.status}(${API.STATUS_LABEL[r.status]}) | ${r.createdAt}`);
});

console.log('\n=== [E] 服务端回查（确认已持久化）===');
const fresh = await (await fetch(`/api/v1/applications/${application.id}`)).json();
console.log('后端返回:', fresh.data.student_name, '|', fresh.data.club_name, '/', fresh.data.position_title, '| 状态:', fresh.data.status);
console.log('简历正文前 60 字:', (fresh.data.content || '').replace(/\n/g, ' ').slice(0, 60));

console.log('\n=== [F] 管理端可见性 ===');
const lib = await (await fetch(`/api/v1/clubs/${club.id}/applications?page=1&pageSize=100`)).json();
const visible = lib.data.list.some((a) => a.id === application.id);
console.log(`社团「${club.name}」简历库共 ${lib.data.total} 条，本次投递${visible ? '✅ 已出现' : '❌ 未出现'}`);
console.log('\n清理用 applicationId:', application.id);
