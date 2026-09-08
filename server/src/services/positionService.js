import { db } from '../db/connection.js';
import { genId, nowIso } from '../utils/id.js';
import { notFound, badRequest } from '../utils/errors.js';

function pickPositionFields(body) {
  const fields = {};
  for (const k of ['title', 'requirement', 'headcount', 'sortOrder', 'requiredSkills']) {
    if (body[k] !== undefined) fields[k] = body[k];
  }
  return fields;
}

function getPositionById(id) {
  const pos = db.prepare('SELECT * FROM position WHERE id = ?').get(id);
  if (!pos) throw notFound('招新岗位不存在');
  return pos;
}

export function listPositions(recruitmentId) {
  db.prepare('SELECT id FROM recruitment WHERE id = ?').get(recruitmentId) ||
    (() => { throw notFound('招新批次不存在'); })();
  return db
    .prepare('SELECT * FROM position WHERE recruitment_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(recruitmentId);
}

export function createPosition(recruitmentId, body) {
  db.prepare('SELECT id FROM recruitment WHERE id = ?').get(recruitmentId) ||
    (() => { throw notFound('招新批次不存在'); })();

  if (!body.title || !String(body.title).trim()) throw badRequest('岗位名称不能为空');
  const fields = pickPositionFields(body);
  const headcount = parseInt(fields.headcount, 10);
  if (Number.isNaN(headcount) || headcount < 0) throw badRequest('招新人数必须为非负整数');

  const now = nowIso();
  const id = genId('pos');

  db.prepare(
    `INSERT INTO position (id, recruitment_id, title, requirement, headcount, filled_count, sort_order, required_skills, created_at, updated_at)
     VALUES (@id, @recruitmentId, @title, @requirement, @headcount, 0, @sortOrder, @requiredSkills, @createdAt, @updatedAt)`
  ).run({
    id,
    recruitmentId,
    title: fields.title.trim(),
    requirement: fields.requirement ?? '',
    headcount,
    sortOrder: fields.sortOrder ?? 0,
    requiredSkills: fields.requiredSkills ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return getPositionById(id);
}

export function updatePosition(id, body) {
  const pos = getPositionById(id);
  const fields = pickPositionFields(body);

  if (fields.title !== undefined) {
    if (!String(fields.title).trim()) throw badRequest('岗位名称不能为空');
    fields.title = fields.title.trim();
  }
  if (fields.headcount !== undefined) {
    const hc = parseInt(fields.headcount, 10);
    if (Number.isNaN(hc) || hc < 0) throw badRequest('招新人数必须为非负整数');
    if (hc < pos.filled_count) {
      throw badRequest(`招新人数不能小于已录取人数（${pos.filled_count}）`);
    }
    fields.headcount = hc;
  }

  if (Object.keys(fields).length === 0) return getPositionById(id);

  const sets = Object.keys(fields).map((k) => {
    const col = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    return `${col} = @${k}`;
  });
  db.prepare(`UPDATE position SET ${sets.join(', ')}, updated_at = @updatedAt WHERE id = @id`)
    .run({ ...fields, updatedAt: nowIso(), id });

  return getPositionById(id);
}

export function deletePosition(id) {
  const pos = getPositionById(id);
  const appCount = db
    .prepare('SELECT COUNT(*) AS c FROM application WHERE position_id = ?')
    .get(id).c;
  if (appCount > 0) {
    throw badRequest(`该岗位已收到 ${appCount} 份投递，请先处理（删除）这些投递后再删除岗位`);
  }
  db.prepare('DELETE FROM position WHERE id = ?').run(id);
  return { id, deleted: true };
}
