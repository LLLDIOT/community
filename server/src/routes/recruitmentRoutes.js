import { Router } from 'express';
import * as recruitmentService from '../services/recruitmentService.js';
import { ok } from '../utils/respond.js';
import { requireCapability, requireOwnClub, requireOwnClubVia } from '../middlewares/clubAuth.js';

const router = Router();

// GET /api/v1/clubs/:clubId/recruitments —— 批次列表（只含批次元信息，与公开广场一致，保持开放）
router.get('/clubs/:clubId/recruitments', (req, res) => {
  const { status = '' } = req.query;
  ok(res, recruitmentService.listRecruitments(req.params.clubId, { status }));
});

// GET /api/v1/recruitments/:id —— 批次详情（含岗位，同上，保持开放）
router.get('/recruitments/:id', (req, res) => {
  ok(res, recruitmentService.getRecruitmentDetail(req.params.id));
});

// POST /api/v1/clubs/:clubId/recruitments —— 创建（需 recruitment:edit + 本社团）
router.post(
  '/clubs/:clubId/recruitments',
  requireCapability('recruitment:edit'),
  requireOwnClub('clubId'),
  (req, res) => {
    const rec = recruitmentService.createRecruitment(req.params.clubId, req.body || {});
    ok(res, rec, 201);
  }
);

// PUT /api/v1/recruitments/:id —— 更新
router.put(
  '/recruitments/:id',
  requireCapability('recruitment:edit'),
  requireOwnClubVia('recruitment', 'id'),
  (req, res) => {
    ok(res, recruitmentService.updateRecruitment(req.params.id, req.body || {}));
  }
);

// PUT /api/v1/recruitments/:id/status —— 改状态（开/停招新）
router.put(
  '/recruitments/:id/status',
  requireCapability('recruitment:edit'),
  requireOwnClubVia('recruitment', 'id'),
  (req, res) => {
    const status = req.body?.status;
    ok(res, recruitmentService.setRecruitmentStatus(req.params.id, status));
  }
);

// DELETE /api/v1/recruitments/:id
router.delete(
  '/recruitments/:id',
  requireCapability('recruitment:edit'),
  requireOwnClubVia('recruitment', 'id'),
  (req, res) => {
    ok(res, recruitmentService.deleteRecruitment(req.params.id));
  }
);

export default router;
