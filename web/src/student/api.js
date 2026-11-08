/**
 * 学生端 API —— 严格对应后端的 5 个白名单接口
 *
 * 服务端在白名单之外一律返回 404，所以这里不做任何"兜底重试"，
 * 少一个接口就是少一个泄露面。
 */
const BASE = '/api/v1';

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    /* 非 JSON 响应，交给下面的状态码判断 */
  }

  if (!res.ok || (json && json.code !== 0)) {
    const msg = (json && json.message) || `请求失败（HTTP ${res.status}）`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return json ? json.data : null;
}

/** ① 社团列表 */
export function listClubs({ keyword = '', category = '', page = 1, pageSize = 100 } = {}) {
  const qs = new URLSearchParams();
  qs.set('page', String(page));
  qs.set('pageSize', String(pageSize));
  if (keyword) qs.set('keyword', keyword);
  if (category) qs.set('category', category);
  return request(`/clubs?${qs.toString()}`);
}

/** ② 社团详情（含批次与岗位） */
export function getClub(clubId) {
  return request(`/clubs/${clubId}`);
}

/** ③ 建简历 */
export function createResume(body) {
  return request('/resumes', { method: 'POST', body });
}

/** ④ 投递到岗位 */
export function createApplication(positionId, body) {
  return request(`/positions/${positionId}/applications`, { method: 'POST', body });
}

/** ⑤ 查自己那条投递的进度 */
export function getApplication(applicationId) {
  return request(`/applications/${applicationId}`);
}

/** 状态文案，与学生端展示一致 */
export const STATUS_LABEL = {
  new: '已送达',
  screening: '筛选中',
  interviewing: '面试中',
  admitted: '已录取',
  rejected: '未通过',
  archived: '已归档',
  unknown: '已失效',
};

export const STATUS_TONE = {
  new: 'info',
  screening: 'warning',
  interviewing: 'primary',
  admitted: 'success',
  rejected: 'danger',
  archived: 'info',
  unknown: 'info',
};

/** 社团分类 */
export const CATEGORIES = [
  { value: 'technical', label: '科技类' },
  { value: 'organizing', label: '组织类' },
  { value: 'artistic', label: '文艺类' },
  { value: 'sports', label: '体育类' },
  { value: 'academic', label: '学术类' },
  { value: 'service', label: '公益类' },
  { value: 'other', label: '其他' },
];

export const CATEGORY_ICON = {
  technical: '💻', organizing: '📋', artistic: '🎭',
  sports: '🏀', academic: '📚', service: '🤝', other: '🎪',
};

export function categoryLabel(v) {
  const hit = CATEGORIES.find((c) => c.value === v);
  return hit ? hit.label : (v || '其他');
}
