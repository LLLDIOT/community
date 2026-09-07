import { db } from '../db/connection.js';
import { genId, nowIso } from '../utils/id.js';
import { notFound, badRequest, forbidden } from '../utils/errors.js';
import { getClubById } from './clubService.js';

const REC_STATUSES = ['draft', 'open', 'closed'];

function pickRecruitmentFields(body) {
  const fields = {};
  for (const k of ['title', 'startAt', 'endAt', 'remark']) {
    if (body[k] !== undefined) fields[k] = body[k];
  }
  return fields;
}

function getRecruitmentById(id) {
  const rec = db.prepare('SELECT * FROM recruitment WHERE id = ?').get(id);
  if (!rec) throw notFound('招新批次不存在');
  return rec;
}

/** 校验操作者对本社团有权限（M5 前所有操作视为本人社团） */
function assertClubAccess(clubId) {
  getClubById(clubId);
  // TODO(M5): 校验 req.user.role === 'super_admin' 或本社团 club_admin
}

export function listRecruitments(clubId, { status = '' } = {}) {
  getClubById(clubId);
  const rows = status
    ? db
        .prepare('SELECT * FROM recruitment WHERE club_id = ? AND status = ? ORDER BY created_at DESC')
        .all(clubId, status)
    : db
        .prepare('SELECT * FROM recruitment WHERE club_id = ? ORDER BY created_at DESC')
        .all(clubId);
  return rows;
}

export function getRecruitmentDetail(id) {
  const rec = getRecruitmentById(id);
  const positions = db
    .prepare('SELECT * FROM position WHERE recruitment_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(id);
  return { ...rec, positions };
}

export function createRecruitment(clubId, body) {
  assertClubAccess(clubId);
  if (!body.title || !String(body.title).trim()) throw badRequest('批次名称不能为空');
  const fields = pickRecruitmentFields(body);
  const now = nowIso();
  const id = genId('rec');

  db.prepare(
    `INSERT INTO recruitment (id, club_id, title, status, start_at, end_at, remark, created_at, updated_at)
     VALUES (@id, @clubId, @title, 'draft', @startAt, @endAt, @remark, @createdAt, @updatedAt)`
  ).run({
    id,
    clubId,
    title: fields.title.trim(),
    startAt: fields.startAt ?? null,
    endAt: fields.endAt ?? null,
    remark: fields.remark ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return getRecruitmentById(id);
}

export function updateRecruitment(id, body) {
  const rec = getRecruitmentById(id);
  assertClubAccess(rec.club_id);
  const fields = pickRecruitmentFields(body);

  if (fields.title !== undefined) {
    if (!String(fields.title).trim()) throw badRequest('批次名称不能为空');
    fields.title = fields.title.trim();
  }

  if (Object.keys(fields).length === 0) return getRecruitmentById(id);

  const sets = Object.keys(fields).map((k) => {
    const col = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    return `${col} = @${k}`;
  });
  db.prepare(`UPDATE recruitment SET ${sets.join(', ')}, updated_at = @updatedAt WHERE id = @id`)
    .run({ ...fields, updatedAt: nowIso(), id });

  return getRecruitmentById(id);
}

export function setRecruitmentStatus(id, status) {
  const rec = getRecruitmentById(id);
  assertClubAccess(rec.club_id);
  if (!REC_STATUSES.includes(status)) {
    throw badRequest(`非法的批次状态，允许：${REC_STATUSES.join(' / ')}`);
  }
  db.prepare('UPDATE recruitment SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, nowIso(), id);
  return getRecruitmentById(id);
}

export function deleteRecruitment(id) {
  const rec = getRecruitmentById(id);
  assertClubAccess(rec.club_id);
  // 有岗位时禁止直接删除，避免误删简历归档数据
  const posCount = db
    .prepare('SELECT COUNT(*) AS c FROM position WHERE recruitment_id = ?')
    .get(id).c;
  if (posCount > 0) {
    throw forbidden('该批次下还有招新岗位，请先删除岗位或迁移岗位后再删除批次');
  }
  db.prepare('DELETE FROM recruitment WHERE id = ?').run(id);
  return { id, deleted: true };
}
