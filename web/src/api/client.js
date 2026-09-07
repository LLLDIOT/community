import axios from 'axios';
import { ElMessage } from 'element-plus';

/**
 * 统一 axios 实例：
 * - baseURL /api/v1（dev 由 vite proxy 转发到 3000）
 * - 响应拦截：code !== 0 时提示错误并 reject
 */
const client = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
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
    const msg =
      error.response?.data?.message || error.message || '网络错误，请稍后再试';
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
