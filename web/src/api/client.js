import axios from 'axios';
import { ElMessage } from 'element-plus';

/**
 * 统一 axios 实例：
 * - baseURL /api/v1（dev 由 vite proxy 转发到 3000）
 * - 请求拦截：带上社团端登录 token（自定义头 X-Club-Token，避免与 Basic Auth 的 Authorization 打架）
 * - 响应拦截：code !== 0 时提示错误并 reject
 */
export const TOKEN_KEY = 'community.club.token';

const client = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers = config.headers || {};
    config.headers['X-Club-Token'] = token;
  }
  return config;
});

client.interceptors.response.use(
  (resp) => {
    const body = resp.data;
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 0) return body.data;
      ElMessage.error(body.message || '请求失败');
      return Promise.reject(new Error(body.message || '请求失败'));
    }
    return body;
  },
  (error) => {
    const status = error.response?.status;
    const msg =
      error.response?.data?.message || error.message || '网络错误，请稍后再试';

    // 401 = 登录失效：清掉本地 token 并广播，让界面回到未登录态
    if (status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      window.dispatchEvent(new CustomEvent('club-auth-expired'));
    }
    ElMessage.error(msg);
    return Promise.reject(error);
  }
);

/** 便捷封装 */
export const http = {
  get: (url, params) => client.get(url, { params }),
  post: (url, data) => client.post(url, data),
  put: (url, data) => client.put(url, data),
  patch: (url, data) => client.patch(url, data),
  delete: (url) => client.delete(url),
};

export default client;
