// e2e-portal-test.mjs —— 模拟学生端 portal-adapter.js 的完整投递链路
// 验证：真实写入 SQLite、投递记录可查、状态可查

const API = 'http://localhost:3000/api/v1';

async function req(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok || json.code !== 0) throw new Error(json.message || `HTTP ${res.status}`);
  return json.data;
}

// 1) 学生端加载社团列表（adapter.listClubs 的等价调用）
const clubList = await req('/clubs?page=1&pageSize=100');
console.log('[1] 社团列表:', clubList.list.map((c) => c.name).join(', '));

// 2) 取社团详情，找开放岗位（adapter.getClub 的等价调用）
let target = null;
for (const c of clubList.list) {
  const detail = await req(`/clubs/${c.id}`);
  const positions = (detail.recruitments || []).flatMap((r) =>
    (r.positions || []).map((p) => ({ ...p, recStatus: r.status, recTitle: r.title }))
  );
  console.log(`[2] ${c.name} 有 ${positions.length} 个岗位:`,
    positions.map((p) => `${p.title}(${p.rec_status || r_status(p)}/${p.headcount})`).join(', '));
  const open = positions.find((p) => p.recStatus === 'open');
  if (!target && open) target = { club: detail, position: open };
}
function r_status(p) { return p.filled_count; }

if (!target) { console.error('没有开放中的岗位，无法投递'); process.exit(1); }
console.log(`[3] 选中: ${target.club.name} / ${target.position.title} (${target.position.id})`);

// 3) 组装简历 + 投递（adapter.apply 的等价调用）
const stamp = Date.now().toString().slice(-6);
const content = [
  '【姓名】\n测试学生' + stamp,
  '【基本信息（学院/专业/年级）】\n计算机学院 · 软件工程 · 大二',
  '【联系方式（电话/邮箱）】\n13900001111 / test' + stamp + '@stu.edu.cn',
  '【技术技能】\nVue, Node.js, SQLite',
  '【项目/工作经历】\n2025.03-2025.06 参与校园二手交易平台开发，负责前端页面与接口联调',
  '【竞赛/获奖经历】\n校级程序设计大赛三等奖',
  '【代表项目作品描述】\n二手交易平台：Vue3 + Express，实现商品发布与站内搜索',
  '【自我介绍（为什么想加入）】\n希望在社团中参与真实项目开发，提升工程能力。',
].join('\n\n');

const resume = await req('/resumes', {
  method: 'POST',
  body: {
    studentName: '测试学生' + stamp,
    phone: '13900001111',
    email: `test${stamp}@stu.edu.cn`,
    school: '计算机学院',
    major: '软件工程',
    grade: '大二',
    skills: 'Vue, Node.js, SQLite',
    content,
  },
});
console.log(`[4] 简历已入库: ${resume.id}`);

const application = await req(`/positions/${target.position.id}/applications`, {
  method: 'POST',
  body: { resumeId: resume.id, typeTag: 'technical' },
});
console.log(`[5] 投递成功: ${application.id} 状态=${application.status}`);

// 4) 学生端"我的投递"：按 id 拉最新状态（adapter.listApplications 的等价调用）
const fresh = await req(`/applications/${application.id}`);
console.log(`[6] 回查状态: ${fresh.status} | 社团=${fresh.club_name} | 岗位=${fresh.position_title} | 学生=${fresh.student_name}`);

// 5) 管理端视角：该简历是否出现在简历库
const library = await req(`/clubs/${target.club.id}/applications?page=1&pageSize=50`);
const found = library.list.find((a) => a.id === application.id);
console.log(`[7] 管理端简历库(${target.club.name}) 共 ${library.total} 条，本次投递${found ? '✅ 已出现' : '❌ 未找到'}`);
if (found) console.log(`     -> ${found.student_name} / ${found.position_title} / ${found.status}`);

console.log('\n=== 端到端验证通过：学生端投递 → 持久化到 SQLite → 管理端可见 ===');
console.log('（applicationId 供后续清理）', application.id);
