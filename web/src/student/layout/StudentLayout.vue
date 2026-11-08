<template>
  <div class="layout">
    <el-aside width="210px" class="layout-aside">
      <div class="logo">
        社团招新系统
        <small>学生投递端</small>
      </div>

      <el-menu :default-active="activeMenu" router class="layout-menu">
        <el-menu-item index="/clubs">
          <el-icon><OfficeBuilding /></el-icon>
          <span>社团招新</span>
        </el-menu-item>
        <el-menu-item index="/progress">
          <el-icon><Tickets /></el-icon>
          <span>我的投递</span>
        </el-menu-item>
        <el-menu-item index="/guide">
          <el-icon><InfoFilled /></el-icon>
          <span>投递说明</span>
        </el-menu-item>
      </el-menu>

      <div class="aside-foot">
        <div class="badge"><span class="dot" />公开站点 · 无需登录</div>
        <div v-if="profile.name" class="me">
          <div class="me-name">{{ profile.name }}</div>
          <div class="me-sub">{{ profile.college || '—' }} · {{ profile.major || '—' }}</div>
        </div>
        <div v-else class="me">
          <div class="me-sub">尚未填写学生资料</div>
        </div>
        <el-button size="small" class="profile-btn" @click="profileVisible = true">
          <el-icon><User /></el-icon>&nbsp;学生资料
        </el-button>
        <div class="rec">本地记录 {{ records.length }} 条</div>
      </div>
    </el-aside>

    <el-container>
      <el-header class="layout-header">
        <el-breadcrumb separator="/">
          <el-breadcrumb-item :to="{ path: '/clubs' }">社团招新</el-breadcrumb-item>
          <el-breadcrumb-item v-if="route.meta.group">{{ route.meta.group }}</el-breadcrumb-item>
          <el-breadcrumb-item>{{ route.meta.title || '学生投递端' }}</el-breadcrumb-item>
        </el-breadcrumb>

        <div class="header-right">
          <el-tag v-if="!profileReady" type="warning" effect="plain" size="small">
            填写学生资料后投递可自动填充
          </el-tag>
          <el-button type="primary" plain size="small" @click="profileVisible = true">
            <el-icon><EditPen /></el-icon>&nbsp;学生资料
          </el-button>
        </div>
      </el-header>

      <el-main class="layout-main">
        <router-view />
      </el-main>
    </el-container>

    <ProfileDrawer v-model="profileVisible" />
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { profile, records, loadProfile, loadRecords, profileReady } from '../store.js';
import ProfileDrawer from '../components/ProfileDrawer.vue';

const route = useRoute();
const profileVisible = ref(false);

const activeMenu = computed(() => {
  if (route.path.startsWith('/progress')) return '/progress';
  if (route.path.startsWith('/guide')) return '/guide';
  return '/clubs';
});

onMounted(() => {
  loadProfile();
  loadRecords();
});
</script>

<style scoped>
.layout {
  display: flex;
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
  line-height: 1.25;
  padding: 12px 16px 0;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.5px;
  box-sizing: border-box;
}
.logo small {
  display: block;
  font-size: 11px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.45);
  margin-top: 3px;
  letter-spacing: 0;
}
.layout-menu {
  border-right: none;
  background: transparent;
  flex: 1;
}
.layout-menu :deep(.el-menu-item) {
  color: rgba(255, 255, 255, 0.75);
  height: 46px;
  line-height: 46px;
}
.layout-menu :deep(.el-menu-item:hover) {
  background: #001f38;
  color: #fff;
}
.layout-menu :deep(.el-menu-item.is-active) {
  background: #001f38;
  color: #fff;
  border-left: 3px solid #4f8cff;
}
.aside-foot {
  padding: 12px 14px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: #a8e6a3;
  margin-bottom: 10px;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #67c23a;
  box-shadow: 0 0 6px #67c23a;
}
.me {
  margin-bottom: 10px;
}
.me-name {
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}
.me-sub {
  color: rgba(255, 255, 255, 0.45);
  font-size: 11.5px;
  margin-top: 2px;
}
.profile-btn {
  width: 100%;
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.16);
  color: #fff;
}
.profile-btn:hover {
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.28);
  color: #fff;
}
.rec {
  color: rgba(255, 255, 255, 0.3);
  font-size: 11px;
  text-align: center;
  margin-top: 8px;
}
.layout-header {
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 21, 41, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  z-index: 10;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.layout-main {
  background: #f4f6f9;
  padding: 18px;
  overflow-y: auto;
}
@media (max-width: 900px) {
  .layout-aside {
    width: 64px !important;
  }
  .logo,
  .layout-menu :deep(.el-menu-item span),
  .aside-foot {
    display: none;
  }
}
</style>
