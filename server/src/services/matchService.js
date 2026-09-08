import { db } from '../db/connection.js';
import { notFound } from '../utils/errors.js';

/**
 * 技能标签解析与归一化
 * 输入："Vue, Node.js ，沟通" → ["vue", "node.js", "沟通"]
 * - 支持中英文逗号/顿号分隔
 * - 忽略空项；小写化便于英文标签精确匹配
 * - 保留内部空格（如 "Node.js"），仅去除首尾空格
 */
export function parseSkills(raw) {
  if (!raw) return [];
  const tokens = String(raw).split(/[,，、;；]/);
  return [...new Set(tokens.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/**
 * 计算一份简历技能与岗位期望技能的匹配度。
 * @param {string|string[]} resumeSkillsRaw 简历技能（原始字符串或已解析数组）
 * @param {string|string[]} requiredRaw 岗位期望技能
 * @returns {{score: number, hitSkills: string[], missingSkills: string[], resumeSkills: string[], requiredSkills: string[]}}
 *
 * score = 命中数 / 期望数（期望为空时返回 0 且缺技能为空，避免除零）
 * score 取整百分比 0-100。
 */
export function matchSkills(resumeSkillsRaw, requiredRaw) {
  const resumeSkills = Array.isArray(resumeSkillsRaw)
    ? resumeSkillsRaw
    : parseSkills(resumeSkillsRaw);
  const requiredSkills = Array.isArray(requiredRaw)
    ? requiredRaw
    : parseSkills(requiredRaw);

  if (requiredSkills.length === 0) {
    return { score: 0, hitSkills: [], missingSkills: [], resumeSkills, requiredSkills };
  }

  const resumeSet = new Set(resumeSkills);
  const hitSkills = requiredSkills.filter((s) => resumeSet.has(s));
  const missingSkills = requiredSkills.filter((s) => !resumeSet.has(s));
  const score = Math.round((hitSkills.length / requiredSkills.length) * 100);

  return { score, hitSkills, missingSkills, resumeSkills, requiredSkills };
}

/** 简历详情中的匹配对象形状 */
function positionMatchRow(pos, resumeSkillsParsed) {
  const m = matchSkills(resumeSkillsParsed, pos.required_skills);
  return {
    positionId: pos.id,
    positionTitle: pos.title,
    recruitmentId: pos.recruitment_id,
    recruitmentTitle: pos.recruitment_title,
    clubId: pos.club_id,
    clubName: pos.club_name,
    headcount: pos.headcount,
    filledCount: pos.filled_count,
    status: pos.status, // recruitment 状态
    ...m,
  };
}

/**
 * 为一份简历推荐最匹配的招新岗位（全平台，或限定社团）。
 * @param {string} resumeId
 * @param {object} [opts]
 * @param {string} [opts.clubId]      限定某个社团（"自动匹配社团"场景：跨社团匹配推荐则传空）
 * @param {number} [opts.limit=10]
 * @param {number} [opts.minScore=0]   只返回高于该分数的岗位
 * @returns {{resume: object, recommendations: Array}}
 */
export function recommendPositionsForResume(resumeId, { clubId = '', limit = 10, minScore = 0 } = {}) {
  const resume = db.prepare('SELECT id, student_name, skills, grade, major FROM resume WHERE id = ?').get(resumeId);
  if (!resume) throw notFound('简历不存在');
  const resumeSkills = parseSkills(resume.skills);

  // 招新进行中(open)的岗位 + 还有名额(录取数 < 需求数) 优先；也把 closed/draft 留作展示可选
  const where = ['1=1'];
  const params = {};
  if (clubId) {
    where.push('rec.club_id = @clubId');
    params.clubId = clubId;
  }

  const rows = db
    .prepare(
      `SELECT pos.id, pos.title, pos.recruitment_id, pos.required_skills,
              pos.headcount, pos.filled_count,
              rec.title AS recruitment_title, rec.status, rec.club_id,
              club.name AS club_name
       FROM position pos
       JOIN recruitment rec ON rec.id = pos.recruitment_id
       JOIN club ON club.id = rec.club_id
       WHERE ${where.join(' AND ')}
       ORDER BY rec.status = 'open' DESC, rec.created_at DESC`
    )
    .all(params);

  const scored = rows
    .map((r) => positionMatchRow(r, resumeSkills))
    .filter((r) => r.score >= minScore)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.status === 'open') - (a.status === 'open') ||
        a.filledCount / Math.max(1, a.headcount) - b.filledCount / Math.max(1, b.headcount)
    );

  return {
    resume: { id: resume.id, student_name: resume.student_name, skills: resume.skills || '', grade: resume.grade, major: resume.major },
    recommendations: scored.slice(0, limit),
    total: scored.length,
  };
}

/**
 * 社团"自动匹配"视图：把某社团收到的简历与它的 open 岗位做全量匹配，
 * 用于看板/归档时发现"投错岗/漏推岗"的高分组合。
 * @param {string} clubId
 * @returns {Array<{applicationId, studentName, fromPosition, toPosition:{...}, match}>}
 */
export function matchClubApplicants(clubId, { limit = 50 } = {}) {
  const rows = db
    .prepare(
      `SELECT app.id AS application_id, app.resume_id, res.student_name, res.skills,
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
      `SELECT pos.id, pos.title, pos.required_skills, pos.headcount, pos.filled_count,
              pos.recruitment_id, rec.title AS recruitment_title, rec.club_id,
              club.name AS club_name, rec.status
       FROM position pos
       JOIN recruitment rec ON rec.id = pos.recruitment_id
       JOIN club ON club.id = rec.club_id
       WHERE rec.club_id = @clubId AND rec.status = 'open'`
    )
    .all({ clubId });

  const out = [];
  // 批量取出本社团内已存在的 (position_id, resume_id) 组合，避免循环内查询
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

  for (const app of rows) {
    const resumeSkills = parseSkills(app.skills);
    for (const pos of openPositions) {
      if (existingPairs.has(`${pos.id}|${app.resume_id}`)) continue;
      const m = positionMatchRow({ ...pos, recruitment_title: pos.recruitment_title }, resumeSkills);
      if (m.score >= 50) {
        out.push({
          applicationId: app.application_id,
          resumeId: app.resume_id,
          studentName: app.student_name,
          currentPosition: app.from_position,
          appStatus: app.status,
          suggested: m,
        });
      }
    }
  }
  out.sort((a, b) => b.suggested.score - a.suggested.score);
  return out.slice(0, limit);
}
