import { Router } from 'express';
import * as applicationService from '../services/applicationService.js';
import { ok } from '../utils/respond.js';
import { parsePage } from '../utils/respond.js';

const router = Router();

/**
 * 投递体系路由（挂载于 /api/v1）：
 *  POST /positions/:positionId/applications      —— 投递简历到岗位
 *  GET  /positions/:positionId/applications      —— 某岗位投递列表（按需求归档视图）
 *  GET  /clubs/:clubId/applications              —— 社团简历库（按类型/状态筛选）
 *  GET  /clubs/:clubId/applications/export       —— 导出 CSV
 *  GET  /applications/:id                        —— 详情
 *  PATCH /applications/:id/status                —— 状态流转
 *  PATCH /applications/:id/archive               —— 归档/取消归档
 *  PUT  /applications/:id                        —— 评分/备注/类型
 *  DELETE /applications/:id                      —— 删除
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

// 状态流转
router.patch('/applications/:id/status', (req, res) => {
  ok(res, applicationService.transitionStatus(req.params.id, req.body?.status));
});

// 归档 / 取消归档（body: { archived: true|false }）
router.patch('/applications/:id/archive', (req, res) => {
  const archived = req.body?.archived === undefined ? true : Boolean(req.body.archived);
  ok(res, applicationService.setArchived(req.params.id, archived));
});

// 评分 / 备注 / 类型标签
router.put('/applications/:id', (req, res) => {
  ok(res, applicationService.updateApplication(req.params.id, req.body || {}));
});

// 删除
router.delete('/applications/:id', (req, res) => {
  ok(res, applicationService.deleteApplication(req.params.id));
});

export default router;
