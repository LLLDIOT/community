/**
 * 语义匹配服务 —— 用预训练嵌入替换"字符串求交"
 *
 * 这是本次 ML 重写的核心。原来的算法是：
 *     score = 命中技能数 / 岗位期望技能数        （字符串完全相同才算命中）
 * 现在改为：
 *     score = 混合(语义余弦相似度, 标签命中率)   （语义部分由 BGE 中文模型计算）
 *
 * ── 为什么必须做「校准」──
 * bge-zh 这类模型对**任何**两段中文短文本都会给出 0.4~0.5 的余弦（语言模型自带的高基线），
 * 直接乘 100 会让"完全无关"也显示 48% —— 界面上所有匹配度都挤在 50-75 之间，失去区分度。
 *
 * 实测分布（见 scripts/probe-embedding.mjs）：
 *     无关  「精通Vue」 vs 「会打篮球」       0.5020
 *     无关  「喜欢摄影」 vs 「会打篮球」      0.4691
 *     相关  「精通Vue」 vs 「熟悉Vue3」      0.7479
 *     相关  「活动策划」 vs 「组织线下活动」   0.6124
 *
 * 因此做线性重标定：把 [CALIB_MIN, CALIB_MAX] 映射到 [0, 100] 并截断。
 * 默认 0.48 → 0.82，可用环境变量调整（换模型时必须重新标定）。
 */
import {
  ML_ENABLED,
  isReady,
  embedOwners,
  cosine,
} from './embeddingService.js';
import { parseSkills } from './skillTags.js';
import { db } from '../db/connection.js';

/* ---------- 可调参数（换模型后需要重新标定）---------- */
/*
 * 标定依据（scripts/verify-ml.mjs 实测，bge-small-zh-v1.5）：
 *   强相关   「精通Vue」        ~「熟悉Vue3框架」        0.7479
 *   强相关   「孙小美简历」     ~「宣传部干事」          0.7166
 *   较相关   「王小明简历」     ~「前端开发干事」        0.6908
 *   弱相关   「王小明简历」     ~「活动策划干事」        0.6209
 *   基线     「钱多多简历」     ~「宣传部干事」          0.4848（近乎无关）
 *
 * 所以把 [0.46, 0.75] 映射到 [0, 100]：
 *   0.4848 → 8      0.6209 → 55     0.6908 → 79
 *   0.7166 → 88     0.7479 → 99
 * 相比最初设的 [0.48, 0.82]，上限 0.82 根本达不到，导致所有分被压到 70 以下、
 * 区分度丧失——这是必须实测才能发现的问题。
 */
const CALIB_MIN = Number(process.env.ML_CALIB_MIN || 0.46);
const CALIB_MAX = Number(process.env.ML_CALIB_MAX || 0.75);
/** 有技能标签时，语义分与标签分的融合权重 */
const W_SEMANTIC = Number(process.env.ML_W_SEMANTIC || 0.6);
const W_TAG = Number(process.env.ML_W_TAG || 0.4);

/** 余弦 → 0~100 的校准分 */
export function calibrate(cos) {
  const span = CALIB_MAX - CALIB_MIN;
  if (span <= 0) return 0;
  const v = (cos - CALIB_MIN) / span;
  return Math.round(Math.max(0, Math.min(1, v)) * 100);
}

/* ---------- 文本组装：决定"喂给模型什么" ---------- */
/*
 * 这一步很关键，比选模型更影响效果。
 * 只喂技能标签会丢掉正文里的信息；只喂正文会丢掉结构化的技能。
 * 所以把两者拼起来，并给字段加中文提示词，让模型知道每段的语义角色。
 */
export function buildResumeText(resume) {
  if (!resume) return '';
  const parts = [];
  if (resume.student_name) parts.push(`姓名：${resume.student_name}`);
  if (resume.school) parts.push(`学校：${resume.school}`);
  if (resume.major) parts.push(`专业：${resume.major}`);
  if (resume.grade) parts.push(`年级：${resume.grade}`);
  if (resume.skills) parts.push(`技能标签：${resume.skills}`);
  if (resume.content) parts.push(`简历正文：${String(resume.content).slice(0, 1200)}`);
  return parts.join('\n');
}

export function buildPositionText(position) {
  if (!position) return '';
  const parts = [];
  if (position.title) parts.push(`岗位名称：${position.title}`);
  if (position.required_skills) parts.push(`期望技能：${position.required_skills}`);
  if (position.requirement) parts.push(`岗位要求：${String(position.requirement).slice(0, 1200)}`);
  return parts.join('\n');
}

/* ---------- 纯函数：给定向量与标签，算出匹配结果 ---------- */
/**
 * @param {number[]} resumeVec
 * @param {number[]} posVec
 * @param {string} resumeSkillsRaw
 * @param {string} requiredRaw
 */
export function scorePair(resumeVec, posVec, resumeSkillsRaw, requiredRaw) {
  const resumeSkills = parseSkills(resumeSkillsRaw);
  const requiredSkills = parseSkills(requiredRaw);
  const resumeSet = new Set(resumeSkills);

  const hitSkills = requiredSkills.filter((s) => resumeSet.has(s));
  const missingSkills = requiredSkills.filter((s) => !resumeSet.has(s));
  const tagScore = requiredSkills.length > 0 ? hitSkills.length / requiredSkills.length : 0;

  const cos = resumeVec && posVec ? cosine(resumeVec, posVec) : 0;
  const semantic = calibrate(cos);

  // 岗位没写期望技能时，语义分独立承担（否则标签分会把总分压到 0）
  const score =
    requiredSkills.length > 0
      ? Math.round(semantic * W_SEMANTIC + tagScore * 100 * W_TAG)
      : semantic;

  return {
    score: Math.max(0, Math.min(100, score)),
    semantics: {
      cosine: Number(cos.toFixed(4)),
      calibrated: semantic,
      weight: W_SEMANTIC,
    },
    tags: {
      score: Math.round(tagScore * 100),
      weight: requiredSkills.length > 0 ? W_TAG : 0,
    },
    hitSkills,
    missingSkills,
    resumeSkills,
    requiredSkills,
    method: 'semantic+tags',
  };
}

/** 规则版（降级用）：纯标签命中，与 ML 之前行为一致 */
function scorePairRuleOnly(resumeSkillsRaw, requiredRaw) {
  const resumeSkills = parseSkills(resumeSkillsRaw);
  const requiredSkills = parseSkills(requiredRaw);
  if (requiredSkills.length === 0) {
    return {
      score: 0, semantics: null, tags: { score: 0, weight: 0 },
      hitSkills: [], missingSkills: [], resumeSkills, requiredSkills, method: 'tags-only',
    };
  }
  const rs = new Set(resumeSkills);
  const hit = requiredSkills.filter((s) => rs.has(s));
  const miss = requiredSkills.filter((s) => !rs.has(s));
  return {
    score: Math.round((hit.length / requiredSkills.length) * 100),
    semantics: null,
    tags: { score: Math.round((hit.length / requiredSkills.length) * 100), weight: 1 },
    hitSkills: hit, missingSkills: miss, resumeSkills, requiredSkills, method: 'tags-only',
  };
}

/* ---------- 带向量的一批数据 ---------- */
function loadPositions(clubId = '') {
  const where = clubId ? 'WHERE rec.club_id = @clubId' : '';
  return db
    .prepare(
      `SELECT pos.id, pos.title, pos.requirement, pos.required_skills,
              pos.headcount, pos.filled_count, pos.recruitment_id,
              rec.title AS recruitment_title, rec.status, rec.club_id,
              club.name AS club_name
       FROM position pos
       JOIN recruitment rec ON rec.id = pos.recruitment_id
       JOIN club ON club.id = rec.club_id
       ${where}
       ORDER BY rec.status = 'open' DESC, rec.created_at DESC`
    )
    .all(clubId ? { clubId } : {});
}

/**
 * 简历 → 推荐岗位（语义版，签名与原 recommendPositionsForResume 对齐）
 */
export async function recommendPositionsForResume(
  resumeId,
  { clubId = '', limit = 10, minScore = 0 } = {}
) {
  const resume = db.prepare('SELECT * FROM resume WHERE id = ?').get(resumeId);
  if (!resume) throw new Error('简历不存在');

  const rows = loadPositions(clubId);
  if (rows.length === 0) {
    return {
      resume: { id: resume.id, student_name: resume.student_name, skills: resume.skills || '' },
      recommendations: [], total: 0, method: 'none',
    };
  }

  // ML 不可用 → 回退规则
  if (!ML_ENABLED || !isReady()) {
    const recommendations = rows
      .map((r) => ({
        positionId: r.id, positionTitle: r.title, recruitmentId: r.recruitment_id,
        recruitmentTitle: r.recruitment_title, clubId: r.club_id, clubName: r.club_name,
        headcount: r.headcount, filledCount: r.filled_count, status: r.status,
        ...scorePairRuleOnly(resume.skills, r.required_skills),
      }))
      .filter((x) => x.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return {
      resume: { id: resume.id, student_name: resume.student_name, skills: resume.skills || '' },
      recommendations, total: rows.length, method: 'tags-only',
    };
  }

  // 一次性编码：简历 + 所有岗位（走缓存，只有新文本才真跑模型）
  const items = [
    { ownerType: 'resume', ownerId: resume.id, text: buildResumeText(resume), role: 'resume' },
    ...rows.map((r) => ({
      ownerType: 'position', ownerId: r.id, text: buildPositionText(r), role: 'position',
    })),
  ];
  const withVec = await embedOwners(items);
  const resumeVec = withVec.find((x) => x.role === 'resume').vector;
  const vecByPos = new Map(withVec.filter((x) => x.role === 'position').map((x) => [x.ownerId, x.vector]));

  const scored = rows.map((r) => ({
    positionId: r.id,
    positionTitle: r.title,
    recruitmentId: r.recruitment_id,
    recruitmentTitle: r.recruitment_title,
    clubId: r.club_id,
    clubName: r.club_name,
    headcount: r.headcount,
    filledCount: r.filled_count,
    status: r.status,
    ...scorePair(resumeVec, vecByPos.get(r.id), resume.skills, r.required_skills),
  }));

  const recommendations = scored
    .filter((x) => x.score >= minScore)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.status === 'open') - (a.status === 'open') ||
        a.filledCount / Math.max(1, a.headcount) - b.filledCount / Math.max(1, b.headcount)
    )
    .slice(0, limit);

  return {
    resume: { id: resume.id, student_name: resume.student_name, skills: resume.skills || '' },
    recommendations,
    total: scored.length,
    method: 'semantic+tags',
  };
}

/**
 * 社团侧：发现"投错岗"的人（语义版）
 * 返回形状与原 matchClubApplicants 兼容，额外带 semantics 明细。
 */
export async function matchClubApplicants(clubId, { limit = 50, minScore = 50 } = {}) {
  const apps = db
    .prepare(
      `SELECT app.id AS application_id, app.resume_id, res.student_name, res.skills,
              res.content, res.major, res.grade, res.school,
              fromPos.title AS from_position, app.status
       FROM application app
       JOIN resume res ON res.id = app.resume_id
       JOIN position fromPos ON fromPos.id = app.position_id
       JOIN recruitment rec ON rec.id = fromPos.recruitment_id
       WHERE rec.club_id = @clubId AND app.status NOT IN ('admitted', 'archived')`
    )
    .all({ clubId });

  const openPositions = db
    .prepare(
      `SELECT pos.id, pos.title, pos.requirement, pos.required_skills,
              pos.headcount, pos.filled_count, pos.recruitment_id,
              rec.title AS recruitment_title, rec.club_id, club.name AS club_name, rec.status
       FROM position pos
       JOIN recruitment rec ON rec.id = pos.recruitment_id
       JOIN club ON club.id = rec.club_id
       WHERE rec.club_id = @clubId AND rec.status = 'open'`
    )
    .all({ clubId });

  const existingPairs = new Set(
    db
      .prepare(
        `SELECT a.position_id || '|' || a.resume_id AS k
         FROM application a
         JOIN position p ON p.id = a.position_id
         JOIN recruitment r ON r.id = p.recruitment_id
         WHERE r.club_id = @clubId`
      )
      .all({ clubId })
      .map((x) => x.k)
  );

  if (!ML_ENABLED || !isReady() || openPositions.length === 0) {
    // 规则降级
    const out = [];
    for (const app of apps) {
      for (const pos of openPositions) {
        if (existingPairs.has(`${pos.id}|${app.resume_id}`)) continue;
        const m = scorePairRuleOnly(app.skills, pos.required_skills);
        if (m.score >= minScore) {
          out.push({
            applicationId: app.application_id, resumeId: app.resume_id,
            studentName: app.student_name, currentPosition: app.from_position,
            appStatus: app.status,
            suggested: {
              positionId: pos.id, positionTitle: pos.title,
              recruitmentId: pos.recruitment_id, recruitmentTitle: pos.recruitment_title,
              clubId: pos.club_id, clubName: pos.club_name,
              headcount: pos.headcount, filledCount: pos.filled_count, status: pos.status,
              ...m,
            },
          });
        }
      }
    }
    out.sort((a, b) => b.suggested.score - a.suggested.score);
    return out.slice(0, limit);
  }

  // 预热：把本轮涉及的简历与岗位一次性编码（缓存命中率很高）
  const items = [
    ...apps.map((a) => ({ ownerType: 'resume', ownerId: a.resume_id, text: buildResumeText(a), role: 'resume' })),
    ...openPositions.map((p) => ({ ownerType: 'position', ownerId: p.id, text: buildPositionText(p), role: 'position' })),
  ];
  const withVec = await embedOwners(items);
  const resumeVecBy = new Map(withVec.filter((x) => x.role === 'resume').map((x) => [x.ownerId, x.vector]));
  const posVecBy = new Map(withVec.filter((x) => x.role === 'position').map((x) => [x.ownerId, x.vector]));

  const out = [];
  for (const app of apps) {
    const rv = resumeVecBy.get(app.resume_id);
    for (const pos of openPositions) {
      if (existingPairs.has(`${pos.id}|${app.resume_id}`)) continue;
      const m = scorePair(rv, posVecBy.get(pos.id), app.skills, pos.required_skills);
      if (m.score < minScore) continue;
      out.push({
        applicationId: app.application_id,
        resumeId: app.resume_id,
        studentName: app.student_name,
        currentPosition: app.from_position,
        appStatus: app.status,
        suggested: {
          positionId: pos.id, positionTitle: pos.title,
          recruitmentId: pos.recruitment_id, recruitmentTitle: pos.recruitment_title,
          clubId: pos.club_id, clubName: pos.club_name,
          headcount: pos.headcount, filledCount: pos.filled_count, status: pos.status,
          ...m,
        },
      });
    }
  }
  out.sort((a, b) => b.suggested.score - a.suggested.score);
  return out.slice(0, limit);
}
