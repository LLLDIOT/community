import { Router } from 'express';
import * as squareService from '../services/squareService.js';
import { ok } from '../utils/respond.js';

const router = Router();

/**
 * 招新广场（挂载于 /api/v1/square）—— 双面板的「全校社团总览」侧，全部只读。
 *
 *  GET /square/clubs          —— 全校社团总览卡片（含招新情况 + 投递人数）
 *  GET /square/clubs/:id      —— 某个社团的招新情况详情（点图标进来看到的）
 *  GET /square/categories     —— 分类筛选项
 *
 * 为什么不需要登录：需求里"点进去看看别的社团的招新情况、投递人数"是公开浏览行为；
 * 要修改某个社团的数据，才需要该社团的账号（见 /auth 与 /clubs/:id/standard）。
 */

router.get('/clubs', (req, res) => {
  ok(
    res,
    squareService.listSquareClubs({
      keyword: req.query.keyword || '',
      category: req.query.category || '',
      stage: req.query.stage || '',
      sort: req.query.sort || 'applications',
    })
  );
});

router.get('/categories', (req, res) => {
  ok(res, squareService.listCategories());
});

router.get('/clubs/:id', (req, res) => {
  const days = Math.min(180, Math.max(7, parseInt(req.query.days, 10) || 30));
  ok(res, squareService.getSquareClub(req.params.id, { days }));
});

export default router;
