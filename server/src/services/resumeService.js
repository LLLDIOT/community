import { db } from '../db/connection.js';
import { genId, nowIso } from '../utils/id.js';
import { notFound, badRequest } from '../utils/errors.js';

function pickResumeFields(body) {
  const fields = {};
  for (const k of ['studentName', 'phone', 'email', 'school', 'major', 'grade', 'content', 'attachmentPath', 'skills']) {
    if (body[k] !== undefined) fields[k] = body[k];
  }
  return fields;
}

export function getResumeById(id) {
  const resume = db.prepare('SELECT * FROM resume WHERE id = ?').get(id);
  if (!resume) throw notFound('简历不存在');
  return resume;
}

/** 创建简历：支持表单 JSON 字段 + 附件路径 */
export function createResume(body) {
  if (!body.studentName || !String(body.studentName).trim()) throw badRequest('学生姓名不能为空');
  const fields = pickResumeFields(body);
  const now = nowIso();
  const id = genId('res');

  db.prepare(
    `INSERT INTO resume (id, student_name, phone, email, school, major, grade,
                         content, attachment_path, skills, created_at, updated_at)
     VALUES (@id, @studentName, @phone, @email, @school, @major, @grade,
             @content, @attachmentPath, @skills, @createdAt, @updatedAt)`
  ).run({
    id,
    studentName: fields.studentName.trim(),
    phone: fields.phone ?? null,
    email: fields.email ?? null,
    school: fields.school ?? null,
    major: fields.major ?? null,
    grade: fields.grade ?? null,
    content: fields.content ?? null,
    attachmentPath: fields.attachmentPath ?? null,
    skills: fields.skills ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return getResumeById(id);
}

export function updateResume(id, body) {
  getResumeById(id);
  const fields = pickResumeFields(body);

  if (fields.studentName !== undefined && !String(fields.studentName).trim()) {
    throw badRequest('学生姓名不能为空');
  }
  if (fields.studentName !== undefined) fields.studentName = fields.studentName.trim();

  if (Object.keys(fields).length === 0) return getResumeById(id);

  const sets = Object.keys(fields).map((k) => {
    const col = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    return `${col} = @${k}`;
  });
  db.prepare(`UPDATE resume SET ${sets.join(', ')}, updated_at = @updatedAt WHERE id = @id`)
    .run({ ...fields, updatedAt: nowIso(), id });

  return getResumeById(id);
}

/**
 * 删除简历（清理误建/测试归档用）。
 * 有投递记录的简历不允许直接删——否则外键级联会把投递一起带走，
 * 相当于绕过状态机删掉了社团的面试历史。要删先处理投递。
 */
export function deleteResume(id) {
  getResumeById(id);
  const appCount = db
    .prepare('SELECT COUNT(*) AS c FROM application WHERE resume_id = ?')
    .get(id).c;
  if (appCount > 0) {
    throw badRequest(`该简历还有 ${appCount} 条投递记录，请先删除投递后再删除简历`);
  }
  db.prepare('DELETE FROM resume WHERE id = ?').run(id);
  return { id, deleted: true };
}
