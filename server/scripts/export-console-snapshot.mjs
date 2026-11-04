/**
 * 导出国会端静态快照 —— 把数据库内容渲染成一个自包含的 HTML 文件
 *
 * 用法：node scripts/export-console-snapshot.mjs [输出路径]
 *
 * 用途：把社团端的界面与真实数据打包成单个 .html，双击即可查看，
 *       不需要启动服务、不需要网络、不依赖任何外部资源。
 *
 * 注意：这是**只读快照**。页面上的点击只能展开查看，不能提交或修改数据。
 *       匹配分数与聚类结果在导出时由 ML 层真实计算，不是编造的示例值。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db } from '../src/db/connection.js';
import * as emb from '../src/ml/embeddingService.js';
import * as sem from '../src/ml/semanticMatchService.js';
import * as clustering from '../src/ml/clustering.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const TEMPLATE = path.join(ROOT, 'tools/console-snapshot.template.html');
const OUT = process.argv[2] || path.join(ROOT, 'docs/club-console-snapshot.html');

const p2 = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp =
  `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ` +
  `${p2(now.getHours())}:${p2(now.getMinutes())}`;

/* ── 1. 读取数据库 ── */
const clubs = db.prepare('SELECT * FROM club ORDER BY created_at').all();
const recruitments = db.prepare('SELECT * FROM recruitment ORDER BY created_at').all();
const positions = db.prepare('SELECT * FROM position ORDER BY created_at').all();
const resumes = db.prepare('SELECT * FROM resume ORDER BY created_at').all();

const applications = db
  .prepare(
    `SELECT app.id, app.position_id, app.resume_id, app.type_tag, app.status, app.score, app.note,
            app.was_admitted, app.decision, app.waitlist_rank, app.decided_at,
            res.student_name, res.phone, res.email, res.school, res.major, res.grade,
            res.content, res.skills, res.skills_auto,
            pos.title AS position_title, pos.required_skills,
            rec.title AS recruitment_title, rec.club_id,
            club.name AS club_name
     FROM application app
     JOIN resume res ON res.id = app.resume_id
     JOIN position pos ON pos.id = app.position_id
     JOIN recruitment rec ON rec.id = pos.recruitment_id
     JOIN club ON club.id = rec.club_id
     ORDER BY app.created_at`
  )
  .all();

console.log(`读到 ${clubs.length} 社团 / ${positions.length} 岗位 / ${resumes.length} 简历 / ${applications.length} 投递`);

/* ── 2. 加载模型，计算真实匹配分数 ── */
console.log('加载嵌入模型…');
const mlOk = await emb.loadModel();
if (!mlOk) {
  console.warn('模型不可用，匹配将使用规则算法');
}

/*
 * 匹配计算分两件事：
 *   scoreIndex —— 全量「简历×岗位」语义分数，供投递详情查用（不写入 HTML）
 *   match      —— 每份简历只保留前 MATCH_TOP 条，供「智能匹配推荐」页渲染
 * 若把全量都写进 HTML，72 份简历 × 28 个岗位会让文件涨到 700KB 以上。
 */
const MATCH_TOP = 10;
const scoreIndex = new Map();
const match = [];

for (const r of resumes) {
  try {
    const out = await sem.recommendPositionsForResume(r.id, { limit: 500 });
    for (const x of out.recommendations) {
      scoreIndex.set(`${r.id}|${x.positionId}`, x);
    }
    match.push({
      student_name: r.student_name,
      skills: r.skills || '',
      method: out.method,
      total: out.total,
      recommendations: out.recommendations.slice(0, MATCH_TOP).map((x) => ({
        positionTitle: x.positionTitle,
        clubName: x.clubName,
        recruitmentTitle: x.recruitmentTitle,
        status: x.status,
        score: x.score,
        semantics: x.semantics || null,
        tags: x.tags || null,
        hitSkills: x.hitSkills || [],
        missingSkills: x.missingSkills || [],
      })),
    });
  } catch (e) {
    console.warn(`计算 ${r.student_name} 的匹配失败：${e.message}`);
  }
}

/* ── 3. 计算聚类结果 ── */
const clusters = [];
for (const c of clubs) {
  try {
    const out = await clustering.clusterCandidates(c.id, {});
    clusters.push({
      clubName: c.name,
      available: out.available,
      reason: out.reason || '',
      k: out.k || 0,
      silhouette: out.silhouette ?? 0,
      clusters: (out.clusters || []).map((cl) => ({
        index: cl.index,
        size: cl.size,
        profile: cl.profile,
        members: cl.members.map((m) => ({
          studentName: m.studentName,
          positionTitle: m.positionTitle,
          decision: m.decision,
        })),
      })),
    });
  } catch (e) {
    clusters.push({ clubName: c.name, available: false, reason: e.message, k: 0, silhouette: 0, clusters: [] });
  }
}

/* ── 4. 组装数据 ── */
const st = emb.getStatus();
const DATA = {
  generatedAt: stamp,
  demo: /demo/i.test(process.env.DB_PATH || ''),
  ml: {
    model: st.model,
    dim: st.dim,
    matchMode: st.enabled && st.ready ? 'semantic' : 'rules',
    calibration: {
      min: Number(process.env.ML_CALIB_MIN || 0.46),
      max: Number(process.env.ML_CALIB_MAX || 0.75),
    },
    weights: {
      semantic: Number(process.env.ML_W_SEMANTIC || 0.6),
      tag: Number(process.env.ML_W_TAG || 0.4),
    },
  },
  clubs: clubs.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category || '',
    scale: c.scale || '',
    scale_label: c.scale_label || '',
  })),
  recruitments: recruitments.map((r) => ({ id: r.id, club_id: r.club_id, title: r.title, status: r.status })),
  positions: positions.map((p) => ({ id: p.id, recruitment_id: p.recruitment_id, title: p.title })),
  resumes: resumes.map((r) => ({
    id: r.id, student_name: r.student_name, school: r.school, major: r.major, grade: r.grade,
    skills: r.skills || '', skills_auto: r.skills_auto || '',
  })),
  applications: applications.map((a) => {
    /*
     * 注意两个分数不是一回事：
     *   application.score（面试评分）是面试官打的分，可空。
     *   工作台显示的匹配度在真实后端里由 matchSkills() 计算，即技能命中率，
     *   所以这里保持一致，用「命中技能数 / 期望技能数」，不用面试评分。
     */
    const requiredSkills = String(a.required_skills || '')
      .split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean);
    /*
     * 命中技能直接用「这份简历填写的技能」与「投递岗位的期望技能」比对，
     * 与后端 matchSkills() 的口径一致。
     * 不要从推荐列表里反查：推荐有数量上限，岗位多了会落空，被静默算成 0。
     */
    const resumeSkillSet = new Set(
      String(a.skills || '').split(/[,，、;；]/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    );
    const hitSkills = requiredSkills.filter((s) => resumeSkillSet.has(s.toLowerCase()));
    const missSkills = requiredSkills.filter((s) => !resumeSkillSet.has(s.toLowerCase()));
    const matchScore = requiredSkills.length
      ? Math.round((hitSkills.length / requiredSkills.length) * 100)
      : 0;

    return {
      id: a.id,
      student_name: a.student_name,
      phone: a.phone || '',
      email: a.email || '',
      school: a.school || '',
      major: a.major || '',
      grade: a.grade || '',
      content: a.content || '',
      skills: a.skills || '',
      skills_auto: a.skills_auto || '',
      club_name: a.club_name,
      recruitment_title: a.recruitment_title,
      position_title: a.position_title,
      status: a.status,
      decision: a.decision || '',
      waitlist_rank: a.waitlist_rank || 0,
      matchScore,
      requiredSkills,
      hitSkills,
      interviewScore: a.score != null ? a.score : null,
      semanticScore: (scoreIndex.get(a.resume_id + '|' + a.position_id) || {}).score ?? null,
    };
  }),
  match,
  clusters,
};

/* ── 5. 注入模板 ── */
let html = fs.readFileSync(TEMPLATE, 'utf8');
const json = JSON.stringify(DATA, null, 0).replace(/<\//g, '<\\/');
if (!html.includes('/*__DATA__*/')) {
  throw new Error('模板中缺少 /*__DATA__*/ 占位符');
}
html = html.replace('/*__DATA__*/ null', json);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');

const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`\n已生成：${path.relative(ROOT, OUT)}（${kb} KB）`);
console.log(`  社团 ${DATA.clubs.length} · 岗位 ${DATA.positions.length} · 简历 ${DATA.resumes.length} · 投递 ${DATA.applications.length}`);
console.log(`  匹配 ${DATA.match.length} 份 · 聚类 ${DATA.clusters.length} 个社团`);
console.log(`  模式：${DATA.ml.matchMode}`);
