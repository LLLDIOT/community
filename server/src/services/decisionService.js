/**
 * 面试决策 —— 录用 / 调剂 / 候补序号 / 递补招满
 *
 * 需求原文：
 *   「通过一些筛选方式来决定他是否是录用或者是调剂」
 *   「在最终面试的时候，对这些真正录用的人进行标注。然后还有一些候补的人，
 *     可以标一些一号或者二号之类的。来达到招满员的目的」
 *
 * 模型上把「流程状态 status」与「面试结论 decision」拆成两层，互不覆盖：
 *   status   ：走到哪一步（new→screening→interviewing→admitted/rejected→archived）
 *   decision ：面试结论（hired 录用 / waitlist 候补 / adjust 调剂 / reject 淘汰）
 *
 * 为什么拆开？因为"录取"是流程终点，而"候补 2 号"是一种不改变流程、
 * 但决定录用顺序的结论。把候补强塞进 status 会让状态机与 filled_count 语义崩坏。
 *
 * 招满员的实现：岗位 filled_count 仍由 applicationService 统一重算（只有 was_admitted=1 计入），
 * 递补 = 把候补队列中序号最小的人提升为 hired（即 status→admitted）。
 */
import { db } from '../db/connection.js';
import { nowIso } from '../utils/id.js';
import { notFound, badRequest, forbidden } from '../utils/errors.js';
import * as applicationService from './applicationService.js';
import { matchSkills, recommendPositionsForResume } from './matchService.js';

/** 面试结论枚举（'' = 未定） */
export const DECISIONS = ['hired', 'waitlist', 'adjust', 'reject'];

export const DECISION_LABELS = {
  '': '未决定',
  hired: '录用',
  waitlist: '候补',
  adjust: '调剂',
  reject: '淘汰',
};

/** 决策 → 徽章颜色（前端直接用，避免两处维护） */
export const DECISION_COLORS = {
  '': 'info',
  hired: 'success',
  waitlist: 'warning',
  adjust: 'primary',
  reject: 'danger',
};

/* ------------------------------------------------------------------ */
/* 内部工具                                                            */
/* ------------------------------------------------------------------ */

/** 取投递 + 其所属社团，供权限校验使用 */
function loadApplicationClub(appId) {
  const row = db
    .prepare(
      `SELECT a.*, p.recruitment_id, p.title AS position_title,
              r.club_id, r.title AS recruitment_title, c.name AS club_name
       FROM application a
       JOIN position p ON p.id = a.position_id
       JOIN recruitment r ON r.id = p.recruitment_id
       JOIN club c ON c.id = r.club_id
       WHERE a.id = ?`
    )
    .get(appId);
  if (!row) throw notFound('投递记录不存在');
  return row;
}

/** 只有本社团的人能对这个投递做决策 */
function assertClubScope(row, account) {
  if (!account) throw forbidden('请先登录社团账号');
  if (row.club_id !== account.clubId) {
    throw forbidden('只能处理自己社团收到的投递');
  }
}

function nextWaitlistRank(positionId) {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(waitlist_rank), 0) AS m FROM application
       WHERE position_id = ? AND decision = 'waitlist'`
    )
    .get(positionId);
  return (row?.m || 0) + 1;
}

function positionOf(positionId) {
  const p = db
    .prepare(
      `SELECT p.*, r.club_id, r.title AS recruitment_title, r.status AS recruitment_status
       FROM position p JOIN recruitment r ON r.id = p.recruitment_id WHERE p.id = ?`
    )
    .get(positionId);
  if (!p) throw notFound('招新岗位不存在');
  return p;
}

/* ------------------------------------------------------------------ */
/* ① 标注决策（核心）                                                   */
/* ------------------------------------------------------------------ */

/**
 * 给一条投递标注面试结论。
 * body: { decision, waitlistRank?, adjustPositionId?, note?, score? }
 *
 * 各结论的副作用：
 *   hired   → 状态机推进到 admitted（会置 was_admitted=1 并重算岗位 filled_count）
 *   waitlist→ 分配候补序号（同岗位内唯一，默认取队尾），流程状态保持不变
 *   adjust  → 记录调剂去向岗位（必须同社团、且不是当前岗位）
 *   reject  → 状态机推进到 rejected
 *   ''      → 撤销结论（已录取者会退回面试中，并重算 filled_count）
 */
export function setDecision(applicationId, body = {}, account) {
  const row = loadApplicationClub(applicationId);
  assertClubScope(row, account);

  const decision = body.decision === undefined ? '' : String(body.decision);
  if (decision && !DECISIONS.includes(decision)) {
    throw badRequest(`非法的面试结论，允许：${['', ...DECISIONS].join(' / ')}`);
  }

  const now = nowIso();
  let waitlistRank = null;
  let adjustPositionId = null;

  if (decision === 'waitlist') {
    waitlistRank = body.waitlistRank === undefined || body.waitlistRank === null || body.waitlistRank === ''
      ? nextWaitlistRank(row.position_id)
      : parseInt(body.waitlistRank, 10);
    if (Number.isNaN(waitlistRank) || waitlistRank < 1) {
      throw badRequest('候补序号必须是从 1 开始的正整数');
    }
    // 同岗位内序号唯一：占用了别人的号就先报错（避免出现两个"候补 1 号"）
    const clash = db
      .prepare(
        `SELECT id, resume_id FROM application
         WHERE position_id = ? AND decision = 'waitlist' AND waitlist_rank = ? AND id != ?`
      )
      .get(row.position_id, waitlistRank, applicationId);
    if (clash) throw badRequest(`该岗位的候补 ${waitlistRank} 号已被占用，请换一个序号`);
  }

  if (decision === 'adjust') {
    adjustPositionId = body.adjustPositionId || null;
    if (!adjustPositionId) throw badRequest('调剂必须指定目标岗位');
    if (adjustPositionId === row.position_id) throw badRequest('调剂目标不能是当前岗位');
    const target = positionOf(adjustPositionId);
    if (target.club_id !== account.clubId) {
      throw forbidden('只能调剂到本社团的岗位');
    }
  }

  // 先写决策层，再驱动流程状态；两步放进同一事务，避免"决策写了但状态没转过去"的半成品
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE application
          SET decision = @decision,
              waitlist_rank = @waitlistRank,
              adjust_position_id = @adjustPositionId,
              decided_at = @decidedAt,
              decided_by = @decidedBy,
              updated_at = @updatedAt
        WHERE id = @id`
    ).run({
      decision,
      waitlistRank,
      adjustPositionId,
      decidedAt: decision ? now : null,
      decidedBy: decision ? account.id : null,
      updatedAt: now,
      id: applicationId,
    });

    if (decision === 'hired') {
      // 复用既有状态机：new 不能直接录取，非法跳转会被拦下并回滚整笔决策
      applicationService.transitionStatus(applicationId, 'admitted');
    } else if (decision === 'reject') {
      applicationService.transitionStatus(applicationId, 'rejected');
    } else if (!decision && row.status === 'admitted') {
      // 撤销"录用"结论：退回面试中，并让 filled_count 正确回落
      db.prepare(
        `UPDATE application SET status = 'interviewing', was_admitted = 0, updated_at = ? WHERE id = ?`
      ).run(now, applicationId);
      applicationService.refreshPositionFilledCount(row.position_id, now);
    }
  });
  tx();

  if (body.score !== undefined || body.note !== undefined) {
    applicationService.updateApplication(applicationId, {
      ...(body.score !== undefined ? { score: body.score } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
    });
  }

  return getDecisionDetail(applicationId);
}

/** 读一条投递的完整决策视图 */
export function getDecisionDetail(applicationId) {
  const row = db
    .prepare(
      `SELECT a.*, p.title AS position_title, p.headcount, p.filled_count, p.required_skills,
              r.club_id, r.title AS recruitment_title, r.status AS recruitment_status,
              res.student_name, res.grade, res.major, res.school, res.skills,
              adj.title AS adjust_position_title
       FROM application a
       JOIN position p ON p.id = a.position_id
       JOIN recruitment r ON r.id = p.recruitment_id
       JOIN resume res ON res.id = a.resume_id
       LEFT JOIN position adj ON adj.id = a.adjust_position_id
       WHERE a.id = ?`
    )
    .get(applicationId);
  if (!row) throw notFound('投递记录不存在');

  const match = matchSkills(row.skills, row.required_skills);
  return {
    id: row.id,
    positionId: row.position_id,
    positionTitle: row.position_title,
    recruitmentId: row.recruitment_id,
    recruitmentTitle: row.recruitment_title,
    clubId: row.club_id,
    studentName: row.student_name,
    grade: row.grade,
    major: row.major,
    school: row.school,
    skills: row.skills || '',
    score: row.score,
    note: row.note,
    status: row.status,
    decision: row.decision || '',
    decisionLabel: DECISION_LABELS[row.decision || ''],
    waitlistRank: row.waitlist_rank,
    adjustPositionId: row.adjust_position_id,
    adjustPositionTitle: row.adjust_position_title,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    matchScore: match.score,
    hitSkills: match.hitSkills,
    missingSkills: match.missingSkills,
    position: {
      headcount: row.headcount,
      filledCount: row.filled_count,
      requiredSkills: row.required_skills || '',
      remaining: Math.max(0, (row.headcount || 0) - (row.filled_count || 0)),
    },
  };
}

/* ------------------------------------------------------------------ */
/* ② 候补队列与递补                                                    */
/* ------------------------------------------------------------------ */

/** 某岗位的候补队列（按序号升序 = 递补顺序） */
export function listWaitlist(positionId) {
  return db
    .prepare(
      `SELECT a.id, a.waitlist_rank, a.status, a.decision, a.score, a.created_at,
              res.student_name, res.grade, res.major, res.school, res.skills
       FROM application a JOIN resume res ON res.id = a.resume_id
       WHERE a.position_id = ? AND a.decision = 'waitlist'
       ORDER BY a.waitlist_rank ASC`
    )
    .all(positionId)
    .map((r) => ({
      id: r.id,
      waitlistRank: r.waitlist_rank,
      status: r.status,
      score: r.score,
      studentName: r.student_name,
      grade: r.grade,
      major: r.major,
      school: r.school,
      skills: r.skills || '',
    }));
}

/**
 * 递补：把候补队列中最靠前的一位提升为「录用」。
 * 这是"招满员"的收口动作——有人放弃/被淘汰时，按序号依次补上。
 * body: { applicationId? } 指定则提升指定人；不指定则提升队首。
 */
export function promoteWaitlist(positionId, body = {}, account) {
  const pos = positionOf(positionId);
  if (!account) throw forbidden('请先登录社团账号');
  if (pos.club_id !== account.clubId) throw forbidden('只能操作自己社团的岗位');

  const queue = listWaitlist(positionId);
  if (queue.length === 0) throw badRequest('该岗位当前没有候补人员');

  let pick;
  if (body.applicationId) {
    pick = queue.find((q) => q.id === body.applicationId);
    if (!pick) throw badRequest('指定的投递不在该岗位候补队列中');
  } else {
    pick = queue[0];
  }

  const result = setDecision(pick.id, { decision: 'hired' }, account);

  // 递补后把后面的候补序号前移，保持 1 号永远是最优先的
  const rest = listWaitlist(positionId);
  const renumber = db.prepare('UPDATE application SET waitlist_rank = ? WHERE id = ?');
  const tx = db.transaction(() => {
    rest.forEach((r, i) => renumber.run(i + 1, r.id));
  });
  tx();

  return {
    promoted: result,
    remaining: listWaitlist(positionId),
    position: refreshPositionProgress(positionId),
  };
}

/** 岗位招满进度（含候补人数） */
export function refreshPositionProgress(positionId) {
  const p = positionOf(positionId);
  const waitlist = db
    .prepare(`SELECT COUNT(*) AS c FROM application WHERE position_id = ? AND decision = 'waitlist'`)
    .get(positionId).c;
  const hired = db
    .prepare(`SELECT COUNT(*) AS c FROM application WHERE position_id = ? AND decision = 'hired'`)
    .get(positionId).c;
  const need = p.headcount || 0;
  return {
    positionId,
    title: p.title,
    headcount: need,
    filled: p.filled_count || 0,
    hiredDecisionCount: hired,
    waitlistCount: waitlist,
    remaining: Math.max(0, need - (p.filled_count || 0)),
    isFull: (p.filled_count || 0) >= need && need > 0,
    overFilled: (p.filled_count || 0) > need,
  };
}

/* ------------------------------------------------------------------ */
/* ③ 调剂                                                              */
/* ------------------------------------------------------------------ */

/** 调剂建议：复用技能匹配引擎，找本社团内更合适的岗位 */
export function suggestAdjust(applicationId, account) {
  const row = loadApplicationClub(applicationId);
  assertClubScope(row, account);

  const { recommendations } = recommendPositionsForResume(row.resume_id, {
    clubId: account.clubId,
    limit: 20,
  });

  // 排除当前岗位、已投过的岗位、以及已招满的岗位
  const applied = new Set(
    db.prepare('SELECT position_id FROM application WHERE resume_id = ?').all(row.resume_id).map((r) => r.position_id)
  );

  const suggestions = recommendations
    .filter((r) => r.positionId !== row.position_id && !applied.has(r.positionId))
    .map((r) => ({
      positionId: r.positionId,
      positionTitle: r.positionTitle,
      recruitmentTitle: r.recruitmentTitle,
      matchScore: r.score,
      hitSkills: r.hitSkills,
      missingSkills: r.missingSkills,
      headcount: r.headcount,
      filledCount: r.filledCount,
      remaining: Math.max(0, (r.headcount || 0) - (r.filledCount || 0)),
      recruitmentStatus: r.status,
      reason:
        r.score > 0
          ? `命中 ${r.hitSkills.join('、') || '—'}${r.missingSkills.length ? `，缺 ${r.missingSkills.join('、')}` : ''}`
          : '暂无明显技能重合，建议人工判断',
    }))
    .sort((a, b) => b.matchScore - a.matchScore || b.remaining - a.remaining);

  return {
    application: {
      id: row.id,
      studentName: db.prepare('SELECT student_name FROM resume WHERE id = ?').get(row.resume_id)?.student_name,
      currentPositionId: row.position_id,
      currentPositionTitle: row.position_title,
    },
    suggestions,
  };
}

/**
 * 执行调剂：在目标岗位新建一条投递（复用既有去重与状态机），
 * 并把原投递标注为「调剂 → 目标岗位」。
 * body: { adjustPositionId, markOriginal? = true }
 */
export function applyAdjust(applicationId, body = {}, account) {
  const row = loadApplicationClub(applicationId);
  assertClubScope(row, account);

  const targetId = body.adjustPositionId;
  if (!targetId) throw badRequest('请选择调剂的目标岗位');
  if (targetId === row.position_id) throw badRequest('调剂目标不能是当前岗位');

  const target = positionOf(targetId);
  if (target.club_id !== account.clubId) throw forbidden('只能调剂到本社团的岗位');

  // 在目标岗位建立新投递（已投过会由唯一约束拦下并给出友好提示）
  let created = null;
  let alreadyExists = false;
  try {
    created = applicationService.createApplication(targetId, {
      resumeId: row.resume_id,
      typeTag: row.type_tag,
    });
  } catch (e) {
    if (String(e.message).includes('请勿重复投递')) alreadyExists = true;
    else throw e;
  }

  // 原投递标注为调剂（不推进状态机，保留历史）
  setDecision(applicationId, { decision: 'adjust', adjustPositionId: targetId }, account);

  return {
    adjusted: getDecisionDetail(applicationId),
    createdApplication: created,
    alreadyApplied: alreadyExists,
    target: refreshPositionProgress(targetId),
  };
}

/* ------------------------------------------------------------------ */
/* ④ 面试工作台数据                                                    */
/* ------------------------------------------------------------------ */

/**
 * 面试与录用工作台：把某社团（可限定批次/岗位）的候选人按流程状态分列，
 * 带上决策、候补序号、技能匹配度与岗位招满进度，供"标注录用 + 排候补"使用。
 */
export function getInterviewBoard(clubId, { recruitmentId = '', positionId = '', keyword = '', onlyUndecided = false } = {}) {
  db.prepare('SELECT id FROM club WHERE id = ?').get(clubId) ||
    (() => { throw notFound('社团不存在'); })();

  const positions = db
    .prepare(
      `SELECT p.*, r.title AS recruitment_title, r.status AS recruitment_status, r.id AS recruitment_id
       FROM position p JOIN recruitment r ON r.id = p.recruitment_id
       WHERE r.club_id = ? ORDER BY r.created_at DESC, p.sort_order ASC`
    )
    .all(clubId);

  const where = ['r.club_id = @clubId'];
  const params = { clubId };
  if (recruitmentId) { where.push('r.id = @recruitmentId'); params.recruitmentId = recruitmentId; }
  if (positionId) { where.push('a.position_id = @positionId'); params.positionId = positionId; }
  if (keyword) {
    where.push('(res.student_name LIKE @kw OR res.major LIKE @kw OR res.school LIKE @kw)');
    params.kw = `%${keyword}%`;
  }
  if (onlyUndecided) where.push("a.decision = ''");

  const rows = db
    .prepare(
      `SELECT a.id, a.position_id, a.status, a.decision, a.waitlist_rank, a.adjust_position_id,
              a.score, a.note, a.type_tag, a.created_at, a.decided_at,
              p.title AS position_title, p.required_skills, p.headcount, p.filled_count,
              r.title AS recruitment_title, r.id AS recruitment_id,
              res.student_name, res.grade, res.major, res.school, res.skills, res.id AS resume_id,
              adj.title AS adjust_position_title
       FROM application a
       JOIN position p ON p.id = a.position_id
       JOIN recruitment r ON r.id = p.recruitment_id
       JOIN resume res ON res.id = a.resume_id
       LEFT JOIN position adj ON adj.id = a.adjust_position_id
       WHERE ${where.join(' AND ')}
       ORDER BY CASE a.status WHEN 'new' THEN 0 WHEN 'screening' THEN 1
                              WHEN 'interviewing' THEN 2 WHEN 'admitted' THEN 3
                              ELSE 4 END ASC,
                COALESCE(a.score, 0) DESC, a.created_at DESC`
    )
    .all(params);

  const candidates = rows.map((r) => {
    const m = matchSkills(r.skills, r.required_skills);
    return {
      id: r.id,
      positionId: r.position_id,
      positionTitle: r.position_title,
      recruitmentId: r.recruitment_id,
      recruitmentTitle: r.recruitment_title,
      studentName: r.student_name,
      grade: r.grade,
      major: r.major,
      school: r.school,
      skills: r.skills || '',
      typeTag: r.type_tag,
      score: r.score,
      note: r.note,
      status: r.status,
      decision: r.decision || '',
      decisionLabel: DECISION_LABELS[r.decision || ''],
      waitlistRank: r.waitlist_rank,
      adjustPositionId: r.adjust_position_id,
      adjustPositionTitle: r.adjust_position_title,
      decidedAt: r.decided_at,
      createdAt: r.created_at,
      matchScore: m.score,
      hitSkills: m.hitSkills,
      missingSkills: m.missingSkills,
    };
  });

  // 按流程状态分列（看板式）
  const columns = {
    new: candidates.filter((c) => c.status === 'new'),
    screening: candidates.filter((c) => c.status === 'screening'),
    interviewing: candidates.filter((c) => c.status === 'interviewing'),
    admitted: candidates.filter((c) => c.status === 'admitted'),
    rejected: candidates.filter((c) => c.status === 'rejected' || c.status === 'archived'),
  };

  const progress = positions
    .filter((p) => (recruitmentId ? p.recruitment_id === recruitmentId : true))
    .filter((p) => (positionId ? p.id === positionId : true))
    .map((p) => refreshPositionProgress(p.id))
    .map((p) => {
      const meta = positions.find((x) => x.id === p.positionId);
      return { ...p, recruitmentId: meta?.recruitment_id, recruitmentTitle: meta?.recruitment_title };
    });

  const summary = {
    total: candidates.length,
    hired: candidates.filter((c) => c.decision === 'hired').length,
    waitlist: candidates.filter((c) => c.decision === 'waitlist').length,
    adjust: candidates.filter((c) => c.decision === 'adjust').length,
    rejected: candidates.filter((c) => c.decision === 'reject').length,
    undecided: candidates.filter((c) => !c.decision).length,
    needTotal: progress.reduce((s, p) => s + p.headcount, 0),
    filledTotal: progress.reduce((s, p) => s + p.filled, 0),
    waitlistTotal: progress.reduce((s, p) => s + p.waitlistCount, 0),
  };
  summary.remainingTotal = Math.max(0, summary.needTotal - summary.filledTotal);
  summary.fillRate = summary.needTotal > 0 ? Math.round((summary.filledTotal / summary.needTotal) * 100) : 0;

  return {
    candidates,
    columns,
    progress,
    summary,
    positions: positions.map((p) => ({
      id: p.id,
      title: p.title,
      recruitmentId: p.recruitment_id,
      recruitmentTitle: p.recruitment_title,
      recruitmentStatus: p.recruitment_status,
      headcount: p.headcount,
      filledCount: p.filled_count,
    })),
  };
}

/** 字典：结论枚举与颜色（经 /dict 下发给前端） */
export const decisionMeta = {
  decisions: DECISIONS,
  labels: DECISION_LABELS,
  colors: DECISION_COLORS,
};
