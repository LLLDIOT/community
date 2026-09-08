import { Router } from 'express';
import * as dashboardService from '../services/dashboardService.js';
import { ok } from '../utils/respond.js';

const router = Router();

// GET /api/v1/dashboard?clubId=&days=30 —— 看板聚合数据（只读）
router.get('/dashboard', (req, res) => {
  const { clubId = '', days = 30 } = req.query;
  ok(res, dashboardService.getDashboard({ clubId, days }));
});

export default router;
