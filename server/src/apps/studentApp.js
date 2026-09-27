/**
 * 学生端（手机投递）站点
 *
 * 特征：
 *   - **不需要全站密码**：学生不应该知道社团端的管理密码
 *   - 只托管学生端 H5（portal.html + portal-adapter.js），根路径就是它
 *   - API 只开放 studentRoutes.js 里白名单的 5 个接口，其余 404
 *   - **不挂载 /uploads**：简历附件属学生个人信息，学生端没有下载需求，
 *     不暴露就少一条泄露路径
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

  /* ── 学生端页面 ── */
  const portalHtml = path.join(WEB_DIST, 'portal.html');
  const adapterJs = path.join(WEB_DIST, 'portal-adapter.js');

  // 根路径就是学生端首页（它本身就是一个网站，不是某个路径下的页面）
  app.get('/', (req, res) => {
    if (!fs.existsSync(portalHtml)) {
      return res
        .status(503)
        .type('html')
        .send('<h2>学生端尚未构建</h2><p>请在 web/ 目录执行 <code>npm run build</code> 后重启服务。</p>');
    }
    return res.sendFile(portalHtml);
  });

  // 保留 /portal.html 也能访问，兼容旧链接与文档
  app.get('/portal.html', (req, res) => {
    if (!fs.existsSync(portalHtml)) return res.status(503).send('学生端尚未构建');
    return res.sendFile(portalHtml);
  });

  app.get('/portal-adapter.js', (req, res) => {
    if (!fs.existsSync(adapterJs)) return res.status(404).send('// adapter not built');
    res.type('application/javascript');
    return res.sendFile(adapterJs);
  });

  app.get('/favicon.ico', (req, res) => res.status(204).end());

  mountNotFound(app, '学生端不存在该地址');
  mountErrorHandler(app);
  return app;
}
