<template>
  <el-container class="layout">
    <el-aside width="220px" class="layout-aside">
      <div class="logo">🎓 社团招新</div>

      <!-- 招新广场：双面板入口（全校总览 + 我的社团） -->
      <div class="menu-group">招新广场</div>
      <el-menu :default-active="activeMenu" router class="layout-menu">
        <el-menu-item index="/square">
          <el-icon><Grid /></el-icon>
          <span>招新广场</span>
        </el-menu-item>
      </el-menu>

      <!-- 功能分区：数据看板（统计查看） -->
      <div class="menu-group">数据看板</div>
      <el-menu :default-active="activeMenu" router class="layout-menu">
        <el-menu-item index="/dashboard">
          <el-icon><DataAnalysis /></el-icon>
          <span>招新数据看板</span>
        </el-menu-item>
      </el-menu>

      <!-- 功能分区：社团端（录入与管理） -->
      <div class="menu-group">社团端（录入与管理）</div>
      <el-menu :default-active="activeMenu" router class="layout-menu">
        <el-menu-item index="/interview">
          <el-icon><Suitcase /></el-icon>
          <span>面试与录用</span>
        </el-menu-item>
        <el-menu-item index="/clubs">
          <el-icon><OfficeBuilding /></el-icon>
          <span>社团管理</span>
        </el-menu-item>
        <el-menu-item index="/applications">
          <el-icon><Files /></el-icon>
          <span>简历库 / 归档</span>
        </el-menu-item>
        <el-menu-item index="/match">
          <el-icon><MagicStick /></el-icon>
          <span>智能匹配推荐</span>
        </el-menu-item>
      </el-menu>

      <!-- 底部：登录态 + 学生端入口 -->
      <div class="aside-foot">
        <div v-if="isLoggedIn" class="user-box">
          <div class="user-name">{{ account.clubName }}</div>
          <div class="user-role">
            <el-tag size="small" effect="dark" :type="account.role === 'owner' ? 'danger' : account.role === 'interviewer' ? 'warning' : 'info'">
              {{ account.roleLabel }}
            </el-tag>
            <el-button link size="small" class="logout-btn" @click="onLogout">退出</el-button>
          </div>
        </div>
        <el-button v-else type="primary" size="small" class="login-btn" @click="loginVisible = true">
          <el-icon><Key /></el-icon> 登录社团账号
        </el-button>

        <a href="/portal.html" target="_blank" rel="noopener" class="student-link">📱 学生投递端 ↗</a>
      </div>
    </el-aside>

    <el-container>
      <el-header class="layout-header">
        <el-breadcrumb separator="/">
          <el-breadcrumb-item :to="{ path: '/' }">首页</el-breadcrumb-item>
          <el-breadcrumb-item v-if="route.meta.group">{{ route.meta.group }}</el-breadcrumb-item>
          <el-breadcrumb-item>{{ route.meta.title || '社团招新系统' }}</el-breadcrumb-item>
        </el-breadcrumb>
      </el-header>
      <el-main class="layout-main">
        <router-view />
      </el-main>
    </el-container>

    <LoginDialog v-model="loginVisible" />
  </el-container>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { isLoggedIn, account, init as initAuth, logout as doLogout } from '../stores/auth.js';
import LoginDialog from '../components/LoginDialog.vue';

const route = useRoute();
const loginVisible = ref(false);

const activeMenu = computed(() => {
  if (route.path.startsWith('/square')) return '/square';
  if (route.path.startsWith('/interview')) return '/interview';
  if (route.path.startsWith('/clubs')) return '/clubs';
  if (route.path.startsWith('/applications')) return '/applications';
  if (route.path.startsWith('/match')) return '/match';
  if (route.path.startsWith('/dashboard')) return '/dashboard';
  return route.path;
});

async function onLogout() {
  await doLogout();
  ElMessage.success('已退出登录');
}

onMounted(() => {
  initAuth();
});
</script>

<style scoped>
.layout {
  height: 100vh;
}
.layout-aside {
  background: #001529;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.logo {
  height: 60px;
  line-height: 60px;
  text-align: center;
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  background: #002140;
  flex-shrink: 0;
}
.menu-group {
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
  padding: 14px 20px 4px;
}
.layout-menu {
  border-right: none;
  background: transparent;
}
.layout-menu :deep(.el-menu-item) {
  color: rgba(255, 255, 255, 0.7);
  height: 44px;
  line-height: 44px;
}
.layout-menu :deep(.el-menu-item.is-active) {
  color: #fff;
  background: #409eff;
}
.layout-menu :deep(.el-menu-item:hover) {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.aside-foot {
  margin-top: auto;
  padding: 14px 12px 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.user-box {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 10px 12px;
}
.user-name {
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-role {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.logout-btn {
  color: rgba(255, 255, 255, 0.55) !important;
  font-size: 12px;
}
.logout-btn:hover {
  color: #fff !important;
}
.login-btn {
  width: 100%;
}
.student-link {
  display: block;
  margin-top: 12px;
  color: #6ec1ff;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  text-align: center;
}
.student-link:hover {
  color: #fff;
}

.layout-header {
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 21, 41, 0.08);
  display: flex;
  align-items: center;
}
.layout-main {
  background: #f5f7fa;
  padding: 16px;
  overflow-y: auto;
}
</style>
