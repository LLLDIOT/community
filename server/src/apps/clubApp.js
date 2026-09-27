/**
 * 社团端（PC 管理台）站点
 *
 * 特征：
 *   - 全站 HTTP Basic Auth 密码保护（公网部署必须开启）
 *   - 完整业务 API（招新广场、面试决策、简历库、看板、匹配、账号管理）
 *   - 托管 Vue SPA（web/dist）
 *   - 暴露 /uploads 简历附件（只有本社团登录者能取到，接口层另有归属校验）
 *
 * 学生的投递入口**不在这里**——见 studentApp.js。
 * 访问本站的 /portal.html 会被重定向到学生端站点，避免学生误入带密码的地址。
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';

import clubRoutes from '../routes/clubRoutes.js';
import recruitmentRoutes from '../routes/recruitmentRoutes.js';
import positionRoutes from '../routes/positionRoutes.js';
import resumeRoutes from '../routes/resumeRoutes.js';
import applicationRoutes from '../routes/applicationRoutes.js';
import dashboardRoutes from '../routes/dashboardRoutes.js';
import matchRoutes from '../routes/matchRoutes.js';
import authRoutes from '../routes/authRoutes.js';
import squareRoutes from '../routes/squareRoutes.js';
import decisionRoutes from '../routes/decisionRoutes.js';
import { basicAuth } from '../middlewares/basicAuth.js';
import { optionalAccount } from '../middlewares/clubAuth.js';
import * as applicationService from '../services/applicationService.js';
import * as authService from '../services/authService.js';
import * as decisionService from '../services/decisionService.js';
import {
  applyBase,
  mountHealthz,
  mountNotFound,
  mountErrorHandler,
  hasBuiltFrontend,
  studentSiteUrl,
  WEB_DIST,
  UPLOADS_DIR,
} from './common.js';

export function createClubApp() {
  const app = express();
  applyBase(app);

  const studentPort = Number(process.env.STUDENT_PORT || 3001);
  const studentEnabled = studentPort > 0 && studentPort !== Number(process.env.PORT || 3000);

  // 全站访问保护：必须在一切业务路由/静态文件之前
  app.use(basicAuth());

  mountHealthz(app, 'club');

  // 简历附件（仅社团端；学生端站点不挂载）
  app.use('/uploads', express.static(UPLOADS_DIR));

  // 学生端已独立成站：这里把 /portal.html 重定向过去，免得学生拿到带密码的地址
  app.get('/portal.html', (req, res) => {
    if (!studentEnabled) {
      return res.sendFile(path.join(WEB_DIST, 'portal.html'));
    }
    return res.redirect(302, studentSiteUrl(req));
  });

  // 社团端登录态解析（只识别 token，不拦截）
  app.use(optionalAccount);

  /* ── 业务路由 ── */
  app.use('/api/v1/clubs', clubRoutes);
  app.use('/api/v1', recruitmentRoutes);
  app.use('/api/v1', positionRoutes);
  app.use('/api/v1/resumes', resumeRoutes);
  app.use('/api/v1', applicationRoutes);
  app.use('/api/v1', dashboardRoutes);
  app.use('/api/v1', matchRoutes);
  app.use('/api/v1', authRoutes);
  app.use('/api/v1/square', squareRoutes);
  app.use('/api/v1', decisionRoutes);

  /* ── 业务字典 ── */
  app.get('/api/v1/dict', (req, res) => {
    res.json({
      code: 0,
      data: {
        typeTags: applicationService.TYPE_TAGS,
        statuses: applicationService.applicationStatusLabels,
        statusTransitions: applicationService.STATUS_TRANSITIONS,
        decisions: decisionService.decisionMeta,
        roles: authService.ROLES,
        roleLabels: authService.ROLE_LABELS,
        roleCapabilities: authService.ROLE_CAPABILITIES,
        clubCreateTokenRequired: Boolean(process.env.CLUB_CREATE_TOKEN),
        // 前端用它拼"学生投递端"入口链接
        studentSiteUrl: studentSiteUrl(req),
        studentSiteEnabled: studentEnabled,
      },
    });
  });

  /* ── 生产模式：托管 Vue SPA（单页应用 fallback）── */
  if (hasBuiltFrontend()) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api|uploads|healthz|portal\.html).*/, (req, res) => {
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
    console.log('[club] serving built SPA from web/dist');
  } else {
    console.warn('[club] 未找到 web/dist/index.html —— 请先在 web/ 目录执行 npm run build');
  }

  mountNotFound(app, '社团端接口不存在');
  mountErrorHandler(app);
  return app;
}
