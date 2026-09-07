<template>
  <el-container class="layout">
    <el-aside width="220px" class="layout-aside">
      <div class="logo">🎓 社团招新</div>
      <el-menu :default-active="activeMenu" router class="layout-menu">
        <el-menu-item index="/clubs">
          <el-icon><OfficeBuilding /></el-icon>
          <span>社团管理</span>
        </el-menu-item>
        <el-menu-item index="/applications">
          <el-icon><Files /></el-icon>
          <span>简历库</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="layout-header">
        <span class="header-title">{{ route.meta.title || '社团招新系统' }}</span>
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
  return route.path;
});
</script>

<style scoped>
.layout {
  height: 100vh;
}
.layout-aside {
  background: #001529;
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
.header-title {
  font-size: 16px;
  font-weight: 600;
}
.layout-main {
  background: #f5f7fa;
  padding: 16px;
  overflow-y: auto;
}
</style>
