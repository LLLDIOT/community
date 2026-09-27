import { Router } from 'express';
import * as authService from '../services/authService.js';
import { ok } from '../utils/respond.js';
import { readToken, requireLogin, requireCapability } from '../middlewares/clubAuth.js';

const router = Router();

/**
 * 社团端账号路由（挂载于 /api/v1）：
 *  POST   /auth/login                  —— 登录（账号名 或 社团名 或 clubId + 密码）
 *  POST   /auth/logout                 —— 退出（销毁当前 token）
 *  GET    /auth/me                     —— 当前登录者（含角色与能力清单）
 *  PATCH  /auth/password               —— 修改自己的密码
 *  GET    /clubs/:clubId/accounts      —— 本社团账号列表（需 account:manage）
 *  POST   /clubs/:clubId/accounts      —— 新建账号（需 account:manage）
 *  PUT    /accounts/:id                —— 改角色/停用/重置密码（需 account:manage）
 *  DELETE /accounts/:id                —— 删除账号（需 account:manage）
 */

router.post('/auth/login', (req, res) => {
  const { username = '', password = '', clubId = '' } = req.body || {};
  ok(res, authService.login({ username, password, clubId }));
});

router.post('/auth/logout', (req, res) => {
  ok(res, authService.logout(readToken(req)));
});

router.get('/auth/me', requireLogin, (req, res) => {
  ok(res, req.account);
});

router.patch('/auth/password', requireLogin, (req, res) => {
  const { oldPassword = '', newPassword = '' } = req.body || {};
  ok(res, authService.changeOwnPassword(req.account.id, { oldPassword, newPassword }));
});

router.get('/clubs/:clubId/accounts', requireCapability('account:manage'), (req, res) => {
  ok(res, authService.listAccounts(req.params.clubId, req.account));
});

router.post('/clubs/:clubId/accounts', requireCapability('account:manage'), (req, res) => {
  ok(res, authService.createAccount(req.params.clubId, req.body || {}, req.account), 201);
});

router.put('/accounts/:id', requireCapability('account:manage'), (req, res) => {
  ok(res, authService.updateAccount(req.params.id, req.body || {}, req.account));
});

router.delete('/accounts/:id', requireCapability('account:manage'), (req, res) => {
  ok(res, authService.deleteAccount(req.params.id, req.account));
});

export default router;
