/**
 * 学生端（手机投递）API 白名单
 *
 * 为什么单独写一份、而不是复用社团端的路由：
 *   学生端是**公开站点**（不给学生发访问密码），所以它的接口面积必须尽可能小。
 *   复用社团端路由等于把简历库、导出、看板、账号管理等全部暴露在无密码站点上，
 *   一旦哪天某个中间件被改漏，就是"整库学生个人信息可被匿名拉取"。
 *   这里用白名单显式列出学生真正需要的 5 个接口，其余一律 404。
 *
 * 白名单依据：portal-adapter.js 里实际调用的接口（不多不少）。
 */
import { Router } from 'express';
import path from 'node:path';

import * as clubService from '../services/clubService.js';
import * as resumeService from '../services/resumeService.js';
import * as applicationService from '../services/applicationService.js';
import { uploadAttachment } from '../middlewares/upload.js';
import { ok, parsePage } from '../utils/respond.js';
import { rateLimit } from '../apps/common.js';

const router = Router();

/** 写入接口限流：学生端公开，必须挡住脚本狂刷 */
const writeLimit = rateLimit({ windowMs: 60_000, max: 20 });

/* ── ① 社团列表（学生浏览要投哪家）── */
router.get('/clubs', (req, res) => {
  const { keyword = '', category = '' } = req.query;
  const { page, pageSize } = parsePage(req.query);
  ok(res, clubService.listClubs({ keyword, category, page, pageSize }));
});

/* ── ② 社团详情（含批次与岗位，用于选岗位投递）── */
/* 注意：这里只吐社团/批次/岗位的公开信息，不含任何投递者数据 */
router.get('/clubs/:id', (req, res) => {
  ok(res, clubService.getClubDetail(req.params.id));
});

/* ── ③ 建简历（支持 JSON 或 multipart 带附件）── */
router.post('/resumes', writeLimit, uploadAttachment.single('file'), (req, res) => {
  const body = { ...(req.body || {}) };
  // 兼容 HTML form 的 snake_case 命名
  if (body.student_name !== undefined && body.studentName === undefined) {
    body.studentName = body.student_name;
    delete body.student_name;
  }
  if (req.file) {
    body.attachmentPath = path.posix.join('/uploads', path.basename(req.file.path));
  }
  ok(res, resumeService.createResume(body), 201);
});

/* ── ④ 投递到岗位 ── */
router.post('/positions/:positionId/applications', writeLimit, (req, res) => {
  ok(res, applicationService.createApplication(req.params.positionId, req.body || {}), 201);
});

/* ── ⑤ 查自己那条投递的进度 ── */
/*
 * 学生没有身份体系，无法鉴权；这里靠 128 位随机的 application id 当"能力凭据"
 * （只有投递成功时返回给本人，猜不到）。
 * 返回体含本人简历内容——本人看自己的资料是合理的。
 * 彻底解决要等学生侧身份认证（学号/短信），属 M5 未完成部分。
 */
router.get('/applications/:id', (req, res) => {
  ok(res, applicationService.getApplicationDetail(req.params.id));
});

/* ── 其余一律拒绝：不暴露学生端不该有的接口 ── */
router.use((req, res) => {
  res.status(404).json({
    code: 40400,
    message: `学生端不提供该接口：${req.method} ${req.originalUrl}`,
  });
});

export default router;
