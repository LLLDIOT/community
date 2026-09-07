import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  {
    path: '/',
    component: () => import('../layout/MainLayout.vue'),
    children: [
      { path: '', redirect: '/clubs' },
      {
        path: 'clubs',
        name: 'clubs',
        component: () => import('../views/ClubListView.vue'),
        meta: { title: '社团管理', menu: true },
      },
      {
        path: 'clubs/:id',
        name: 'clubDetail',
        component: () => import('../views/ClubDetailView.vue'),
        meta: { title: '社团详情' },
      },
      {
        path: 'applications',
        name: 'applications',
        component: () => import('../views/ApplicationLibraryView.vue'),
        meta: { title: '简历库', menu: true },
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
