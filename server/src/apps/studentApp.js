/**
 * 学生端（学生投递）站点
 *
 * 与社团端的区别只在"权限边界"，交互方式已经统一为同一套 SPA：
 *   - **不需要全站密码**：学生不应该知道社团端的管理密码
 *   - 前端是独立的 Vue SPA（student.html 入口），左侧导航 + 多视图切换
 *   - API 只开放 studentRoutes.js 里白名单的 5 个接口，其余 404
 *   - **不挂载 /uploads**：简历附件属学生个人信息，学生端没有下载需求
 *   - 只暴露 /assets 静态资源，不暴露社团端的 index.html 等产物
 *
 * 与社团端共用同一个进程与同一个 SQLite 库（单写者），只是监听另一个端口。
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';

import studentRoutes from '../routes/studentRoutes.js';
import {
  applyBase,
  mountHealthz,
  mountNotFound,
  mountErrorHandler,
  WEB_DIST,
} from './common.js';

export function createStudentApp() {
  const app = express();
  applyBase(app);

  mountHealthz(app, 'student');

  /* ── 学生端 API（白名单）── */
  app.use('/api/v1', studentRoutes);

  const studentHtml = path.join(WEB_DIST, 'student.html');
  const assetsDir = path.join(WEB_DIST, 'assets');

  const sendStudentShell = (req, res) => {
    if (!fs.existsSync(studentHtml)) {
      return res
        .status(503)
        .type('html')
        .send('<h2>学生端尚未构建</h2><p>请在 web/ 目录执行 <code>npm run build</code> 后重启服务。</p>');
    }
    return res.sendFile(studentHtml);
  };

  /* ── 构建产物：只放出 assets，不放社团端的 index.html ── */
  if (fs.existsSync(assetsDir)) {
    app.use('/assets', express.static(assetsDir, { index: false, maxAge: '7d' }));
  }

  /* ── 学生端入口：根路径即站点首页 ── */
  app.get('/', sendStudentShell);
  // 兼容旧链接：原来的单文件 H5 就在 /portal.html
  app.get('/portal.html', sendStudentShell);

  app.get('/favicon.ico', (req, res) => res.status(204).end());

  /*
   * SPA 回落：/clubs、/progress、/guide 等前端路由在服务器上没有对应文件，
   * 必须回落到 student.html，否则刷新页面会 404。
   * 排除 /api（已在前面的路由处理）、/assets（静态资源）与 /uploads（本站点不提供）。
   */
  app.get(/^\/(?!api\/|assets\/|uploads\/|healthz).*/, sendStudentShell);

  mountNotFound(app, '学生端不存在该地址');
  mountErrorHandler(app);
  return app;
}
