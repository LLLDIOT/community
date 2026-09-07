import { Router } from 'express';
import * as positionService from '../services/positionService.js';
import { ok } from '../utils/respond.js';

const router = Router();

// GET /api/v1/recruitments/:recId/positions —— 岗位列表
router.get('/recruitments/:recId/positions', (req, res) => {
  ok(res, positionService.listPositions(req.params.recId));
});

// POST /api/v1/recruitments/:recId/positions —— 创建岗位
router.post('/recruitments/:recId/positions', (req, res) => {
  const pos = positionService.createPosition(req.params.recId, req.body || {});
  ok(res, pos, 201);
});

// PUT /api/v1/positions/:id
router.put('/positions/:id', (req, res) => {
  ok(res, positionService.updatePosition(req.params.id, req.body || {}));
});

// DELETE /api/v1/positions/:id
router.delete('/positions/:id', (req, res) => {
  ok(res, positionService.deletePosition(req.params.id));
});

export default router;
