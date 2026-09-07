import { Router } from 'express';
import * as recruitmentService from '../services/recruitmentService.js';
import { ok } from '../utils/respond.js';

const router = Router();

// GET /api/v1/clubs/:clubId/recruitments —— 批次列表
router.get('/clubs/:clubId/recruitments', (req, res) => {
  const { status = '' } = req.query;
  ok(res, recruitmentService.listRecruitments(req.params.clubId, { status }));
});

// GET /api/v1/recruitments/:id —— 批次详情（含岗位）
router.get('/recruitments/:id', (req, res) => {
  ok(res, recruitmentService.getRecruitmentDetail(req.params.id));
});

// POST /api/v1/clubs/:clubId/recruitments —— 创建
router.post('/clubs/:clubId/recruitments', (req, res) => {
  const rec = recruitmentService.createRecruitment(req.params.clubId, req.body || {});
  ok(res, rec, 201);
});

// PUT /api/v1/recruitments/:id —— 更新
router.put('/recruitments/:id', (req, res) => {
  ok(res, recruitmentService.updateRecruitment(req.params.id, req.body || {}));
});

// PUT /api/v1/recruitments/:id/status —— 改状态
router.put('/recruitments/:id/status', (req, res) => {
  const status = req.body?.status;
  ok(res, recruitmentService.setRecruitmentStatus(req.params.id, status));
});

// DELETE /api/v1/recruitments/:id
router.delete('/recruitments/:id', (req, res) => {
  ok(res, recruitmentService.deleteRecruitment(req.params.id));
});

export default router;
