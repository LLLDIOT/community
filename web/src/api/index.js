import { http } from './client.js';
import client from './client.js';

/* ---------- 社团 ---------- */
export const clubApi = {
  list: (params) => http.get('/clubs', params),
  detail: (id) => http.get(`/clubs/${id}`),
  create: (data) => http.post('/clubs', data),
  update: (id, data) => http.put(`/clubs/${id}`, data),
  remove: (id) => http.delete(`/clubs/${id}`),
};

/* ---------- 招新批次 ---------- */
export const recruitmentApi = {
  list: (clubId, status = '') => http.get(`/clubs/${clubId}/recruitments`, status ? { status } : undefined),
  detail: (id) => http.get(`/recruitments/${id}`),
  create: (clubId, data) => http.post(`/clubs/${clubId}/recruitments`, data),
  update: (id, data) => http.put(`/recruitments/${id}`, data),
  setStatus: (id, status) => http.put(`/recruitments/${id}/status`, { status }),
  remove: (id) => http.delete(`/recruitments/${id}`),
};

/* ---------- 招新岗位 ---------- */
export const positionApi = {
  list: (recId) => http.get(`/recruitments/${recId}/positions`),
  create: (recId, data) => http.post(`/recruitments/${recId}/positions`, data),
  update: (id, data) => http.put(`/positions/${id}`, data),
  remove: (id) => http.delete(`/positions/${id}`),
};

/* ---------- 简历 ---------- */
export const resumeApi = {
  /** multipart 上传简历 */
  create: (formData) =>
    client.post('/resumes', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
};

/* ---------- 投递 Application ---------- */
export const applicationApi = {
  create: (positionId, data) => http.post(`/positions/${positionId}/applications`, data),
  listByPosition: (positionId, params) => http.get(`/positions/${positionId}/applications`, params),
  listByClub: (clubId, params) => http.get(`/clubs/${clubId}/applications`, params),
  detail: (id) => http.get(`/applications/${id}`),
  transition: (id, status) => http.patch(`/applications/${id}/status`, { status }),
  archive: (id, archived) => http.patch(`/applications/${id}/archive`, { archived }),
  update: (id, data) => http.put(`/applications/${id}`, data),
  remove: (id) => http.delete(`/applications/${id}`),
  exportUrl: (clubId, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return `/api/v1/clubs/${clubId}/applications/export${qs ? `?${qs}` : ''}`;
  },
};

/* ---------- 字典 ---------- */
export const dictApi = {
  get: () => http.get('/dict'),
};

/* ---------- 数据看板 ---------- */
export const dashboardApi = {
  get: (params) => http.get('/dashboard', params),
};

/* ---------- 智能匹配 ---------- */
export const matchApi = {
  /** 简历 → 推荐岗位（跨社团匹配度排序） */
  matchTop: (resumeId, params) => http.get(`/resumes/${resumeId}/match-top`, params),
  /** 社团侧：未录取投递者与 open 岗位的高分组合 */
  matchApplicants: (clubId, params) => http.get(`/clubs/${clubId}/match-applicants`, params),
};

/* ---------- 社团端账号（登录与按人权限） ---------- */
export const authApi = {
  login: (data) => http.post('/auth/login', data),
  logout: () => http.post('/auth/logout', {}),
  me: () => http.get('/auth/me'),
  changePassword: (data) => http.patch('/auth/password', data),
  /** 社团账号管理（需 account:manage） */
  listAccounts: (clubId) => http.get(`/clubs/${clubId}/accounts`),
  createAccount: (clubId, data) => http.post(`/clubs/${clubId}/accounts`, data),
  updateAccount: (id, data) => http.put(`/accounts/${id}`, data),
  removeAccount: (id) => http.delete(`/accounts/${id}`),
};

/* ---------- 招新广场（双面板：全校总览 + 单社团招新情况） ---------- */
export const squareApi = {
  clubs: (params) => http.get('/square/clubs', params),
  categories: () => http.get('/square/categories'),
  clubDetail: (id, params) => http.get(`/square/clubs/${id}`, params),
};

/* ---------- 面试决策：录用 / 调剂 / 候补序号 / 递补 ---------- */
export const decisionApi = {
  /** 面试与录用工作台（分列 + 岗位进度 + 汇总） */
  board: (clubId, params) => http.get(`/clubs/${clubId}/interview-board`, params),
  detail: (applicationId) => http.get(`/applications/${applicationId}/decision`),
  /** 标注结论：decision = '' | hired | waitlist | adjust | reject */
  set: (applicationId, data) => http.patch(`/applications/${applicationId}/decision`, data),
  /** 调剂建议（技能匹配推荐目标岗位） */
  adjustSuggestions: (applicationId) => http.get(`/applications/${applicationId}/adjust-suggestions`),
  /** 执行调剂：目标岗位建投递 + 原岗标注 */
  adjust: (applicationId, data) => http.post(`/applications/${applicationId}/adjust`, data),
  waitlist: (positionId) => http.get(`/positions/${positionId}/waitlist`),
  /** 递补：候补队首提升为录用 */
  promoteWaitlist: (positionId, data = {}) => http.post(`/positions/${positionId}/promote-waitlist`, data),
  progress: (positionId) => http.get(`/positions/${positionId}/progress`),
};

/* ---------- 我的社团：录入标准与投递时间（需 club:edit） ---------- */
export const clubStandardApi = {
  update: (clubId, data) => http.put(`/clubs/${clubId}/standard`, data),
};
