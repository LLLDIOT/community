/**
 * HTTP Basic Auth 中间件
 *
 * 目的：为公网部署提供一层基础访问保护（M5 完整登录上线前的过渡方案）。
 * 覆盖范围：所有非 /healthz 的请求（页面 + API + 上传文件）。
 *
 * 配置（环境变量，也可在 .env 设置）：
 *   BASIC_AUTH_USER  —— 用户名，默认 "admin"
 *   BASIC_AUTH_PASS  —— 密码，默认 "change-me"（必须在生产环境覆盖！）
 *   BASIC_AUTH_DISABLE —— 设为 "1" 可临时关闭（本地开发用）
 *
 * 浏览器行为：页面首次访问弹浏览器原生账号密码框；
 * 记住后同域后续请求自动携带 Authorization 头（无需登录页）。
 */

function authRequired(req) {
  // 健康检查放行（运维探活用），其余全部要求认证
  return req.path !== '/healthz';
}

/** 从 Authorization 头解出明文 user:pass */
function parseCredentials(req) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Basic\s+(.+)$/i);
  if (!m) return null;
  try {
    const decoded = Buffer.from(m[1], 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx < 0) return null;
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

function safeEqual(a, b) {
  // 常量时间比较，降低时序侧信道风险（口令校验场景的常见做法）
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return Buffer.compare(bufA, bufB) === 0;
}

export function basicAuth(options = {}) {
  const user = options.user || process.env.BASIC_AUTH_USER || 'admin';
  const pass = options.pass || process.env.BASIC_AUTH_PASS || 'change-me';
  const disabled = options.disabled ?? process.env.BASIC_AUTH_DISABLE === '1';

  if (!disabled && (pass === 'change-me' || pass === 'changeme')) {
    console.warn(
      '[basic-auth] ⚠️ 正在使用默认密码 change-me！' +
      '公网部署请通过环境变量 BASIC_AUTH_PASS 设置强密码。'
    );
  }

  if (disabled) {
    console.warn('[basic-auth] 已通过 BASIC_AUTH_DISABLE=1 关闭，所有请求免认证');
    return (req, res, next) => next();
  }

  return (req, res, next) => {
    if (!authRequired(req)) return next();

    const cred = parseCredentials(req);
    const ok = cred && safeEqual(cred.user, user) && safeEqual(cred.pass, pass);

    if (ok) return next();

    // 401 + WWW-Authenticate 头：浏览器会弹出原生登录框
    res.setHeader('WWW-Authenticate', 'Basic realm="community"');
    return res.status(401).json({ code: 40100, message: '需要访问密码' });
  };
}
