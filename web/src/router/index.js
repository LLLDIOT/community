import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  {
    path: '/',
    component: () => import('../layout/MainLayout.vue'),
    children: [
      { path: '', redirect: '/dashboard' },
      /* ===== 数据看板 ===== */
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('../views/DashboardView.vue'),
        meta: { title: '招新数据看板', group: '数据看板' },
      },
      /* ===== 社团端（录入与管理） ===== */
      {
        path: 'clubs',
        name: 'clubs',
        component: () => import('../views/ClubListView.vue'),
        meta: { title: '社团管理', group: '社团端' },
      },
      {
        path: 'clubs/:id',
        name: 'clubDetail',
        component: () => import('../views/ClubDetailView.vue'),
        meta: { title: '社团详情', group: '社团端' },
      },
      {
        path: 'applications',
        name: 'applications',
        component: () => import('../views/ApplicationLibraryView.vue'),
        meta: { title: '简历库 / 归档', group: '社团端' },
      },
      {
        path: 'match',
        name: 'match',
        component: () => import('../views/MatchView.vue'),
        meta: { title: '智能匹配推荐', group: '社团端' },
      },
    ],
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · 社团招新系统` : '社团招新系统';
});

export default router;
