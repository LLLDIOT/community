import { db } from '../db/connection.js';
import { genId, nowIso } from '../utils/id.js';
import { notFound, badRequest } from '../utils/errors.js';

/** 简历类型标签（结构化分类，对应 docs/DATA_MODEL.md 数据字典） */
export const TYPE_TAGS = [
  'technical', 'organizing', 'artistic', 'sports', 'academic', 'service', 'other',
];

/** 状态机：状态 → 允许跳转的下一状态集合 */
export const STATUS_TRANSITIONS = {
  new: ['screening', 'rejected', 'archived'],
  screening: ['interviewing', 'rejected', 'admitted', 'archived'],
  interviewing: ['admitted', 'rejected', 'archived'],
  admitted: ['archived'],      // 录取后仅可归档
  rejected: ['archived'],      // 淘汰后可归档进人才池复盘
  archived: [],                // 已归档 = 终态（如需复活，先取消归档）
};

const READABLE = {
  new: '新收到',
  screening: '待筛选',
  interviewing: '面试中',
  admitted: '已录取',
  rejected: '已淘汰',
  archived: '已归档',
};

function getApplicationById(id, { withJoins = false } = {}) {
  if (withJoins) {
    const row = db
      .prepare(
        `SELECT app.*, pos.title AS position_title, pos.recruitment_id,
                rec.title AS recruitment_title, rec.club_id,
                club.name AS club_name,
                res.student_name, res.phone, res.email, res.school, res.major,
                res.grade, res.content, res.attachment_path
         FROM application app
         JOIN position pos ON pos.id = app.position_id
         JOIN recruitment rec ON rec.id = pos.recruitment_id
         JOIN club ON club.id = rec.club_id
         JOIN resume res ON res.id = app.resume_id
         WHERE app.id = ?`
      )
      .get(id);
    if (!row) throw notFound('投递记录不存在');
    return row;
  }
  const app = db.prepare('SELECT * FROM application WHERE id = ?').get(id);
  if (!app) throw notFound('投递记录不存在');
  return app;
}

function assertValidTypeTag(typeTag) {
  if (typeTag !== undefined && !TYPE_TAGS.includes(typeTag)) {
    throw badRequest(`非法的简历类型，允许：${TYPE_TAGS.join(' / ')}`);
  }
}

/** 校验状态跳转合法性，返回新状态（含同状态幂等） */
function assertTransition(from, to) {
  if (to === from) return;
  const allowed = STATUS_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw badRequest(
      `非法的状态流转：${READABLE[from] || from} 不能直接变为 ${READABLE[to] || to}；允许的下一状态：${allowed.join(' / ')}`
    );
  }
}

/** 投递：把一份简历投到某个岗位 */
export function createApplication(positionId, body) {
  const position = db.prepare('SELECT * FROM position WHERE id = ?').get(positionId);
  if (!position) throw notFound('招新岗位不存在');

  const { resumeId, typeTag = 'other' } = body || {};
  if (!resumeId) throw badRequest('缺少 resumeId');
  db.prepare('SELECT id FROM resume WHERE id = ?').get(resumeId) ||
    (() => { throw notFound('简历不存在'); })();
  assertValidTypeTag(typeTag);

  const now = nowIso();
  const id = genId('app');
  try {
    db.prepare(
      `INSERT INTO application (id, position_id, resume_id, type_tag, status, created_at, updated_at)
       VALUES (@id, @positionId, @resumeId, @typeTag, 'new', @createdAt, @updatedAt)`
    ).run({ id, positionId, resumeId, typeTag, createdAt: now, updatedAt: now });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      throw badRequest('该简历已投递过此岗位，请勿重复投递');
    }
    throw e;
  }
  return getApplicationById(id, { withJoins: true });
}

/** 某岗位收到的投递列表（= 按需求归档视图） */
export function listApplicationsByPosition(positionId, { page = 1, pageSize = 50 } = {}) {
  db.prepare('SELECT id FROM position WHERE id = ?').get(positionId) ||
    (() => { throw notFound('招新岗位不存在'); })();

  const total = db
    .prepare('SELECT COUNT(*) AS c FROM application WHERE position_id = ?')
    .get(positionId).c;
  const list = db
    .prepare(
      `SELECT app.*, res.student_name, res.school, res.major, res.grade, res.attachment_path
       FROM application app JOIN resume res ON res.id = app.resume_id
       WHERE app.position_id = ?
       ORDER BY app.created_at DESC LIMIT @pageSize OFFSET @offset`
    )
    .all(positionId, { pageSize, offset: (page - 1) * pageSize });

  return { list, total, page, pageSize };
}

/**
 * 社团简历库（= 按类型/状态筛选的归档总视图）
 * filters: typeTag / status / grade / keyword / positionId / recruitmentId
 * 返回含 statusCounts：忽略 status 过滤的全体状态分布（用于前端统计条）
 */
export function listClubApplications(
  clubId,
  { typeTag = '', status = '', grade = '', keyword = '', positionId = '', recruitmentId = '', page = 1, pageSize = 20 } = {}
) {
  db.prepare('SELECT id FROM club WHERE id = ?').get(clubId) ||
    (() => { throw notFound('社团不存在'); })();

  const baseParams = { clubId };
  const where = ['rec.club_id = @clubId'];
  const params = { clubId };

  if (typeTag) { where.push('app.type_tag = @typeTag'); params.typeTag = typeTag; }
  if (status) { where.push('app.status = @status'); params.status = status; }
  if (grade) { where.push('res.grade = @grade'); params.grade = grade; }
  if (positionId) { where.push('app.position_id = @positionId'); params.positionId = positionId; }
  if (recruitmentId) { where.push('pos.recruitment_id = @recruitmentId'); params.recruitmentId = recruitmentId; }
  if (keyword) {
    where.push('(res.student_name LIKE @kw OR res.major LIKE @kw OR res.school LIKE @kw)');
    params.kw = `%${keyword}%`;
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM application app
       JOIN position pos ON pos.id = app.position_id
       JOIN recruitment rec ON rec.id = pos.recruitment_id
       JOIN resume res ON res.id = app.resume_id
       ${whereSql}`
    )
    .get(params).c;

  const list = db
    .prepare(
      `SELECT app.id, app.position_id, app.type_tag, app.status, app.score, app.note,
              app.created_at, app.updated_at,
              pos.title AS position_title,
              rec.id AS recruitment_id, rec.title AS recruitment_title,
              res.student_name, res.school, res.major, res.grade, res.attachment_path
       FROM application app
       JOIN position pos ON pos.id = app.position_id
       JOIN recruitment rec ON rec.id = pos.recruitment_id
       JOIN resume res ON res.id = app.resume_id
       ${whereSql}
       ORDER BY
         CASE app.status WHEN 'new' THEN 0 WHEN 'screening' THEN 1
                         WHEN 'interviewing' THEN 2 WHEN 'admitted' THEN 3
                         WHEN 'rejected' THEN 4 ELSE 5 END ASC,
         app.created_at DESC
       LIMIT @pageSize OFFSET @offset`
    )
    .all({ ...params, pageSize, offset: (page - 1) * pageSize });

  // 状态分布：忽略 status 过滤（其余筛选保持一致）
  const countParams = { ...baseParams };
  const countWhere = ['rec.club_id = @clubId'];
  if (typeTag) { countWhere.push('app.type_tag = @typeTag'); countParams.typeTag = typeTag; }
  if (grade) { countWhere.push('res.grade = @grade'); countParams.grade = grade; }
  if (positionId) { countWhere.push('app.position_id = @positionId'); countParams.positionId = positionId; }
  if (recruitmentId) { countWhere.push('pos.recruitment_id = @recruitmentId'); countParams.recruitmentId = recruitmentId; }
  if (keyword) {
    countWhere.push('(res.student_name LIKE @kw OR res.major LIKE @kw OR res.school LIKE @kw)');
    countParams.kw = `%${keyword}%`;
  }
  const statusCounts = db
    .prepare(
      `SELECT app.status, COUNT(*) AS c FROM application app
       JOIN position pos ON pos.id = app.position_id
       JOIN recruitment rec ON rec.id = pos.recruitment_id
       JOIN resume res ON res.id = app.resume_id
       WHERE ${countWhere.join(' AND ')}
       GROUP BY app.status`
    )
    .all(countParams);

  return {
    list, total, page, pageSize,
    statusCounts: Object.fromEntries(statusCounts.map((r) => [r.status, r.c])),
  };
}

/** 状态流转 */
export function transitionStatus(id, status) {
  const app = getApplicationById(id);
  if (!status || !(status in READABLE)) {
    throw badRequest(`非法的状态值，允许：${Object.keys(READABLE).join(' / ')}`);
  }
  assertTransition(app.status, status);

  const now = nowIso();
  // 一旦进入 admitted 即打标 was_admitted（终身有效，即使随后归档）
  const wasAdmitted = app.was_admitted === 1 || status === 'admitted' ? 1 : 0;

  db.prepare(
    `UPDATE application SET status = @status, was_admitted = @wasAdmitted,
                            reviewed_at = @reviewedAt, updated_at = @updatedAt
     WHERE id = @id`
  ).run({ status, wasAdmitted, reviewedAt: now, updatedAt: now, id });

  refreshPositionFilledCount(app.position_id, now);
  return getApplicationById(id);
}

/** 归档 / 取消归档 */
export function setArchived(id, archived) {
  const app = getApplicationById(id);
  const now = nowIso();

  if (archived && app.status !== 'archived') {
    // 归档是终态操作，不查状态机，但已被录取/已归档外的记录均可归档
    db.prepare(
      `UPDATE application SET status = 'archived', updated_at = @updatedAt, reviewed_at = @reviewedAt
       WHERE id = @id`
    ).run({ updatedAt: now, reviewedAt: now, id });
    refreshPositionFilledCount(app.position_id, now);
    return getApplicationById(id);
  }

  if (!archived && app.status === 'archived') {
    // 取消归档：回到 rejected（淘汰进人才池后复盘/复活场景）
    db.prepare(
      `UPDATE application SET status = 'rejected', updated_at = @updatedAt WHERE id = @id`
    ).run({ updatedAt: now, id });
    return getApplicationById(id);
  }

  return getApplicationById(id);
}

/** 重算岗位 filled_count：累计录取人数 = was_admitted=1 的投递数 */
function refreshPositionFilledCount(positionId, updatedAt = nowIso()) {
  db.prepare(
    `UPDATE position SET filled_count = (SELECT COUNT(*) FROM application
      WHERE position_id = @positionId AND was_admitted = 1),
      updated_at = @updatedAt WHERE id = @positionId`
  ).run({ positionId, updatedAt });
}

/** 更新评分 / 备注 / 类型标签 */
export function updateApplication(id, body) {
  const app = getApplicationById(id);
  const fields = {};
  if (body.score !== undefined) {
    const score = parseInt(body.score, 10);
    if (Number.isNaN(score) || score < 1 || score > 5) throw badRequest('评分必须为 1-5 的整数');
    fields.score = score;
  }
  if (body.note !== undefined) fields.note = body.note;
  if (body.typeTag !== undefined) {
    assertValidTypeTag(body.typeTag);
    fields.typeTag = body.typeTag;
  }
  if (Object.keys(fields).length === 0) return getApplicationById(id);

  const sets = Object.keys(fields).map((k) => {
    const col = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    return `${col} = @${k}`;
  });
  db.prepare(`UPDATE application SET ${sets.join(', ')}, updated_at = @updatedAt WHERE id = @id`)
    .run({ ...fields, updatedAt: nowIso(), id });

  return getApplicationById(id);
}

/** 删除投递（真删；同时刷新岗位 filled_count 计数） */
export function deleteApplication(id) {
  const app = getApplicationById(id);
  db.prepare('DELETE FROM application WHERE id = ?').run(id);
  refreshPositionFilledCount(app.position_id);
  return { id, deleted: true };
}

export function getApplicationDetail(id) {
  return getApplicationById(id, { withJoins: true });
}

/** CSV 转义：逗号/引号/换行加引号包裹 */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** 导出社团全部投递为 CSV（含筛选条件一致的处理逻辑：keyword/typeTag/status/grade） */
export function exportClubApplicationsCsv(clubId, query = {}) {
  const { list } = listClubApplications(clubId, {
    typeTag: query.typeTag || '',
    status: query.status || '',
    grade: query.grade || '',
    keyword: query.keyword || '',
    positionId: query.positionId || '',
    recruitmentId: query.recruitmentId || '',
    page: 1,
    pageSize: 10000,
  });

  const headers = [
    '姓名', '类型', '状态', '评分', '岗位', '招新批次',
    '学校', '专业', '年级', '投递时间', '备注',
  ];
  const STATUS_LABELS = {
    new: '新收到', screening: '待筛选', interviewing: '面试中',
    admitted: '已录取', rejected: '已淘汰', archived: '已归档',
  };
  const TYPE_LABELS = {
    technical: '技术型', organizing: '组织策划型', artistic: '文艺特长型',
    sports: '体育型', academic: '学术竞赛型', service: '志愿服务型', other: '其他',
  };

  const rows = list.map((a) => [
    a.student_name, TYPE_LABELS[a.type_tag] || a.type_tag,
    STATUS_LABELS[a.status] || a.status, a.score ?? '',
    a.position_title, a.recruitment_title,
    a.school ?? '', a.major ?? '', a.grade ?? '', a.created_at, a.note ?? '',
  ]);

  const csv = [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const filename = `applications_${clubId}_${new Date().toISOString().slice(0, 10)}.csv`;
  return { csv, filename };
}

export const applicationStatusLabels = READABLE;
