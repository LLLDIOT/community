/**
 * 社团端账号与按人权限
 *
 * 为什么需要它：需求里"通过登录可以修改自己社团的信息录入标准/投递时间"
 * 以及"每个人的权限"——Basic Auth 只是全站一把密码，无法区分"你是谁、能改哪个社团"。
 * 这里补一层社团级账号体系（M5 完整多角色认证的轻量落地）：
 *
 *   一个社团 → 多个账号（owner 社长 / interviewer 面试官 / viewer 观察员）
 *   登录成功 → 颁发随机 token（存 club_session 表，默认 12 小时过期）
 *   前端在自定义头 X-Club-Token 里带回，服务端据此判定"人 + 社团 + 角色"
 *   （用自定义头而非 Authorization，是为了不与全站那层 HTTP Basic Auth 抢同一个头；
 *     同时兼容 Authorization: Bearer，便于 curl / 脚本直接调用）
 *
 * 安全要点：
 *   - 口令用 scrypt + 每账号随机盐派生，不落明文（对比用 timingSafeEqual 防时序侧信道）
 *   - token 是 32 字节随机数，只存服务端；退出即删
 *   - 角色 → 能力（capability）矩阵集中在此，前端经 /dict 取同一份用于隐藏按钮
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db } from '../db/connection.js';
import { genId, nowIso } from '../utils/id.js';
import { notFound, badRequest, forbidden, unauthorized, BizError } from '../utils/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROLES = ['owner', 'interviewer', 'viewer'];

export const ROLE_LABELS = {
  owner: '社长 / 管理员',
  interviewer: '面试官',
  viewer: '观察员',
};

/**
 * 角色能力矩阵 —— "每个人的权限"的唯一事实来源。
 * 后端的 requireCapability 用它鉴权，前端用它决定按钮显隐。
 */
export const ROLE_CAPABILITIES = {
  owner: [
    'club:edit', 'recruitment:edit', 'position:edit',
    'application:read', 'application:decide', 'dashboard:read', 'account:manage',
  ],
  interviewer: ['application:read', 'application:decide', 'dashboard:read'],
  viewer: ['application:read', 'dashboard:read'],
};

export function capabilitiesOf(role) {
  return ROLE_CAPABILITIES[role] || [];
}

export function hasCapability(account, capability) {
  if (!account) return false;
  return capabilitiesOf(account.role).includes(capability);
}

/** 会话有效期（小时），可用环境变量覆盖 */
const SESSION_TTL_HOURS = Number(process.env.CLUB_SESSION_HOURS || 12);

/* ------------------------------------------------------------------ */
/* 口令派生                                                            */
/* ------------------------------------------------------------------ */

function derive(password, salt) {
  return scryptSync(String(password), salt, 64).toString('hex');
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: derive(password, salt) };
}

function verifyPassword(password, salt, expectedHex) {
  const expected = Buffer.from(String(expectedHex), 'hex');
  const actual = Buffer.from(derive(password, salt), 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/* ------------------------------------------------------------------ */
/* 登录 / 会话                                                         */
/* ------------------------------------------------------------------ */

function publicAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    clubId: row.club_id,
    clubName: row.club_name,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role] || row.role,
    capabilities: capabilitiesOf(row.role),
    lastLoginAt: row.last_login_at,
  };
}

function loadAccount(where, param) {
  return db
    .prepare(
      `SELECT a.*, c.name AS club_name FROM club_account a
       JOIN club c ON c.id = a.club_id WHERE ${where}`
    )
    .get(param);
}

/**
 * 登录。username 可以是账号名，也可以是社团名（对中文用户更友好）。
 * 也支持直接传 clubId + password（前端"选择社团 + 输密码"表单）。
 */
export function login({ username = '', password = '', clubId = '' } = {}) {
  const pwd = String(password || '');
  if (!pwd) throw badRequest('请输入密码');

  const key = String(username || '').trim();
  if (!key && !clubId) throw badRequest('请输入账号或选择社团');

  let acc = null;
  if (clubId) {
    // 指定社团：取该社团的 owner 账号（社长入口）
    acc = loadAccount(
      "a.club_id = ? AND a.role = 'owner' AND a.is_active = 1 ORDER BY a.created_at LIMIT 1",
      clubId
    );
    if (!acc) {
      // 没有 owner 就退而取任意可用账号
      acc = loadAccount('a.club_id = ? AND a.is_active = 1 ORDER BY a.created_at LIMIT 1', clubId);
    }
  } else {
    acc = loadAccount('a.username = ?', key);
    if (!acc) {
      // 允许用社团名登录（取该社团的 owner）
      acc = loadAccount(
        "c.name = ? AND a.role = 'owner' AND a.is_active = 1 ORDER BY a.created_at LIMIT 1",
        key
      );
    }
  }

  if (!acc || !acc.is_active) throw unauthorized('账号不存在或已停用');
  if (!verifyPassword(pwd, acc.salt, acc.password_hash)) throw unauthorized('密码不正确');

  const now = nowIso();
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();

  db.prepare(
    'INSERT INTO club_session (token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(token, acc.id, now, expiresAt);
  db.prepare('UPDATE club_account SET last_login_at = ?, updated_at = ? WHERE id = ?')
    .run(now, now, acc.id);

  return { token, expiresAt, account: publicAccount({ ...acc, last_login_at: now }) };
}

/** 由 token 解析当前登录者；过期则清理并返回 null */
export function resolveSession(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.token, s.expires_at, a.*, c.name AS club_name
       FROM club_session s
       JOIN club_account a ON a.id = s.account_id
       JOIN club c ON c.id = a.club_id
       WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM club_session WHERE token = ?').run(token);
    return null;
  }
  if (!row.is_active) return null;

  return publicAccount(row);
}

export function logout(token) {
  if (token) db.prepare('DELETE FROM club_session WHERE token = ?').run(token);
  return { loggedOut: true };
}

/** 清理所有过期会话（启动时调用一次即可） */
export function purgeExpiredSessions() {
  const r = db.prepare('DELETE FROM club_session WHERE expires_at < ?').run(nowIso());
  return r.changes;
}

/* ------------------------------------------------------------------ */
/* 账号管理（仅 owner）                                                */
/* ------------------------------------------------------------------ */

export function listAccounts(clubId, requester) {
  assertSameClub(clubId, requester);
  return db
    .prepare(
      `SELECT a.*, c.name AS club_name FROM club_account a
       JOIN club c ON c.id = a.club_id WHERE a.club_id = ?
       ORDER BY CASE a.role WHEN 'owner' THEN 0 WHEN 'interviewer' THEN 1 ELSE 2 END, a.created_at`
    )
    .all(clubId)
    .map((r) => ({ ...publicAccount(r), createdAt: r.created_at, isActive: r.is_active === 1 }));
}

export function createAccount(clubId, body, requester) {
  assertSameClub(clubId, requester);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username) throw badRequest('账号名不能为空');
  if (password.length < 6) throw badRequest('密码至少 6 位');
  if (!ROLES.includes(body.role || 'interviewer')) {
    throw badRequest(`非法的角色，允许：${ROLES.join(' / ')}`);
  }
  if (db.prepare('SELECT id FROM club_account WHERE username = ?').get(username)) {
    throw badRequest('账号名已存在');
  }

  const { salt, hash } = hashPassword(password);
  const now = nowIso();
  const id = genId('acct');
  db.prepare(
    `INSERT INTO club_account (id, club_id, username, password_hash, salt, display_name,
                               role, is_active, created_at, updated_at)
     VALUES (@id, @clubId, @username, @hash, @salt, @displayName, @role, 1, @createdAt, @updatedAt)`
  ).run({
    id,
    clubId,
    username,
    hash,
    salt,
    displayName: body.displayName || username,
    role: body.role || 'interviewer',
    createdAt: now,
    updatedAt: now,
  });
  return publicAccount(loadAccount('a.id = ?', id));
}

export function updateAccount(id, body, requester) {
  const acc = db.prepare('SELECT * FROM club_account WHERE id = ?').get(id);
  if (!acc) throw notFound('账号不存在');
  assertSameClub(acc.club_id, requester);

  const sets = [];
  const params = { id, updatedAt: nowIso() };

  if (body.displayName !== undefined) { sets.push('display_name = @displayName'); params.displayName = body.displayName; }
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) throw badRequest(`非法的角色，允许：${ROLES.join(' / ')}`);
    if (acc.role === 'owner' && body.role !== 'owner') assertNotLastOwner(acc.club_id, id);
    sets.push('role = @role'); params.role = body.role;
  }
  if (body.isActive !== undefined) {
    const active = body.isActive ? 1 : 0;
    if (!active && acc.role === 'owner') assertNotLastOwner(acc.club_id, id);
    sets.push('is_active = @isActive'); params.isActive = active;
  }
  if (body.password) {
    if (String(body.password).length < 6) throw badRequest('密码至少 6 位');
    const { salt, hash } = hashPassword(body.password);
    sets.push('password_hash = @hash', 'salt = @salt');
    params.hash = hash; params.salt = salt;
    // 改密后强制下线该账号所有会话
    db.prepare('DELETE FROM club_session WHERE account_id = ?').run(id);
  }

  if (sets.length === 0) return publicAccount(loadAccount('a.id = ?', id));
  db.prepare(`UPDATE club_account SET ${sets.join(', ')}, updated_at = @updatedAt WHERE id = @id`).run(params);
  return publicAccount(loadAccount('a.id = ?', id));
}

export function deleteAccount(id, requester) {
  const acc = db.prepare('SELECT * FROM club_account WHERE id = ?').get(id);
  if (!acc) throw notFound('账号不存在');
  assertSameClub(acc.club_id, requester);
  if (acc.role === 'owner') assertNotLastOwner(acc.club_id, id);
  if (requester && requester.id === id) throw badRequest('不能删除自己正在使用的账号');
  db.prepare('DELETE FROM club_account WHERE id = ?').run(id);
  return { id, deleted: true };
}

/** 自己改自己的密码（任何角色都可用） */
export function changeOwnPassword(accountId, { oldPassword, newPassword } = {}) {
  const acc = db.prepare('SELECT * FROM club_account WHERE id = ?').get(accountId);
  if (!acc) throw notFound('账号不存在');
  if (!verifyPassword(oldPassword || '', acc.salt, acc.password_hash)) {
    throw badRequest('原密码不正确');
  }
  if (String(newPassword || '').length < 6) throw badRequest('新密码至少 6 位');
  const { salt, hash } = hashPassword(newPassword);
  db.prepare('UPDATE club_account SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?')
    .run(hash, salt, nowIso(), accountId);
  db.prepare('DELETE FROM club_session WHERE account_id = ?').run(accountId);
  return { changed: true };
}

/* ------------------------------------------------------------------ */
/* 内部校验                                                            */
/* ------------------------------------------------------------------ */

function assertSameClub(clubId, requester) {
  if (!requester) throw unauthorized();
  if (requester.clubId !== clubId) {
    throw forbidden('只能管理自己所属社团的账号');
  }
}

/** 保证社团始终至少留一个 owner，避免把自己锁死在门外 */
function assertNotLastOwner(clubId, excludeId) {
  const others = db
    .prepare(
      "SELECT COUNT(*) AS c FROM club_account WHERE club_id = ? AND role = 'owner' AND is_active = 1 AND id != ?"
    )
    .get(clubId, excludeId).c;
  if (others === 0) throw badRequest('每个社团必须保留至少一个启用状态的社长账号');
}

/* ------------------------------------------------------------------ */
/* 首次播种：给还没有账号的社团建一个 owner 账号，随机密码写入本地文件  */
/* ------------------------------------------------------------------ */

export function ensureSeedAccounts({ quiet = false } = {}) {
  const clubs = db
    .prepare(
      `SELECT c.id, c.name FROM club c
       WHERE NOT EXISTS (SELECT 1 FROM club_account a WHERE a.club_id = c.id)`
    )
    .all();
  if (clubs.length === 0) return [];

  const created = [];
  const now = nowIso();
  const insert = db.prepare(
    `INSERT INTO club_account (id, club_id, username, password_hash, salt, display_name,
                               role, is_active, created_at, updated_at)
     VALUES (@id, @clubId, @username, @hash, @salt, @displayName, 'owner', 1, @createdAt, @updatedAt)`
  );

  const run = db.transaction(() => {
    for (const club of clubs) {
      const password = randomBytes(6).toString('base64url'); // 8 位可读随机口令
      const username = `owner_${club.id.slice(-6)}`;
      const { salt, hash } = hashPassword(password);
      insert.run({
        id: genId('acct'),
        clubId: club.id,
        username,
        hash,
        salt,
        displayName: `${club.name}·社长`,
        createdAt: now,
        updatedAt: now,
      });
      created.push({ clubId: club.id, clubName: club.name, username, password });
    }
  });
  run();

  // 初始口令只写本地 data 目录（该目录已被 .gitignore 忽略，不会进仓库）
  try {
    const dataDir = path.resolve(__dirname, '../../data');
    fs.mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, 'initial-accounts.txt');
    const lines = [
      '# 社团端初始账号（首次自动生成，仅本机可见，未入库）',
      `# 生成时间：${now}`,
      '# 请登录后立刻在「我的社团 → 账号与权限」里修改密码',
      '',
      ...created.map((c) => `${c.clubName}\t账号=${c.username}\t密码=${c.password}`),
      '',
    ];
    fs.appendFileSync(file, lines.join('\n'), 'utf8');
  } catch (e) {
    console.warn('[auth] 未能写入初始账号文件:', e.message);
  }

  if (!quiet) {
    console.log(`[auth] 已为 ${created.length} 个社团创建初始社长账号：`);
    for (const c of created) {
      console.log(`       ${c.clubName}  账号 ${c.username}  密码 ${c.password}`);
    }
    console.log('       （同一份信息已写入 server/data/initial-accounts.txt）');
  }

  return created;
}
