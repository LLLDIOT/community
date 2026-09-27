import { reactive, computed } from 'vue';
import { authApi } from '../api/index.js';
import { TOKEN_KEY } from '../api/client.js';

/**
 * 社团端登录态（极简 store，不引入 Pinia）
 *
 * 存什么：token（localStorage）+ 当前账号信息（内存，由 /auth/me 拉取）
 * 权限：account.capabilities 由后端下发，前端只用来隐藏按钮（真正的拦截在后端）
 */
const state = reactive({
  token: localStorage.getItem(TOKEN_KEY) || '',
  account: null,
  loading: false,
  initialized: false,
});

export const isLoggedIn = computed(() => Boolean(state.token && state.account));

/** 当前账号是否具备某能力（未登录一律 false） */
export function can(capability) {
  return Boolean(state.account?.capabilities?.includes(capability));
}

export const account = computed(() => state.account);

export async function init() {
  if (state.initialized) return state.account;
  state.loading = true;
  try {
    if (state.token) {
      state.account = await authApi.me();
    }
  } catch {
    // token 失效：拦截器已清理
    state.token = '';
    state.account = null;
  } finally {
    state.loading = false;
    state.initialized = true;
  }
  return state.account;
}

export async function login({ username, password, clubId }) {
  state.loading = true;
  try {
    const data = await authApi.login({ username, password, clubId });
    state.token = data.token;
    state.account = data.account;
    localStorage.setItem(TOKEN_KEY, data.token);
    state.initialized = true;
    return data.account;
  } finally {
    state.loading = false;
  }
}

export async function logout() {
  try {
    if (state.token) await authApi.logout();
  } catch {
    // 退出失败也要清本地态
  }
  state.token = '';
  state.account = null;
  localStorage.removeItem(TOKEN_KEY);
}

/** 刷新当前账号信息（改密码、改角色后调用） */
export async function refresh() {
  if (!state.token) return null;
  state.account = await authApi.me();
  return state.account;
}

// 拦截器发现 401 时广播 → 这里同步清空内存态
window.addEventListener('club-auth-expired', () => {
  state.token = '';
  state.account = null;
});

export const authState = state;
