<template>
  <el-container class="layout">
    <el-aside width="220px" class="layout-aside">
      <div class="logo">🎓 社团招新</div>

      <!-- 功能分区：社团端（录入与管理） / 数据看板（统计查看） -->
      <div class="menu-group">数据看板</div>
      <el-menu :default-active="activeMenu" router class="layout-menu">
        <el-menu-item index="/dashboard">
          <el-icon><DataAnalysis /></el-icon>
          <span>招新数据看板</span>
        </el-menu-item>
      </el-menu>

      <div class="menu-group">社团端（录入与管理）</div>
      <el-menu :default-active="activeMenu" router class="layout-menu">
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
  </el-container>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const activeMenu = computed(() => {
  if (route.path.startsWith('/clubs')) return '/clubs';
  if (route.path.startsWith('/applications')) return '/applications';
  if (route.path.startsWith('/match')) return '/match';
  if (route.path.startsWith('/dashboard')) return '/dashboard';
  return route.path;
});
</script>

<style scoped>
.layout {
  height: 100vh;
}
.layout-aside {
  background: #001529;
  overflow-y: auto;
}
.logo {
  height: 60px;
  line-height: 60px;
  text-align: center;
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  background: #002140;
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
}
.layout-menu :deep(.el-menu-item.is-active) {
  color: #fff;
  background: #409eff;
}
.layout-menu :deep(.el-menu-item:hover) {
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
