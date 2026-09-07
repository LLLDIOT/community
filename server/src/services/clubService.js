import { db } from '../db/connection.js';
import { genId, nowIso } from '../utils/id.js';
import { BizError, notFound, badRequest } from '../utils/errors.js';

/** 从请求体提取可更新字段（白名单，防止注入无关字段） */
function pickClubFields(body) {
  const fields = {};
  const keys = [
    'name', 'scale', 'scaleLabel', 'description', 'category',
    'logoPath', 'contactName', 'contactPhone', 'contactEmail',
  ];
  for (const k of keys) {
    if (body[k] !== undefined) fields[k] = body[k];
  }
  return fields;
}

export function listClubs({ keyword = '', category = '', page = 1, pageSize = 20 }) {
  const where = ['is_visible = 1'];
  const params = {};

  if (keyword) {
    where.push('(name LIKE @kw OR description LIKE @kw)');
    params.kw = `%${keyword}%`;
  }
  if (category) {
    where.push('category = @category');
    params.category = category;
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM club ${whereSql}`)
    .get(params).c;

  const list = db
    .prepare(
      `SELECT * FROM club ${whereSql}
       ORDER BY created_at DESC LIMIT @pageSize OFFSET @offset`
    )
    .all({ ...params, pageSize, offset: (page - 1) * pageSize });

  return { list, total, page, pageSize };
}

export function getClubById(id) {
  const club = db.prepare('SELECT * FROM club WHERE id = ?').get(id);
  if (!club) throw notFound('社团不存在');
  return club;
}

/** 详情：社团 + 招新批次 + 岗位 树 */
export function getClubDetail(id) {
  const club = getClubById(id);
  const recruitments = db
    .prepare('SELECT * FROM recruitment WHERE club_id = ? ORDER BY created_at DESC')
    .all(id);

  const recruitmentsWithPositions = recruitments.map((rec) => {
    const positions = db
      .prepare('SELECT * FROM position WHERE recruitment_id = ? ORDER BY sort_order ASC, created_at ASC')
      .all(rec.id);
    return { ...rec, positions };
  });

  return { ...club, recruitments: recruitmentsWithPositions };
}

export function createClub(body) {
  if (!body.name || !String(body.name).trim()) throw badRequest('社团名称不能为空');

  const fields = pickClubFields(body);
  const now = nowIso();
  const id = genId('club');

  // 名称唯一冲突检测（SQLite UNIQUE 约束兜底，这里给友好错误）
  const dup = db.prepare('SELECT id FROM club WHERE name = ?').get(fields.name.trim());
  if (dup) throw new BizError('社团名称已存在', { code: 40001 });

  db.prepare(
    `INSERT INTO club (id, name, scale, scale_label, description, category,
                       logo_path, contact_name, contact_phone, contact_email,
                       is_visible, created_at, updated_at)
     VALUES (@id, @name, @scale, @scaleLabel, @description, @category,
             @logoPath, @contactName, @contactPhone, @contactEmail,
             1, @createdAt, @updatedAt)`
  ).run({
    id,
    name: fields.name.trim(),
    scale: fields.scale ?? 0,
    scaleLabel: fields.scaleLabel ?? null,
    description: fields.description ?? '',
    category: fields.category ?? null,
    logoPath: fields.logoPath ?? null,
    contactName: fields.contactName ?? null,
    contactPhone: fields.contactPhone ?? null,
    contactEmail: fields.contactEmail ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return getClubById(id);
}

export function updateClub(id, body) {
  getClubById(id);
  const fields = pickClubFields(body);

  if (fields.name !== undefined) {
    const trimmed = String(fields.name).trim();
    if (!trimmed) throw badRequest('社团名称不能为空');
    const dup = db
      .prepare('SELECT id FROM club WHERE name = ? AND id != ?')
      .get(trimmed, id);
    if (dup) throw new BizError('社团名称已存在', { code: 40001 });
    fields.name = trimmed;
  }

  if (Object.keys(fields).length === 0) return getClubById(id);

  const sets = Object.keys(fields).map((k) => {
    // camelCase 字段 → snake_case 列名
    const col = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    return `${col} = @${k}`;
  });
  const params = { ...fields, updatedAt: nowIso() };

  db.prepare(`UPDATE club SET ${sets.join(', ')}, updated_at = @updatedAt WHERE id = @id`)
    .run({ ...params, id });

  return getClubById(id);
}

export function setVisibility(id, isVisible) {
  getClubById(id);
  db.prepare('UPDATE club SET is_visible = ?, updated_at = ? WHERE id = ?')
    .run(isVisible ? 1 : 0, nowIso(), id);
  return getClubById(id);
}

export function deleteClub(id) {
  getClubById(id);
  db.prepare('DELETE FROM club WHERE id = ?').run(id);
  return { id, deleted: true };
}
