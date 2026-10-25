import { Router } from 'express';
import * as emb from '../ml/embeddingService.js';
import * as skills from '../ml/skillExtractor.js';
import * as clustering from '../ml/clustering.js';
import { parsePage, ok } from '../utils/respond.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireCapability, requireOwnClub, requireOwnClubVia } from '../middlewares/clubAuth.js';

const router = Router();

/**
 * 机器学习能力路由（挂载于 /api/v1/ml）
 *
 *  GET  /ml/status                     —— 模型状态（是否就绪、模型名、维度）
 *  POST /ml/resumes/:id/auto-skills    —— 对单份简历做技能自动抽取，写回 skills_auto
 *  POST /ml/clubs/:clubId/auto-skills  —— 批量刷新该社团所有简历的自动标签
 *  GET  /ml/clubs/:clubId/clusters     —— 候选人无监督聚类（K-means + 轮廓系数选 k）
 *
 * 权限：
 *   · 抽取与聚类都会读取简历正文（PII），因此要求登录社团账号
 *   · 简历级操作还要求"这份简历投过我的社团"
 */

router.get('/status', (req, res) => {
  const model = emb.getStatus();
  const mode = model.enabled && model.ready ? 'semantic' : 'rules';
  ok(res, {
    ...model,
    matchMode: mode,
    note:
      mode === 'semantic'
        ? '语义匹配已启用：预训练中文嵌入 bge-small-zh + 技能标签融合'
        : '语义匹配未就绪，当前为规则匹配（字符串命中）；系统功能不受影响',
    calibration: {
      min: Number(process.env.ML_CALIB_MIN || 0.46),
      max: Number(process.env.ML_CALIB_MAX || 0.75),
    },
  });
});

router.post(
  '/resumes/:id/auto-skills',
  requireCapability('application:read'),
  requireOwnClubVia('resume', 'id'),
  asyncHandler(async (req, res) => {
    ok(res, await skills.extractResumeSkills(req.params.id, { persist: true }));
  })
);

router.post(
  '/clubs/:clubId/auto-skills',
  requireCapability('application:read'),
  requireOwnClub('clubId'),
  asyncHandler(async (req, res) => {
    ok(res, await skills.extractClubResumeSkills(req.params.clubId));
  })
);

router.get(
  '/clubs/:clubId/clusters',
  requireCapability('application:read'),
  requireOwnClub('clubId'),
  asyncHandler(async (req, res) => {
    const autoK = req.query.k === undefined || req.query.k === '';
    const k = autoK ? 0 : parseInt(req.query.k, 10) || 0;
    ok(res, await clustering.clusterCandidates(req.params.clubId, { k, autoK }));
  })
);

export default router;
