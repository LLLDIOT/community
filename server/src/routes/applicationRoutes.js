import { Router } from 'express';
import * as applicationService from '../services/applicationService.js';
import { ok } from '../utils/respond.js';
import { parsePage } from '../utils/respond.js';
import { requireApplicationClub } from '../middlewares/clubAuth.js';

const router = Router();

/**
 * 投递体系路由（挂载于 /api/v1）：
 *  POST /positions/:positionId/applications      —— 投递简历到岗位（学生端用，保持开放）
 *  GET  /positions/:positionId/applications      —— 某岗位投递列表（按需求归档视图）
 *  GET  /clubs/:clubId/applications              —— 社团简历库（按类型/状态/结论筛选）
 *  GET  /clubs/:clubId/applications/export       —— 导出 CSV
 *  GET  /applications/:id                        —— 详情
 *  PATCH /applications/:id/status                —— 状态流转        （需 application:decide + 本社团）
 *  PATCH /applications/:id/archive               —— 归档/取消归档   （需 application:decide + 本社团）
 *  PUT  /applications/:id                        —— 评分/备注/类型  （需 application:decide + 本社团）
 *  DELETE /applications/:id                      —— 删除            （需 application:decide + 本社团）
 *
 * 权限说明：读接口保持开放（广场/简历库浏览、学生端查投递进度都要用）；
 * 写接口要求登录社团账号，且只能操作自己社团收到的投递——这就是"每个人的权限"的落地。
 * 注意：学生端的 POST /resumes 与 POST /positions/:id/applications 保持开放，
 * 否则学生无法自助投递；防冒名需要后续接校园统一认证，不在本轮范围。
 */

// 投递到岗位
router.post('/positions/:positionId/applications', (req, res) => {
  const app = applicationService.createApplication(req.params.positionId, req.body || {});
  ok(res, app, 201);
});

// 某岗位投递列表
router.get('/positions/:positionId/applications', (req, res) => {
  const { page, pageSize } = parsePage(req.query);
  ok(res, applicationService.listApplicationsByPosition(req.params.positionId, { page, pageSize }));
});

// 社团简历库（归档总视图）——注意必须放在 /applications/:id 之前? 不,路径结构不同,无冲突
router.get('/clubs/:clubId/applications', (req, res) => {
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
});

// 导出 CSV
router.get('/clubs/:clubId/applications/export', (req, res) => {
  const { csv, filename } = applicationService.exportClubApplicationsCsv(req.params.clubId, req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // BOM 使 Excel 正确识别 UTF-8
  res.send('\uFEFF' + csv);
});

// 详情
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
