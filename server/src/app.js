import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import clubRoutes from './routes/clubRoutes.js';
import recruitmentRoutes from './routes/recruitmentRoutes.js';
import positionRoutes from './routes/positionRoutes.js';
import resumeRoutes from './routes/resumeRoutes.js';
import applicationRoutes from './routes/applicationRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import matchRoutes from './routes/matchRoutes.js';
import { BizError } from './utils/errors.js';
import * as applicationService from './services/applicationService.js';
import { basicAuth } from './middlewares/basicAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 访问保护（公网 Basic Auth）：必须在一切业务路由/静态文件之前
  app.use(basicAuth());

  // 简历附件静态目录（uploads 与 data 同级：server/uploads）
  const uploadsDir = path.resolve(__dirname, '../uploads');
  app.use('/uploads', express.static(uploadsDir));

  // 健康检查
  app.get('/healthz', (req, res) => res.json({ code: 0, data: { status: 'ok' } }));

  // 业务路由
  app.use('/api/v1/clubs', clubRoutes);
  app.use('/api/v1', recruitmentRoutes);
  app.use('/api/v1', positionRoutes);
  app.use('/api/v1/resumes', resumeRoutes);
  app.use('/api/v1', applicationRoutes);
  app.use('/api/v1', dashboardRoutes);
  app.use('/api/v1', matchRoutes);

  // 业务字典：类型标签与状态
  app.get('/api/v1/dict', (req, res) => {
    res.json({
      code: 0,
      data: {
        typeTags: applicationService.TYPE_TAGS,
        statuses: applicationService.applicationStatusLabels,
        statusTransitions: applicationService.STATUS_TRANSITIONS,
      },
    });
  });

  // 生产模式：若存在 web/dist（已构建前端），则由后端单端口托管（SPA fallback）
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api|uploads|healthz).*/, (req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
    console.log('[web] serving built frontend from web/dist');
  }

  // 404
  app.use((req, res) => {
    res.status(404).json({ code: 40400, message: `接口不存在: ${req.method} ${req.path}` });
  });

  // 统一错误中间件
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof BizError) {
      return res.status(err.httpStatus).json({ code: err.code, message: err.message });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ code: 40001, message: 'JSON 解析失败，请检查请求体格式' });
    }
    if (err.name === 'SyntaxError') {
      return res.status(400).json({ code: 40001, message: err.message });
    }
    console.error('[error]', err);
    return res.status(500).json({ code: 50000, message: '服务器内部错误' });
  });

  return app;
}
