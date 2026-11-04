/**
 * 生成演示数据集（独立数据库，不影响真实数据）
 *
 * 用法：node scripts/seed-demo-data.mjs [--force]
 *
 * 行为：
 *   1. 以真实库的结构为模板，生成 server/data/demo.db
 *   2. 清空其中的业务数据，写入一套体量足够展示的虚构数据
 *   3. 打印统计
 *
 * 数据全部虚构（社团、学生、投递均为编造），仅用于界面展示与截图。
 * 真实库 server/data/club.db 不会被读写。
 *
 * 生成后导出快照：
 *   PowerShell: $env:DB_PATH='<绝对路径>\server\data\demo.db'; node scripts/export-dashboard.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { genId } from '../src/utils/id.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const SRC = path.join(DATA_DIR, 'club.db');
const DEMO = path.join(DATA_DIR, 'demo.db');

if (!fs.existsSync(SRC)) {
  console.error('找不到真实库 server/data/club.db，无法作为结构模板');
  process.exit(1);
}

if (fs.existsSync(DEMO)) {
  if (!process.argv.includes('--force')) {
    console.error(`演示库已存在：${DEMO}\n如需重建请加 --force`);
    process.exit(1);
  }
  fs.rmSync(DEMO, { force: true });
}
fs.copyFileSync(SRC, DEMO);

const db = new Database(DEMO);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ---------- 清空业务数据（保留结构与版本号） ---------- */
db.exec(`
  DELETE FROM application_tags;
  DELETE FROM application;
  DELETE FROM position;
  DELETE FROM recruitment;
  DELETE FROM resume;
  DELETE FROM tag;
  DELETE FROM club_session;
  DELETE FROM club_account;
  DELETE FROM embedding_cache;
  DELETE FROM club;
`);

/* ---------- 可复现的伪随机数 ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261105);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const pickN = (arr, n) => {
  const copy = arr.slice();
  const out = [];
  for (let i = 0; i < n && copy.length; i += 1) out.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
  return out;
};
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));

const p2 = (n) => String(n).padStart(2, '0');
const iso = (d) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T` +
  `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.000Z`;
const daysAgo = (n, hour) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour != null ? hour : int(7, 23), int(0, 59), int(0, 59), 0);
  return d;
};
const NOW = iso(new Date());

/* ---------- 词表 ---------- */
const SKILLS_BY_TYPE = {
  technical: ['Vue', 'React', 'Node.js', 'Python', 'Java', 'HTML', 'CSS', 'JavaScript', 'TypeScript', 'MySQL', '机器学习', '数据分析'],
  organizing: ['活动策划', '活动组织', '沟通协调', '项目管理', '外联赞助', '财务预算', '团队协作', '时间管理'],
  artistic: ['设计', '海报', '排版', '摄影', '视频剪辑', '文案', '绘画', '书法', 'UI设计', '配色'],
  sports: ['篮球', '足球', '羽毛球', '田径', '体能训练', '团队协作'],
  academic: ['数学建模', 'ACM', '论文写作', '辩论', '逻辑分析', '科研'],
  service: ['志愿服务', '公益项目', '支教', '沟通协调', '活动组织'],
  other: ['沟通协调', '时间管理', '执行力'],
};

const CONTENT_BY_TYPE = {
  technical: [
    '参与过校园二手交易平台的开发，负责前端页面与接口联调。',
    '独立完成过一个课程项目，使用 Vue 与 Node.js 实现完整的增删改查。',
    '熟悉数据结构与算法，做过一个基于 Python 的数据分析小工具。',
  ],
  organizing: [
    '担任班级组织委员，组织过三次班级团建与一次迎新活动。',
    '参与策划校园文化节的社团展区，负责场地协调与物料采购。',
    '有外联经验，为社团活动争取过校外商家赞助。',
  ],
  artistic: [
    '负责社团公众号的视觉设计，做过十余张活动海报。',
    '长期摄影，熟悉相机参数与后期修图流程。',
    '参加过校级书法比赛，擅长排版与配色。',
  ],
  sports: [
    '高中起参加校篮球队，担任控球后卫。',
    '每周固定训练，参加过市级羽毛球双打比赛。',
    '负责队内体能训练计划，有一定的带队经验。',
  ],
  academic: [
    '参加过全国大学生数学建模竞赛，负责模型建立与论文撰写。',
    '有 ACM 训练经历，熟悉常见算法与复杂度分析。',
    '长期参与辩论赛，擅长逻辑拆解与临场表达。',
  ],
  service: [
    '参加过三次社区志愿服务，累计服务时长超过 80 小时。',
    '参与暑期支教，负责课程设计与班级管理。',
    '组织过校园旧衣回收活动，协调场地与志愿者排班。',
  ],
  other: ['做事踏实，愿意从基础工作做起。', '有较强的执行力，能按计划推进任务。'],
};

const SURNAMES = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗'];
const GIVEN = ['小明', '小红', '小美', '思远', '雨桐', '子涵', '欣怡', '浩然', '嘉懿', '梓萱', '宇航', '若曦', '知远', '书瑶', '沐辰', '清和', '未央', '亦航', '南乔', '砚秋', '望舒', '景行'];
const SCHOOLS = ['示例大学', '理工大学', '师范大学', '财经大学', '医科大学'];
const MAJORS = ['软件工程', '计算机科学与技术', '汉语言文学', '视觉传达', '新闻传播', '工商管理', '数学与应用数学', '电子信息工程', '英语', '社会工作', '体育教育', '法学'];
const GRADES = ['大一', '大二', '大三', '研一'];

/* 多个社团岗位都会要求的通用技能，用来制造跨社团投递的部分命中 */
const COMMON_SKILLS = ['沟通协调', '团队协作', '活动组织', '时间管理', '执行力'];

/* ---------- 1. 社团 ---------- */
const CLUBS = [
  { name: '计算机协会', category: '科技类', scale: 260, scale_label: '大型', focus: 'technical',
    desc: '面向全校的技术社团，长期做前端、后端与算法方向的培训与项目实践。',
    criteria: '对编程有兴趣，愿意每周投入 4 小时以上参与项目或培训。' },
  { name: '话剧社', category: '文艺类', scale: 90, scale_label: '中型', focus: 'artistic',
    desc: '每学期产出一部完整话剧，涵盖表演、编剧与舞台执行。',
    criteria: '普通话清晰，能配合晚间排练，对表演或幕后工作有兴趣。' },
  { name: '青年志愿者协会', category: '公益类', scale: 340, scale_label: '大型', focus: 'service',
    desc: '组织校内外志愿服务与公益项目，覆盖支教、社区服务与大型活动保障。',
    criteria: '有责任心，每学期可参与不少于 3 次志愿活动。' },
  { name: '摄影协会', category: '文艺类', scale: 140, scale_label: '中型', focus: 'artistic',
    desc: '记录校园活动，定期组织外拍与后期教学。',
    criteria: '自有或愿意借用设备，能参与每月一次的外拍。' },
  { name: '篮球社', category: '体育类', scale: 110, scale_label: '中型', focus: 'sports',
    desc: '组织校内联赛与日常训练，分设男队、女队与经理组。',
    criteria: '身体健康，能参加每周两次训练。' },
  { name: '辩论队', category: '学术类', scale: 70, scale_label: '小型', focus: 'academic',
    desc: '代表学校参加校际辩论赛事，日常进行逻辑与表达训练。',
    criteria: '表达清晰，愿意接受每周两次的集中训练。' },
];

const clubRows = CLUBS.map((c) => {
  const d = daysAgo(int(200, 320), 10);
  return {
    id: genId('club'),
    name: c.name, scale: c.scale, scale_label: c.scale_label,
    description: c.desc, category: c.category, logo_path: null,
    contact_name: '社团负责人', contact_phone: '1380000' + String(int(1000, 9999)),
    contact_email: `club${int(100, 999)}@stu.edu.cn`, is_visible: 1,
    created_at: iso(d), updated_at: iso(d),
    entry_criteria: c.criteria,
    apply_start_at: iso(daysAgo(20, 0)), apply_end_at: iso(daysAgo(-10, 23)),
  };
});

const insClub = db.prepare(
  `INSERT INTO club (id, name, scale, scale_label, description, category, logo_path,
     contact_name, contact_phone, contact_email, is_visible, created_at, updated_at,
     entry_criteria, apply_start_at, apply_end_at)
   VALUES (@id, @name, @scale, @scale_label, @description, @category, @logo_path,
     @contact_name, @contact_phone, @contact_email, @is_visible, @created_at, @updated_at,
     @entry_criteria, @apply_start_at, @apply_end_at)`
);
db.transaction(() => clubRows.forEach((r) => insClub.run(r)))();

/* ---------- 2. 招新批次 ---------- */
const insRec = db.prepare(
  `INSERT INTO recruitment (id, club_id, title, status, start_at, end_at, remark, created_at, updated_at)
   VALUES (@id, @club_id, @title, @status, @start_at, @end_at, @remark, @created_at, @updated_at)`
);

const recRows = [];
clubRows.forEach((club, i) => {
  const spec = CLUBS[i];
  const open = { id: genId('rec'), club_id: club.id, title: '2026 秋季招新', status: 'open',
    start_at: iso(daysAgo(20, 0)), end_at: iso(daysAgo(-12, 23)), remark: null,
    created_at: iso(daysAgo(22, 9)), updated_at: NOW };
  const closed = { id: genId('rec'), club_id: club.id, title: '2026 春季招新', status: 'closed',
    start_at: iso(daysAgo(210, 0)), end_at: iso(daysAgo(160, 23)), remark: '已完成',
    created_at: iso(daysAgo(212, 9)), updated_at: iso(daysAgo(155, 9)) };
  recRows.push({ ...open, focus: spec.focus, clubName: club.name, idx: i });
  recRows.push({ ...closed, focus: spec.focus, clubName: club.name, idx: i });
});
db.transaction(() => recRows.forEach(({ focus, clubName, idx, ...r }) => insRec.run(r)))();

/* ---------- 3. 招新岗位 ---------- */
const POSITIONS_BY_CLUB = {
  计算机协会: [
    { title: '前端开发干事', n: 5, skills: 'HTML,CSS,JavaScript,Vue', req: '负责社团项目的页面开发与维护，能读懂设计稿并实现交互。' },
    { title: '后端开发干事', n: 3, skills: 'Node.js,MySQL,Python,接口设计', req: '负责接口开发与数据库设计，能写清晰的技术文档。' },
    { title: '算法与数据组干事', n: 2, skills: 'Python,数据分析,机器学习,数学建模', req: '参与数据类小项目，完成数据清洗与可视化。' },
  ],
  话剧社: [
    { title: '演员', n: 6, skills: '话剧表演,朗诵,普通话', req: '参加每周两次的排练，能接受演出期的密集安排。' },
    { title: '编剧', n: 2, skills: '文案写作,剧本创作,文学素养', req: '负责原创或改编剧本，能配合导演修改。' },
    { title: '舞台与道具', n: 2, skills: '舞台执行,活动组织,动手能力', req: '负责布景、道具与灯光衔接。' },
  ],
  青年志愿者协会: [
    { title: '项目干事', n: 8, skills: '活动组织,沟通协调,志愿服务', req: '负责一次完整的志愿项目从策划到执行。' },
    { title: '宣传干事', n: 3, skills: '文案写作,新媒体运营,海报设计', req: '负责活动招募文案与推文排版。' },
  ],
  摄影协会: [
    { title: '摄影干事', n: 6, skills: '摄影,构图,活动跟拍', req: '承担社团活动的跟拍任务。' },
    { title: '后期与修图', n: 2, skills: '视频剪辑,Photoshop,配色', req: '负责照片后期与短片剪辑。' },
  ],
  篮球社: [
    { title: '篮球队队员', n: 12, skills: '篮球,体能训练,团队协作', req: '参加每周两次训练与校内联赛。' },
    { title: '球队经理', n: 2, skills: '活动组织,沟通协调,时间管理', req: '负责赛程协调、装备与后勤。' },
  ],
  辩论队: [
    { title: '辩手', n: 6, skills: '辩论,逻辑分析,演讲', req: '参加每周两次集中训练与校际赛事。' },
    { title: '资料与教练助理', n: 2, skills: '论文写作,资料检索,逻辑分析', req: '负责赛题资料整理与论点储备。' },
  ],
};

const insPos = db.prepare(
  `INSERT INTO position (id, recruitment_id, title, requirement, headcount, filled_count,
     sort_order, created_at, updated_at, required_skills)
   VALUES (@id, @recruitment_id, @title, @requirement, @headcount, 0, @sort_order, @created_at, @updated_at, @required_skills)`
);

const posRows = [];
recRows.forEach((rec) => {
  const list = POSITIONS_BY_CLUB[rec.clubName] || [];
  list.forEach((p, i) => {
    posRows.push({
      id: genId('pos'), recruitment_id: rec.id, title: p.title, requirement: p.req,
      headcount: p.n, sort_order: i, created_at: rec.created_at, updated_at: rec.updated_at,
      required_skills: p.skills,
      recruitmentTitle: rec.title, recruitmentStatus: rec.status,
      clubId: clubRows[rec.idx].id, clubName: rec.clubName, focus: rec.focus,
    });
  });
});

/* 多数岗位都要求基本的沟通与协作，这也让跨社团投递有机会部分命中 */
for (const p of posRows) {
  const set = String(p.required_skills || '').split(/[,，、;；]/).map((x) => x.trim()).filter(Boolean);
  if (rnd() < 0.78 && !set.includes('沟通协调')) set.push('沟通协调');
  if (rnd() < 0.42 && !set.includes('团队协作')) set.push('团队协作');
  if (rnd() < 0.22 && !set.includes('时间管理')) set.push('时间管理');
  p.required_skills = set.join(',');
}

db.transaction(() => posRows.forEach(({ recruitmentTitle, recruitmentStatus, clubId, clubName, focus, ...r }) => insPos.run(r)))();

/* 后续生成简历与投递只针对招新中的岗位 */
const openPositions = posRows.filter((p) => p.recruitmentStatus === 'open');

/* ---------- 4. 简历 ---------- */
const insResume = db.prepare(
  `INSERT INTO resume (id, student_name, phone, email, school, major, grade, content,
     attachment_path, created_at, updated_at, skills, skills_auto)
   VALUES (@id, @student_name, @phone, @email, @school, @major, @grade, @content,
     NULL, @created_at, @updated_at, @skills, NULL)`
);

const TYPES = ['technical', 'organizing', 'artistic', 'sports', 'academic', 'service', 'other'];

/*
 * 简历技能按「主投社团的岗位技能池」生成。
 *
 * 如果技能随机取自通用词表，会和岗位要求几乎不重叠，导致技能命中率大面积为 0，
 * 演示时看不出匹配差异。做法是：先给每份简历一个主投社团，
 * 技能从该社团所有岗位的 required_skills 里抽，这样主投岗位命中率高、
 * 跨社团投递命中率低，形成真实的分数梯度。
 */
const clubFocus = {};
const clubSkillPool = {};
clubRows.forEach((c, i) => {
  clubFocus[c.id] = CLUBS[i].focus;
  clubSkillPool[c.id] = new Set();
});
for (const p of posRows) {
  const set = clubSkillPool[p.clubId];
  String(p.required_skills || '').split(/[,，、;；]/).map((x) => x.trim()).filter(Boolean)
    .forEach((s) => set.add(s));
}

const RESUME_COUNT = 72;
const resumeRows = [];
const usedNames = new Set();
for (let i = 0; i < RESUME_COUNT; i += 1) {
  let name = pick(SURNAMES) + pick(GIVEN);
  let guard = 0;
  while (usedNames.has(name) && guard < 50) {
    name = pick(SURNAMES) + pick(GIVEN);
    guard += 1;
  }
  usedNames.add(name);

  const primaryClub = clubRows[int(0, clubRows.length - 1)];
  const focus = clubFocus[primaryClub.id];
  const pool = Array.from(clubSkillPool[primaryClub.id]);

  /*
   * 技能构成：
   *   ① 主投岗位要求里的 2~3 项（保证主投投递命中率高）
   *   ② 1~2 项通用技能（多个社团都要求，让跨社团投递也可能部分命中）
   *   ③ 偶尔补 1 项本社团技能池里的其它项
   * 目的是让分数形成梯度，而不是大面积 0 分。
   */
  const primaryPos = pick(openPositions.filter((p) => p.clubId === primaryClub.id));
  const posSkills = String(primaryPos.required_skills || '')
    .split(/[,，、;；]/).map((x) => x.trim()).filter(Boolean);
  const skills = pickN(posSkills, int(2, Math.min(3, posSkills.length)));
  skills.push(...pickN(COMMON_SKILLS, int(1, 2)));
  if (rnd() < 0.45) {
    const rest = pool.filter((s) => !skills.includes(s));
    if (rest.length) skills.push(pick(rest));
  }
  const allSkills = Array.from(new Set(skills));
  const content = pickN(CONTENT_BY_TYPE[focus] || CONTENT_BY_TYPE.other, 2).join('');
  const d = daysAgo(int(0, 95));

  resumeRows.push({
    id: genId('res'), student_name: name,
    phone: rnd() < 0.75 ? '137' + String(int(10000000, 99999999)) : null,
    email: rnd() < 0.7 ? `stu${int(1000, 9999)}@stu.edu.cn` : null,
    school: pick(SCHOOLS), major: pick(MAJORS), grade: pick(GRADES),
    content, created_at: iso(d), updated_at: iso(d),
    skills: allSkills.join(','),
    type: focus,
    primaryClubId: primaryClub.id,
    primaryPositionId: primaryPos.id,
  });
}
db.transaction(() =>
  resumeRows.forEach(({ type, primaryClubId, primaryPositionId, ...r }) => insResume.run(r))
)();

/* ---------- 5. 投递 ---------- */
const insApp = db.prepare(
  `INSERT INTO application (id, position_id, resume_id, type_tag, status, score, note,
     reviewed_at, created_at, updated_at, was_admitted, decision, waitlist_rank,
     adjust_position_id, decided_at, decided_by)
   VALUES (@id, @position_id, @resume_id, @type_tag, @status, @score, @note,
     @reviewed_at, @created_at, @updated_at, @was_admitted, @decision, @waitlist_rank,
     NULL, @decided_at, NULL)`
);

/* 状态权重：模拟真实招新中的分布 */
const STATUS_PLAN = [
  ['new', 26], ['screening', 20], ['interviewing', 18],
  ['admitted', 12], ['rejected', 12], ['archived', 6],
];

function weightedStatus() {
  const total = STATUS_PLAN.reduce((s, x) => s + x[1], 0);
  let r = rnd() * total;
  for (const [st, w] of STATUS_PLAN) {
    r -= w;
    if (r <= 0) return st;
  }
  return 'new';
}

const usedPairs = new Set();
const appRows = [];
const waitlistCounter = {}; // position_id -> next rank
const admittedByPos = {};   // position_id -> 已录人数（用于限制不超过 headcount）

for (const res of resumeRows) {
  /*
   * 投递构成：1 个主投社团的岗位 + 1~2 个其他社团的岗位。
   * 主投岗位的技能与简历高度重叠（分数高），跨社团投递重叠少（分数低），
   * 这样工作台上既有高分也有低分，能看出匹配度差异。
   */
  const seenClubs = new Set();
  const picked = [];
  const primaryPos2 = openPositions.find((p) => p.id === res.primaryPositionId);
  if (primaryPos2) {
    seenClubs.add(primaryPos2.clubId);
    picked.push(primaryPos2);
  }
  const otherPositions = openPositions.filter((p) => p.clubId !== res.primaryClubId);
  for (const p of pickN(otherPositions, int(1, 2))) {
    if (seenClubs.has(p.clubId)) continue;
    seenClubs.add(p.clubId);
    picked.push(p);
  }

  for (const pos of picked) {
    const key = pos.id + '|' + res.id;
    if (usedPairs.has(key)) continue;
    usedPairs.add(key);

    let status = weightedStatus();
    const created = daysAgo(int(0, 90), int(8, 23));
    const updated = new Date(created.getTime() + int(60, 60 * 24 * 10) * 1000);

    let was = 0;
    let decision = '';
    let rank = null;
    let decidedAt = null;

    /* 录取不能超过计划人数：名额满了就转为候补 */
    const tryAdmit = () => {
      const cap = pos.headcount || 1;
      if ((admittedByPos[pos.id] || 0) < cap) {
        admittedByPos[pos.id] = (admittedByPos[pos.id] || 0) + 1;
        was = 1;
        decision = 'hired';
        return true;
      }
      return false;
    };
    const toWaitlist = () => {
      decision = 'waitlist';
      waitlistCounter[pos.id] = (waitlistCounter[pos.id] || 0) + 1;
      rank = waitlistCounter[pos.id];
    };

    if (status === 'admitted') {
      if (tryAdmit()) {
        decidedAt = iso(updated);
      } else {
        status = 'interviewing';
        toWaitlist();
        decidedAt = iso(updated);
      }
    } else if (status === 'rejected') {
      decision = 'reject';
      decidedAt = iso(updated);
    } else if (status === 'archived') {
      // 归档里一部分是历史录取，一部分是历史淘汰
      if (rnd() < 0.55 && tryAdmit()) {
        decidedAt = iso(updated);
      } else {
        decision = 'reject';
        decidedAt = iso(updated);
      }
    } else if (status === 'interviewing') {
      if (rnd() < 0.35) {
        toWaitlist();
        decidedAt = iso(updated);
      }
    }

    appRows.push({
      id: genId('app'), position_id: pos.id, resume_id: res.id,
      type_tag: res.type, status,
      score: rnd() < 0.55 ? int(58, 96) : null,
      note: rnd() < 0.3 ? pick(['沟通清晰，表达有条理。', '有相关项目经历。', '时间安排与社团活动冲突。', '潜力不错，建议再观察。']) : null,
      reviewed_at: ['new', 'screening'].includes(status) ? null : iso(updated),
      created_at: iso(created), updated_at: iso(updated),
      was_admitted: was, decision, waitlist_rank: rank,
      decided_at: decidedAt,
    });
  }
}

db.transaction(() => appRows.forEach((r) => insApp.run(r)))();

/* ---------- 6. 重算岗位已录数 ---------- */
db.prepare(
  `UPDATE position SET filled_count = (
     SELECT COUNT(*) FROM application a WHERE a.position_id = position.id AND a.was_admitted = 1
   )`
).run();

/* ---------- 统计 ---------- */
const q = (sql) => db.prepare(sql).get();
const tally = (sql) => db.prepare(sql).all();

const stat = {
  club: q('SELECT COUNT(*) c FROM club').c,
  recruitment: q('SELECT COUNT(*) c FROM recruitment').c,
  position: q('SELECT COUNT(*) c FROM position').c,
  resume: q('SELECT COUNT(*) c FROM resume').c,
  application: q('SELECT COUNT(*) c FROM application').c,
  admitted: q('SELECT COUNT(*) c FROM application WHERE was_admitted = 1').c,
  waitlist: q('SELECT COUNT(*) c FROM application WHERE decision = \'waitlist\'').c,
};

console.log('════════ 演示数据集已生成 ════════');
console.log(`  数据库：${DEMO}`);
console.log('');
console.log(`  社团      ${stat.club}`);
console.log(`  招新批次  ${stat.recruitment}`);
console.log(`  岗位      ${stat.position}`);
console.log(`  简历      ${stat.resume}`);
console.log(`  投递      ${stat.application}`);
console.log(`  其中已录  ${stat.admitted}　候补 ${stat.waitlist}`);
console.log('');
console.log('  投递状态分布：');
for (const r of tally('SELECT status, COUNT(*) c FROM application GROUP BY status ORDER BY c DESC')) {
  console.log(`    ${r.status.padEnd(13)} ${r.c}`);
}
console.log('');
console.log('  各社团候选人数（≥6 才会产生聚类分组）：');
for (const r of tally(
  `SELECT c.name, COUNT(a.id) c FROM club c
   LEFT JOIN recruitment r ON r.club_id = c.id
   LEFT JOIN position p ON p.recruitment_id = r.id
   LEFT JOIN application a ON a.position_id = p.id
   GROUP BY c.id ORDER BY c DESC`
)) {
  console.log(`    ${r.name.padEnd(16)} ${r.c}`);
}
console.log('');
console.log('  近 90 天投递落在的最早/最新日期：');
const span = q('SELECT MIN(substr(created_at,1,10)) a, MAX(substr(created_at,1,10)) b FROM application');
console.log(`    ${span.a} ~ ${span.b}`);
console.log('');
console.log('下一步（PowerShell）：');
console.log(`  $env:DB_PATH='${DEMO}'`);
console.log('  node scripts/export-dashboard.mjs');
console.log('  node scripts/export-console-snapshot.mjs');

db.close();
