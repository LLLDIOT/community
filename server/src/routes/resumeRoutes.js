import { Router } from 'express';
import * as resumeService from '../services/resumeService.js';
import { uploadAttachment } from '../middlewares/upload.js';
import { ok } from '../utils/respond.js';
import { requireCapability, requireOwnClubVia } from '../middlewares/clubAuth.js';
import path from 'node:path';

const router = Router();

/**
 * 简历含姓名/电话/邮箱/正文，属 PII：
 *  - POST /        保持开放（学生端自助投递必须能建简历）
 *  - GET/PUT/DELETE /:id  要求登录，且这份简历必须投过你的社团才放行
 *    （简历不属于任何社团，判断依据是"有没有投到我这里"）
 */

/**
 * 创建简历：
 * - multipart/form-data：表单字段 + file 附件（可选，支持中文字段名做映射见下）
 * - application/json：纯 JSON 字段（studentName 等 camelCase）
 */
router.post('/', uploadAttachment.single('file'), (req, res) => {
  const body = { ...(req.body || {}) };
  // multipart 场景兼容 HTML form 常用命名：student_name → studentName
  const aliasMap = {
    student_name: 'studentName', attachment: 'file',
  };
  for (const [alias, target] of Object.entries(aliasMap)) {
    if (body[alias] !== undefined && body[target] === undefined) {
      body[target] = body[alias];
      delete body[alias];
    }
  }
  if (req.file) {
    body.attachmentPath = path.posix.join('/uploads', path.basename(req.file.path));
  }
  ok(res, resumeService.createResume(body), 201);
});

router.get('/:id', requireCapability('application:read'), requireOwnClubVia('resume', 'id'), (req, res) => {
  ok(res, resumeService.getResumeById(req.params.id));
});

router.put('/:id', requireCapability('application:read'), requireOwnClubVia('resume', 'id'), (req, res) => {
  ok(res, resumeService.updateResume(req.params.id, req.body || {}));
});

// 删除简历（有投递时拒绝，避免级联误删面试历史）
router.delete('/:id', requireCapability('application:read'), requireOwnClubVia('resume', 'id'), (req, res) => {
  ok(res, resumeService.deleteResume(req.params.id));
});

export default router;
