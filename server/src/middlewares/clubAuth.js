/**
 * 社团端登录态与权限中间件
 *
 * 与 basicAuth（全站一把密码）的区别：
 *   basicAuth 回答"你能不能进这个系统"；
 *   本中间件回答"你是哪个社团的谁、这一下能不能改这条数据"。
 *
 * 用法：
 *   router.put('/clubs/:clubId/standard', requireCapability('club:edit'), requireOwnClub('clubId'), handler)
 *
 * 权限判定顺序：先"登录了吗"→ 再"角色够不够"→ 再"是不是你自己社团的数据"。
 */
import * as authService from '../services/authService.js';
import { db } from '../db/connection.js';
import { unauthorized, forbidden, notFound } from '../utils/errors.js';

/**
 * 取社团端登录 token。
 *
 * 为什么优先用自定义头 X-Club-Token 而不是 Authorization：
 * 全站还有一层 HTTP Basic Auth 也用 Authorization 头。如果前端 JS 显式设置
 * Authorization: Bearer xxx，会覆盖浏览器自动附加的 Basic 凭据，导致
 * 一旦重新开启 Basic Auth，前端所有请求都会 401。
 * 用独立头就彻底避开了这两个机制打架。
 * 同时保留 Bearer 解析，方便 curl / 脚本直接调用。
 */
export function readToken(req) {
  const custom = req.headers['x-club-token'];
  if (custom) return String(custom).trim();
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

/** 解析登录态但不拦截（供同时服务登录/未登录用户的只读接口区分视角） */
export function optionalAccount(req, res, next) {
  req.account = authService.resolveSession(readToken(req));
  next();
}

/** 必须登录 */
export function requireLogin(req, res, next) {
  const account = req.account || authService.resolveSession(readToken(req));
  if (!account) return next(unauthorized('请先登录社团账号'));
  req.account = account;
  next();
}

/** 必须拥有某个能力（角色矩阵见 authService.ROLE_CAPABILITIES） */
export function requireCapability(capability) {
  return (req, res, next) => {
    const account = req.account || authService.resolveSession(readToken(req));
    if (!account) return next(unauthorized('请先登录社团账号'));
    req.account = account;
    if (!authService.hasCapability(account, capability)) {
      return next(
        forbidden(`当前角色「${account.roleLabel}」无此操作权限（需要 ${capability}）`)
      );
    }
    next();
  };
}

/**
 * 只能操作自己社团的数据。
 * clubIdParam 为路由参数名；也支持从 body/query 兜底取 clubId。
 */
export function requireOwnClub(clubIdParam = 'clubId') {
  return (req, res, next) => {
    const account = req.account;
    if (!account) return next(unauthorized('请先登录社团账号'));
    const target = req.params?.[clubIdParam] || req.body?.clubId || req.query?.clubId;
    if (!target) return next(forbidden('缺少目标社团标识'));
    if (target !== account.clubId) {
      return next(forbidden('只能操作自己所属社团的数据'));
    }
    next();
  };
}

/**
 * 针对 /applications/:id/* 这类 URL 里没有 clubId 的路由：
 * 反查这条投递属于哪个社团，并要求它就是登录者的社团。
 *
 * 为什么单独做一个：投递 → 岗位 → 批次 → 社团 要跨三张表才能定位归属，
 * 放在中间件里查一次，避免每个 service 各写一遍。
 * capability 可选，给了就顺带校验角色能力。
 */
export function requireApplicationClub(capability = '') {
  return requireOwnClubVia('application', 'id', capability);
}

/* ------------------------------------------------------------------ */
/* 归属解析：URL 里只有资源 id 时，反查它属于哪个社团                    */
/* ------------------------------------------------------------------ */

const CLUB_RESOLVERS = {
  application: (id) =>
    db
      .prepare(
        `SELECT r.club_id FROM application a
         JOIN position p ON p.id = a.position_id
         JOIN recruitment r ON r.id = p.recruitment_id
         WHERE a.id = ?`
      )
      .get(id)?.club_id,

  recruitment: (id) => db.prepare('SELECT club_id FROM recruitment WHERE id = ?').get(id)?.club_id,

  position: (id) =>
    db
      .prepare(
        `SELECT r.club_id FROM position p
         JOIN recruitment r ON r.id = p.recruitment_id WHERE p.id = ?`
      )
      .get(id)?.club_id,

  /**
   * 简历是个特例：它不属于任何社团，而是一份可被多个社团投递的资料。
   * 因此判断依据是"这份简历有没有投到我的社团"——有才让你读，
   * 没投过就看不到（学生刚创建、还没投的简历只有学生自己用 id 换回来）。
   *
   * 唯一的例外是 **DELETE 一份"孤儿简历"**（一条投递都没有，学生填一半就走了／
   * 投递被删光后剩下的空壳）：此时没有任何社团对它还有主张，允许已登录的社团账号
   * 把它清掉——否则这种垃圾数据只能靠改数据库才能删。读/改仍按严格规则。
   */
  resume: (id, account, req) => {
    const mine = db
      .prepare(
        `SELECT 1 AS ok FROM application a
         JOIN position p ON p.id = a.position_id
         JOIN recruitment r ON r.id = p.recruitment_id
         WHERE a.resume_id = ? AND r.club_id = ? LIMIT 1`
      )
      .get(id, account.clubId);
    if (mine) return account.clubId;

    if (req?.method === 'DELETE') {
      const anyApp = db.prepare('SELECT 1 AS ok FROM application WHERE resume_id = ? LIMIT 1').get(id);
      if (!anyApp) return account.clubId; // 孤儿简历：谁都可以清理
    }
    return null;
  },
};

/**
 * 通用版 requireOwnClub：URL 里没有 clubId，用 kind + 参数名反查归属。
 * 这堵住了"知道 id 就能读别人社团简历/删别人社团"的越权路径——
 * 社团 id 在公开的招新广场里是明摆着的，不能当作访问凭据。
 */
export function requireOwnClubVia(kind, paramName, capability = '') {
  const resolve = CLUB_RESOLVERS[kind];
  if (!resolve) throw new Error(`requireOwnClubVia: 未知资源类型 ${kind}`);

  return (req, res, next) => {
    const account = req.account || authService.resolveSession(readToken(req));
    if (!account) return next(unauthorized('请先登录社团账号'));
    req.account = account;

    if (capability && !authService.hasCapability(account, capability)) {
      return next(
        forbidden(`当前角色「${account.roleLabel}」无此操作权限（需要 ${capability}）`)
      );
    }

    const targetId = req.params?.[paramName];
    if (!targetId) return next(forbidden('缺少目标资源标识'));

    const clubId = resolve(targetId, account, req);
    if (!clubId) {
      // 资源不存在、或不属于登录者的社团 —— 一律按"无权访问"处理，不泄漏存在性
      return next(forbidden('该数据不属于你所属的社团'));
    }
    next();
  };
}
