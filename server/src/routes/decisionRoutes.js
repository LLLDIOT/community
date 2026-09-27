import { Router } from 'express';
import * as decisionService from '../services/decisionService.js';
import { ok } from '../utils/respond.js';
import {
  requireCapability,
  requireOwnClub,
  requireOwnClubVia,
  requireApplicationClub,
} from '../middlewares/clubAuth.js';

const router = Router();

/**
 * 面试决策路由（挂载于 /api/v1）—— 录用 / 调剂 / 候补序号 / 递补招满
 *
 *  GET   /clubs/:clubId/interview-board        —— 面试与录用工作台数据（分列 + 进度 + 汇总）
 *  GET   /applications/:id/decision            —— 单条投递的决策详情
 *  PATCH /applications/:id/decision            —— 标注结论（录用/候补N号/调剂/淘汰/撤销）
 *  GET   /applications/:id/adjust-suggestions  —— 调剂建议（技能匹配推荐目标岗位）
 *  POST  /applications/:id/adjust              —— 执行调剂（在目标岗位建投递 + 原岗标注）
 *  GET   /positions/:positionId/waitlist       —— 候补队列（按序号 = 递补顺序）
 *  POST  /positions/:positionId/promote-waitlist —— 递补：候补队首提升为录用
 *  GET   /positions/:positionId/progress       —— 岗位招满进度
 *
 * 权限：读需要 application:read（viewer 起），写需要 application:decide（interviewer 起）。
 * 服务层再校验"这条投递是否属于你的社团"，双重把关。
 */

router.get(
  '/clubs/:clubId/interview-board',
  requireCapability('application:read'),
  requireOwnClub('clubId'),
  (req, res) => {
    ok(
      res,
      decisionService.getInterviewBoard(req.params.clubId, {
        recruitmentId: req.query.recruitmentId || '',
        positionId: req.query.positionId || '',
        keyword: req.query.keyword || '',
        onlyUndecided: req.query.onlyUndecided === '1' || req.query.onlyUndecided === 'true',
      })
    );
  }
);

router.get('/applications/:id/decision', requireApplicationClub('application:read'), (req, res) => {
  ok(res, decisionService.getDecisionDetail(req.params.id));
});

router.patch('/applications/:id/decision', requireApplicationClub('application:decide'), (req, res) => {
  ok(res, decisionService.setDecision(req.params.id, req.body || {}, req.account));
});

router.get(
  '/applications/:id/adjust-suggestions',
  requireApplicationClub('application:decide'),
  (req, res) => {
    ok(res, decisionService.suggestAdjust(req.params.id, req.account));
  }
);

router.post('/applications/:id/adjust', requireApplicationClub('application:decide'), (req, res) => {
  ok(res, decisionService.applyAdjust(req.params.id, req.body || {}, req.account));
});

router.get(
  '/positions/:positionId/waitlist',
  requireCapability('application:read'),
  requireOwnClubVia('position', 'positionId'),
  (req, res) => {
    ok(res, decisionService.listWaitlist(req.params.positionId));
  }
);

router.post(
  '/positions/:positionId/promote-waitlist',
  requireCapability('application:decide'),
  requireOwnClubVia('position', 'positionId'),
  (req, res) => {
    ok(res, decisionService.promoteWaitlist(req.params.positionId, req.body || {}, req.account));
  }
);

router.get(
  '/positions/:positionId/progress',
  requireCapability('application:read'),
  requireOwnClubVia('position', 'positionId'),
  (req, res) => {
    ok(res, decisionService.refreshPositionProgress(req.params.positionId));
  }
);

export default router;
