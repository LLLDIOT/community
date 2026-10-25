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
        <el-menu-item index="/clusters">
          <el-icon><Connection /></el-icon>
          <span>候选人分组</span>
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

        <!-- 机器学习层状态：出问题时一眼看出是"模型没加载"还是"功能本身有问题" -->
        <el-tooltip :content="mlTooltip" placement="right">
          <div class="ml-badge" :class="mlClass" @click="openMlStatus">
            <span class="ml-dot" />
            {{ mlLabel }}
          </div>
        </el-tooltip>

        <a :href="studentUrl" target="_blank" rel="noopener" class="student-link">
          📱 学生投递端 ↗
        </a>
        <div v-if="studentUrlIsSeparate" class="student-hint-sm">独立站点，学生无需管理密码</div>
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
import { ElMessage, ElMessageBox } from 'element-plus';
import { isLoggedIn, account, init as initAuth, logout as doLogout } from '../stores/auth.js';
import { dictApi, mlApi } from '../api/index.js';
import LoginDialog from '../components/LoginDialog.vue';

const route = useRoute();
const loginVisible = ref(false);

/**
 * 学生投递端现在是**独立站点**（另一个端口/域名），不再挂在社团端路径下。
 * 地址由后端下发（可用 STUDENT_SITE_URL 指定域名），没拿到时退回旧的相对路径。
 */
const studentUrl = ref('/portal.html');
const studentUrlIsSeparate = ref(false);

/* ── 机器学习层状态 ── */
const ml = ref({ enabled: null, ready: false, model: '', dim: 0, matchMode: '', note: '', error: null });

const mlLabel = computed(() => {
  if (ml.value.enabled === null) return 'ML 检测中…';
  if (!ml.value.enabled) return 'ML 已关闭';
  return ml.value.ready ? '语义匹配已启用' : '规则模式（模型未就绪）';
});

const mlClass = computed(() => {
  if (ml.value.enabled === null) return 'ml-wait';
  if (!ml.value.enabled) return 'ml-off';
  return ml.value.ready ? 'ml-on' : 'ml-warn';
});

const mlTooltip = computed(() => {
  if (ml.value.enabled === null) return '正在检测语义模型状态…';
  if (!ml.value.enabled) return 'ML_ENABLED=0，当前为纯规则匹配（字符串命中）';
  if (ml.value.ready) {
    return `${ml.value.model}（${ml.value.dim} 维）\n匹配模式：语义 + 技能标签融合\n点击查看详情`;
  }
  return `模型未就绪${ml.value.error ? `：${ml.value.error}` : ''}\n匹配已自动回退为规则模式，功能不受影响\n点击查看详情`;
});

async function loadMlStatus() {
  try {
    const st = await mlApi.status();
    ml.value = {
      enabled: Boolean(st?.enabled),
      ready: Boolean(st?.ready),
      model: st?.model || '',
      dim: st?.dim || 0,
      matchMode: st?.matchMode || '',
      note: st?.note || '',
      error: st?.error || null,
    };
  } catch {
    ml.value = { enabled: false, ready: false, model: '', dim: 0, matchMode: '', note: '', error: '状态获取失败' };
  }
}

async function openMlStatus() {
  await loadMlStatus();
  const m = ml.value;
  const lines = [
    `状态：${m.enabled ? (m.ready ? '已就绪' : '未就绪（已回退规则模式）') : '已关闭（ML_ENABLED=0）'}`,
    m.model ? `模型：${m.model}（${m.dim} 维）` : '',
    m.matchMode ? `匹配模式：${m.matchMode === 'semantic' ? '语义 + 标签融合' : '规则（字符串命中）'}` : '',
    m.note ? `\n${m.note}` : '',
    m.error ? `\n错误：${m.error}` : '',
    '\n说明：模型不可用时系统会自动降级，所有功能仍可正常使用。',
  ].filter(Boolean);
  ElMessageBox.alert(lines.join('\n'), '机器学习层状态', {
    confirmButtonText: '知道了',
    customStyle: { whiteSpace: 'pre-line' },
  }).catch(() => {});
}

async function loadSiteInfo() {
  try {
    const d = await dictApi.get();
    if (d?.studentSiteUrl) {
      studentUrl.value = d.studentSiteUrl;
      studentUrlIsSeparate.value = Boolean(d.studentSiteEnabled);
    }
  } catch {
    /* 拿不到就沿用相对路径 */
  }
}

const activeMenu = computed(() => {
  if (route.path.startsWith('/square')) return '/square';
  if (route.path.startsWith('/interview')) return '/interview';
  if (route.path.startsWith('/clubs')) return '/clubs';
  if (route.path.startsWith('/applications')) return '/applications';
  if (route.path.startsWith('/clusters')) return '/clusters';
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
  loadSiteInfo();
  loadMlStatus();
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
.student-hint-sm {
  color: rgba(255, 255, 255, 0.35);
  font-size: 11px;
  text-align: center;
  margin-top: 4px;
}

/* ── 机器学习层状态徽标 ── */
.ml-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.6);
  transition: background 0.15s;
}
.ml-badge:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.ml-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #909399;
  flex-shrink: 0;
}
.ml-on {
  color: #a8e6a3;
}
.ml-on .ml-dot {
  background: #67c23a;
  box-shadow: 0 0 6px #67c23a;
}
.ml-warn {
  color: #f0c78a;
}
.ml-warn .ml-dot {
  background: #e6a23c;
}
.ml-off .ml-dot {
  background: #606266;
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
