import { Router } from 'express';
import * as matchService from '../services/matchService.js';
import { ok } from '../utils/respond.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireCapability, requireOwnClub, requireOwnClubVia } from '../middlewares/clubAuth.js';

const router = Router();

/**
 * 匹配接口都会吐出学生姓名/技能/投递情况，属于简历 PII，
 * 因此统一要求登录且限本社团（简历还要"投过我的社团"才放行）。
 *
 * 注意：匹配接口现在是 async（要跑嵌入模型推理），必须用 asyncHandler 包裹，
 *      否则 Express 4 不会捕获 Promise 异常，请求会挂到超时。
 *
 * 注意：`GET /ml/status` 统一由 routes/mlRoutes.js 提供（那里同时给出模型状态与匹配模式）。
 *      这里不要再注册同名路由，否则会因挂载顺序被抢先匹配、返回错误结构。
 */

// GET /api/v1/resumes/:id/match-top?clubId=&limit=&minScore=
// 简历自动匹配：返回按匹配度排序的推荐岗位（语义分 + 命中/缺失技能）
router.get(
  '/resumes/:id/match-top',
  requireCapability('application:read'),
  requireOwnClubVia('resume', 'id'),
  asyncHandler(async (req, res) => {
    const { clubId = '', limit = 10, minScore = 0 } = req.query;
    const data = await matchService.recommendPositionsForResume(req.params.id, {
      clubId,
      limit: parseInt(limit, 10) || 10,
      minScore: parseInt(minScore, 10) || 0,
    });
    ok(res, data);
  })
);

// GET /api/v1/resumes/:id/match-position/:positionId —— 单个组合的详细解释
router.get(
  '/resumes/:id/match-position/:positionId',
  requireCapability('application:read'),
  requireOwnClubVia('resume', 'id'),
  asyncHandler(async (req, res) => {
    const data = await matchService.scoreResumeVsPosition(req.params.id, req.params.positionId);
    ok(res, data);
  })
);

// GET /api/v1/clubs/:clubId/match-applicants?limit=&minScore=
// 社团侧：未录取投递者与 open 岗位的高分组合（发现漏推岗位）
router.get(
  '/clubs/:clubId/match-applicants',
  requireCapability('application:read'),
  requireOwnClub('clubId'),
  asyncHandler(async (req, res) => {
    const { limit = 50, minScore = 50 } = req.query;
    ok(
      res,
      await matchService.matchClubApplicants(req.params.clubId, {
        limit: parseInt(limit, 10) || 50,
        minScore: parseInt(minScore, 10) || 50,
      })
    );
  })
);

export default router;
