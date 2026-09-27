/**
 * 两个站点共用的装配片段
 *
 * 本项目现在对外提供**两个独立网站**（同一份数据、同一个后端进程）：
 *   社团端（PC 管理台）：Basic Auth 全站密码 + 完整 API + Vue SPA
 *   学生端（手机投递）：无需密码 + 极小 API 白名单 + 单页 H5
 *
 * 放在一个进程里是有意为之：SQLite 是单写者模型，两个进程同时写同一个库文件
 * 容易踩锁与 WAL 的坑。两个端口 = 两个站点，但仍是一个进程、一条写入路径。
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BizError } from '../utils/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** web/dist —— 前端构建产物（Vue SPA + 学生端 H5 都在里面） */
export const WEB_DIST = path.resolve(__dirname, '../../../web/dist');
/** server/uploads —— 简历附件（只在社团端暴露，学生端不挂载） */
export const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');

/** 两个站点共用的基础中间件 */
export function applyBase(app) {
  // 可能跑在 nginx 等反向代理后面，开启后 req.protocol / req.hostname 才会尊重 X-Forwarded-*
  app.set('trust proxy', true);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
}

/** 健康检查（两个站点都放行，便于探活） */
export function mountHealthz(app, site) {
  app.get('/healthz', (req, res) =>
    res.json({ code: 0, data: { status: 'ok', site } })
  );
}

/** 统一 404 */
export function mountNotFound(app, hint) {
  app.use((req, res) => {
    res.status(404).json({ code: 40400, message: `${hint}：${req.method} ${req.path}` });
  });
}

/** 统一错误中间件 */
export function mountErrorHandler(app) {
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
}

/** 前端是否已构建 */
export function hasBuiltFrontend() {
  return fs.existsSync(path.join(WEB_DIST, 'index.html'));
}

/**
 * 学生端站点地址（用于社团端跳转）。
 * 优先用环境变量 STUDENT_SITE_URL（配了域名就用它），否则按当前请求的主机名 + 学生端端口推导。
 */
export function studentSiteUrl(req) {
  const configured = (process.env.STUDENT_SITE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  const port = Number(process.env.STUDENT_PORT || 3001);
  const host = req?.hostname || 'localhost';
  return `http://${host}:${port}`;
}

/**
 * 极简内存限流（学生端写入接口用）。
 * 学生端是公开的，没有身份体系，至少要挡住"脚本狂刷建简历/投递"。
 * 单进程内存计数即可满足这个量级；重启归零，可接受。
 */
export function rateLimit({ windowMs = 60_000, max = 20, message = '操作过于频繁，请稍后再试' } = {}) {
  const hits = new Map();
  // 顺手清理过期计数，避免长期运行内存缓慢增长
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs);
  if (timer.unref) timer.unref();

  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || now - rec.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    rec.count += 1;
    if (rec.count > max) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ code: 42900, message });
    }
    return next();
  };
}
