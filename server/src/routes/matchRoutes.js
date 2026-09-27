import { Router } from 'express';
import * as matchService from '../services/matchService.js';
import { ok } from '../utils/respond.js';
import { requireCapability, requireOwnClub, requireOwnClubVia } from '../middlewares/clubAuth.js';

const router = Router();

/**
 * 匹配接口都会吐出学生姓名/技能/投递情况，属于简历 PII，
 * 因此统一要求登录且限本社团（简历还要"投过我的社团"才放行）。
 */

// GET /api/v1/resumes/:id/match-top?clubId=&limit=&minScore=
// 简历自动匹配：返回按匹配度排序的推荐岗位（含社团/批次/命中技能/缺失技能）
router.get(
  '/resumes/:id/match-top',
  requireCapability('application:read'),
  requireOwnClubVia('resume', 'id'),
  (req, res) => {
    const { clubId = '', limit = 10, minScore = 0 } = req.query;
    const data = matchService.recommendPositionsForResume(req.params.id, {
      clubId,
      limit: parseInt(limit, 10) || 10,
      minScore: parseInt(minScore, 10) || 0,
    });
    ok(res, data);
  }
);

// GET /api/v1/clubs/:clubId/match-applicants?limit=
// 社团侧：未录取投递者与 open 岗位的高分组合（发现漏推岗位）
router.get(
  '/clubs/:clubId/match-applicants',
  requireCapability('application:read'),
  requireOwnClub('clubId'),
  (req, res) => {
    const { limit = 50 } = req.query;
    ok(res, matchService.matchClubApplicants(req.params.clubId, { limit: parseInt(limit, 10) || 50 }));
  }
);

export default router;
