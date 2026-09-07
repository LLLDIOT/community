import { Router } from 'express';
import * as clubService from '../services/clubService.js';
import { ok } from '../utils/respond.js';
import { parsePage } from '../utils/respond.js';

const router = Router();

// GET /api/v1/clubs —— 列表（guest 可见）
router.get('/', (req, res) => {
  const { keyword = '', category = '' } = req.query;
  const { page, pageSize } = parsePage(req.query);
  const data = clubService.listClubs({ keyword, category, page, pageSize });
  ok(res, data);
});

// GET /api/v1/clubs/:id —— 详情（含批次+岗位）
router.get('/:id', (req, res) => {
  ok(res, clubService.getClubDetail(req.params.id));
});

// POST /api/v1/clubs —— 创建（M5 前开放）
router.post('/', (req, res) => {
  const club = clubService.createClub(req.body || {});
  ok(res, club, 201);
});

// PUT /api/v1/clubs/:id —— 更新
router.put('/:id', (req, res) => {
  ok(res, clubService.updateClub(req.params.id, req.body || {}));
});

// PUT /api/v1/clubs/:id/visibility —— 上/下架
router.put('/:id/visibility', (req, res) => {
  const visible = req.body?.isVisible === undefined ? true : Boolean(req.body.isVisible);
  ok(res, clubService.setVisibility(req.params.id, visible));
});

// DELETE /api/v1/clubs/:id —— 删除
router.delete('/:id', (req, res) => {
  ok(res, clubService.deleteClub(req.params.id));
});

export default router;
