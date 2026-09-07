import { Router } from 'express';
import * as resumeService from '../services/resumeService.js';
import { uploadAttachment } from '../middlewares/upload.js';
import { ok } from '../utils/respond.js';
import path from 'node:path';

const router = Router();

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

router.get('/:id', (req, res) => {
  ok(res, resumeService.getResumeById(req.params.id));
});

router.put('/:id', (req, res) => {
  ok(res, resumeService.updateResume(req.params.id, req.body || {}));
});

export default router;
