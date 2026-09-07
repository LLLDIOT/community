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
