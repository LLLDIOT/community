import { Router } from 'express';
import * as applicationService from '../services/applicationService.js';
import { ok } from '../utils/respond.js';
import { parsePage } from '../utils/respond.js';
import {
  requireApplicationClub,
  requireCapability,
  requireOwnClub,
  requireOwnClubVia,
} from '../middlewares/clubAuth.js';

const router = Router();

/**
 * 投递体系路由（挂载于 /api/v1）：
 *  POST /positions/:positionId/applications      —— 投递简历到岗位（学生端用，保持开放）
 *  GET  /positions/:positionId/applications      —— 某岗位投递列表  （含简历 PII，需登录 + 本社团）
 *  GET  /clubs/:clubId/applications              —— 社团简历库      （含简历 PII，需登录 + 本社团）
 *  GET  /clubs/:clubId/applications/export       —— 导出 CSV        （含简历 PII，需登录 + 本社团）
 *  GET  /applications/:id                        —— 详情
 *  PATCH /applications/:id/status                —— 状态流转        （需 application:decide + 本社团）
 *  PATCH /applications/:id/archive               —— 归档/取消归档   （需 application:decide + 本社团）
 *  PUT  /applications/:id                        —— 评分/备注/类型  （需 application:decide + 本社团）
 *  DELETE /applications/:id                      —— 删除            （需 application:decide + 本社团）
 *
 * 权限说明（公网部署的关键）：
 *  社团 id / 岗位 id 在公开的「招新广场」里是明摆着的，**不能当作访问凭据**。
 *  因此凡是要吐简历内容的接口（列表/详情/导出）都要求登录且限本社团，
 *  否则任何人都能遍历广场里的 id 把全校学生的姓名/电话/专业拉走。
 *  唯一保留开放的是 GET /applications/:id —— 学生端「我的投递」靠它查进度，
 *  而学生没有身份体系；它靠 128 位随机 id 当能力凭据（capability URL）。
 *  彻底解决要等学生侧身份认证（M5 未完成部分）。
 */

// 投递到岗位
router.post('/positions/:positionId/applications', (req, res) => {
  const app = applicationService.createApplication(req.params.positionId, req.body || {});
  ok(res, app, 201);
});

// 某岗位投递列表（含简历信息，需登录 + 本社团）
router.get(
  '/positions/:positionId/applications',
  requireCapability('application:read'),
  requireOwnClubVia('position', 'positionId'),
  (req, res) => {
    const { page, pageSize } = parsePage(req.query);
    ok(res, applicationService.listApplicationsByPosition(req.params.positionId, { page, pageSize }));
  }
);

// 社团简历库（归档总视图）——含简历 PII，需登录 + 本社团
router.get(
  '/clubs/:clubId/applications',
  requireCapability('application:read'),
  requireOwnClub('clubId'),
  (req, res) => {
    const { page, pageSize } = parsePage(req.query);
    const data = applicationService.listClubApplications(req.params.clubId, {
      typeTag: req.query.typeTag || '',
      status: req.query.status || '',
      grade: req.query.grade || '',
      keyword: req.query.keyword || '',
      positionId: req.query.positionId || '',
      recruitmentId: req.query.recruitmentId || '',
      decision: req.query.decision || '',
      page,
      pageSize,
    });
    ok(res, data);
  }
);

// 导出 CSV（整包简历 PII，需登录 + 本社团）
router.get(
  '/clubs/:clubId/applications/export',
  requireCapability('application:read'),
  requireOwnClub('clubId'),
  (req, res) => {
    const { csv, filename } = applicationService.exportClubApplicationsCsv(req.params.clubId, req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // BOM 使 Excel 正确识别 UTF-8
    res.send('\uFEFF' + csv);
  }
);

// 详情
// 注意：这是学生端「我的投递」查进度用的接口，学生没有身份体系，
// 无法要求登录；靠 128 位随机 application id 作为能力凭据（capability URL）。
router.get('/applications/:id', (req, res) => {
  ok(res, applicationService.getApplicationDetail(req.params.id));
});

// 状态流转（需登录 + application:decide + 本社团）
router.patch('/applications/:id/status', requireApplicationClub('application:decide'), (req, res) => {
  ok(res, applicationService.transitionStatus(req.params.id, req.body?.status));
});

// 归档 / 取消归档（body: { archived: true|false }）
router.patch('/applications/:id/archive', requireApplicationClub('application:decide'), (req, res) => {
  const archived = req.body?.archived === undefined ? true : Boolean(req.body.archived);
  ok(res, applicationService.setArchived(req.params.id, archived));
});

// 评分 / 备注 / 类型标签
router.put('/applications/:id', requireApplicationClub('application:decide'), (req, res) => {
  ok(res, applicationService.updateApplication(req.params.id, req.body || {}));
});

// 删除
router.delete('/applications/:id', requireApplicationClub('application:decide'), (req, res) => {
  ok(res, applicationService.deleteApplication(req.params.id));
});

export default router;
