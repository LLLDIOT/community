import { Router } from 'express';
import * as positionService from '../services/positionService.js';
import { ok } from '../utils/respond.js';
import { requireCapability, requireOwnClubVia } from '../middlewares/clubAuth.js';

const router = Router();

// GET /api/v1/recruitments/:recId/positions —— 岗位列表（只含岗位元信息，与公开广场一致，保持开放）
router.get('/recruitments/:recId/positions', (req, res) => {
  ok(res, positionService.listPositions(req.params.recId));
});

// POST /api/v1/recruitments/:recId/positions —— 创建岗位（需 position:edit + 本社团）
router.post(
  '/recruitments/:recId/positions',
  requireCapability('position:edit'),
  requireOwnClubVia('recruitment', 'recId'),
  (req, res) => {
    const pos = positionService.createPosition(req.params.recId, req.body || {});
    ok(res, pos, 201);
  }
);

// PUT /api/v1/positions/:id —— 更新（含改招新人数上限）
router.put(
  '/positions/:id',
  requireCapability('position:edit'),
  requireOwnClubVia('position', 'id'),
  (req, res) => {
    ok(res, positionService.updatePosition(req.params.id, req.body || {}));
  }
);

// DELETE /api/v1/positions/:id
router.delete(
  '/positions/:id',
  requireCapability('position:edit'),
  requireOwnClubVia('position', 'id'),
  (req, res) => {
    ok(res, positionService.deletePosition(req.params.id));
  }
);

export default router;
