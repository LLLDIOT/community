import { createRouter, createWebHistory } from 'vue-router';

/**
 * 学生端路由
 *
 * 与社团端一致：使用 history 模式，服务端对所有非 /api 路径回落到 student.html
 * （见 server/src/apps/studentApp.js）。
 */
const routes = [
  { path: '/', redirect: '/clubs' },
  {
    path: '/',
    component: () => import('./layout/StudentLayout.vue'),
    children: [
      {
        path: 'clubs',
        name: 'clubs',
        component: () => import('./views/ClubListView.vue'),
        meta: { title: '社团招新', group: '学生投递' },
      },
      {
        path: 'clubs/:id',
        name: 'club-detail',
        component: () => import('./views/ClubDetailView.vue'),
        meta: { title: '社团详情', group: '学生投递' },
      },
      {
        path: 'progress',
        name: 'progress',
        component: () => import('./views/ProgressView.vue'),
        meta: { title: '我的投递', group: '学生投递' },
      },
      {
        path: 'guide',
        name: 'guide',
        component: () => import('./views/GuideView.vue'),
        meta: { title: '投递说明', group: '学生投递' },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/clubs' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · 社团招新（学生端）` : '社团招新 · 学生投递端';
});

export default router;
