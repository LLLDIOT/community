import { Router } from 'express';
import * as clubService from '../services/clubService.js';
import { ok } from '../utils/respond.js';
import { parsePage } from '../utils/respond.js';
import { requireCapability, requireOwnClub } from '../middlewares/clubAuth.js';

const router = Router();

// GET /api/v1/clubs —— 列表（guest 可见）
router.get('/', (req, res) => {
  const { keyword = '', category = '' } = req.query;
  const { page, pageSize } = parsePage(req.query);
  const data = clubService.listClubs({ keyword, category, page, pageSize });
  ok(res, data);
});

// GET /api/v1/clubs/:id —— 详情（含批次+岗位）
router.get('/:id', (req, res) => {
  ok(res, clubService.getClubDetail(req.params.id));
});

// POST /api/v1/clubs —— 创建社团（自服务开通：成功后自动生成社长账号并一次性返回凭据）
// 公网部署建议设置环境变量 CLUB_CREATE_TOKEN，届时必须带上 X-Create-Token 才能创建
router.post('/', (req, res) => {
  const required = process.env.CLUB_CREATE_TOKEN || '';
  if (required) {
    const provided = req.headers['x-create-token'] || req.body?.createToken || '';
    if (provided !== required) {
      return res.status(403).json({ code: 40300, message: '创建社团需要正确的开通口令' });
    }
  }
  const result = clubService.createClubWithOwner(req.body || {});
  ok(res, result, 201);
});

// PUT /api/v1/clubs/:clubId/standard —— 修改信息录入标准与投递时间（需登录 + club:edit + 本社团）
// 必须注册在 '/:id' 之前，否则 'standard' 会被当成社团 id
router.put(
  '/:clubId/standard',
  requireCapability('club:edit'),
  requireOwnClub('clubId'),
  (req, res) => {
    ok(res, clubService.updateClubStandard(req.params.clubId, req.body || {}));
  }
);

// PUT /api/v1/clubs/:id —— 更新（需 club:edit + 本社团）
router.put('/:id', requireCapability('club:edit'), requireOwnClub('id'), (req, res) => {
  ok(res, clubService.updateClub(req.params.id, req.body || {}));
});

// PUT /api/v1/clubs/:id/visibility —— 上/下架（需 club:edit + 本社团）
router.put(
  '/:id/visibility',
  requireCapability('club:edit'),
  requireOwnClub('id'),
  (req, res) => {
    const visible = req.body?.isVisible === undefined ? true : Boolean(req.body.isVisible);
    ok(res, clubService.setVisibility(req.params.id, visible));
  }
);

// DELETE /api/v1/clubs/:id —— 删除（需 club:edit + 本社团）
// 注意：这会级联删掉该社团的批次/岗位/投递，所以必须校验归属
router.delete('/:id', requireCapability('club:edit'), requireOwnClub('id'), (req, res) => {
  ok(res, clubService.deleteClub(req.params.id));
});

export default router;
