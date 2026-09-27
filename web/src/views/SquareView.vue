<template>
  <div class="square-page">
    <!-- ═══ 顶部概览 ═══ -->
    <div class="hero">
      <div class="hero-main">
        <h2>🏛️ 招新广场</h2>
        <p>左边看全校社团的招新情况与投递人数，右边管理你自己社团的招新标准。</p>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span class="num">{{ totals.clubs }}</span>
          <span class="lbl">社团</span>
        </div>
        <div class="hero-stat">
          <span class="num accent">{{ totals.openClubs }}</span>
          <span class="lbl">招新中</span>
        </div>
        <div class="hero-stat">
          <span class="num">{{ totals.headcount }}</span>
          <span class="lbl">开放名额</span>
        </div>
        <div class="hero-stat">
          <span class="num">{{ totals.applications }}</span>
          <span class="lbl">累计投递</span>
        </div>
      </div>
    </div>

    <div class="panels">
      <!-- ═══════════ 面板一：全校社团总览 ═══════════ -->
      <section class="panel panel-all">
        <header class="panel-head">
          <div class="panel-title">
            <el-icon><Grid /></el-icon>
            <span>全校社团总览</span>
            <el-tag size="small" type="info" round>{{ clubs.length }} 个</el-tag>
          </div>
          <div class="panel-tools">
            <el-input
              v-model="filter.keyword"
              placeholder="搜索社团 / 招新要求"
              clearable
              size="small"
              style="width: 180px"
              @keyup.enter="loadClubs"
              @clear="loadClubs"
            >
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-select v-model="filter.category" placeholder="类型" size="small" clearable style="width: 110px" @change="loadClubs">
              <el-option v-for="c in categories" :key="c.value" :label="categoryLabel(c.value)" :value="c.value" />
            </el-select>
            <el-select v-model="filter.stage" placeholder="阶段" size="small" clearable style="width: 110px" @change="loadClubs">
              <el-option label="招新中" value="open" />
              <el-option label="已截止/未开始" value="closed" />
            </el-select>
            <el-select v-model="filter.sort" size="small" style="width: 120px" @change="loadClubs">
              <el-option label="按投递人数" value="applications" />
              <el-option label="按社团规模" value="scale" />
              <el-option label="按名称" value="name" />
            </el-select>
          </div>
        </header>

        <div v-loading="loadingClubs" class="club-grid">
          <article
            v-for="c in clubs"
            :key="c.id"
            class="club-card"
            :class="{ mine: c.id === myClubId }"
            @click="openDetail(c)"
          >
            <div class="club-card-top">
              <span class="club-emoji">{{ categoryIcon(c.category) }}</span>
              <div class="club-meta">
                <div class="club-name">
                  {{ c.name }}
                  <el-tag v-if="c.id === myClubId" size="small" type="success" effect="dark" round>我的社团</el-tag>
                </div>
                <div class="club-sub">
                  {{ categoryLabel(c.category) }} · 规模 {{ c.scaleLabel || c.scale || '—' }}
                </div>
              </div>
              <el-tag :type="stageType(c.stage)" size="small" effect="light" round>{{ c.stageLabel }}</el-tag>
            </div>

            <p class="club-desc">{{ c.entryCriteria || c.description || '（暂未填写社团说明）' }}</p>

            <div class="club-metrics">
              <div class="metric">
                <span class="m-num">{{ c.stats.applicationCount }}</span>
                <span class="m-lbl">投递人数</span>
              </div>
              <div class="metric">
                <span class="m-num">{{ c.stats.openFilled }}/{{ c.stats.openHeadcount }}</span>
                <span class="m-lbl">已录/名额</span>
              </div>
              <div class="metric">
                <span class="m-num">{{ c.stats.positionCount }}</span>
                <span class="m-lbl">岗位数</span>
              </div>
            </div>

            <el-progress
              :percentage="Math.min(100, c.stats.fillRate)"
              :stroke-width="6"
              :show-text="false"
              :color="c.stats.fillRate >= 100 ? '#67c23a' : '#409eff'"
            />
            <div class="club-foot">
              <span>招满率 {{ c.stats.fillRate }}%</span>
              <span v-if="c.stats.waitlistCount" class="waitlist-hint">候补 {{ c.stats.waitlistCount }} 人</span>
              <span class="view-hint">点击查看招新情况 →</span>
            </div>
          </article>

          <el-empty v-if="!loadingClubs && clubs.length === 0" description="没有符合条件的社团" />
        </div>
      </section>

      <!-- ═══════════ 面板二：我的社团 ═══════════ -->
      <section class="panel panel-mine">
        <!-- 未登录 -->
        <div v-if="!isLoggedIn" class="mine-login">
          <div class="mine-login-icon">🔐</div>
          <h3>登录我的社团</h3>
          <p>登录后可修改本社团的<b>信息录入标准</b>与<b>投递时间</b>，并处理候选人的录用、调剂与候补。</p>
          <el-button type="primary" size="large" style="width: 100%" @click="loginVisible = true">
            登录社团账号
          </el-button>
          <div class="mine-login-hint">
            初始账号见 <code>server/data/initial-accounts.txt</code>
          </div>
        </div>

        <!-- 已登录 -->
        <template v-else>
          <header class="panel-head mine-head">
            <div class="panel-title">
              <el-icon><OfficeBuilding /></el-icon>
              <span>我的社团</span>
            </div>
            <el-dropdown @command="onUserCommand">
              <span class="user-chip">
                {{ account.clubName }} · {{ account.roleLabel }}
                <el-icon><ArrowDown /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="accounts" :disabled="!can('account:manage')">
                    <el-icon><UserFilled /></el-icon> 账号与权限
                  </el-dropdown-item>
                  <el-dropdown-item command="password"><el-icon><Key /></el-icon> 修改我的密码</el-dropdown-item>
                  <el-dropdown-item command="logout" divided><el-icon><SwitchButton /></el-icon> 退出登录</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </header>

          <div v-loading="loadingMine" class="mine-body">
            <!-- 本社团实况 -->
            <div class="mine-stats" v-if="myClub">
              <div class="stat-box">
                <span class="s-num">{{ myClub.stats.applicationCount }}</span>
                <span class="s-lbl">收到投递</span>
              </div>
              <div class="stat-box">
                <span class="s-num warn">{{ myClub.stats.pendingCount }}</span>
                <span class="s-lbl">待处理</span>
              </div>
              <div class="stat-box">
                <span class="s-num ok">{{ myClub.stats.admittedCount }}</span>
                <span class="s-lbl">已录用</span>
              </div>
              <div class="stat-box">
                <span class="s-num">{{ myClub.stats.waitlistCount }}</span>
                <span class="s-lbl">候补</span>
              </div>
            </div>

            <el-alert
              v-if="!can('club:edit')"
              type="warning"
              :closable="false"
              show-icon
              title="当前角色只能查看，不能修改社团标准"
              class="perm-alert"
            />

            <!-- 录入标准 -->
            <div class="mine-section">
              <div class="section-label">
                <el-icon><Document /></el-icon> 信息录入标准
                <el-tooltip content="告诉学生：投递时需要提交什么、达到什么条件" placement="top">
                  <el-icon class="help-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </div>
              <el-input
                v-model="stdForm.entryCriteria"
                type="textarea"
                :rows="5"
                :disabled="!can('club:edit')"
                placeholder="例如：需提交个人简历 + 作品集链接；GPA 3.0 以上；每周可投入 4 小时。"
              />
            </div>

            <!-- 投递时间 -->
            <div class="mine-section">
              <div class="section-label">
                <el-icon><Clock /></el-icon> 投递时间
                <el-tooltip content="留空表示不限制；批次上单独设置了时间时以批次为准" placement="top">
                  <el-icon class="help-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </div>
              <div class="time-row">
                <el-date-picker
                  v-model="stdForm.applyStartAt"
                  type="datetime"
                  placeholder="开始时间"
                  :disabled="!can('club:edit')"
                  value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]"
                  style="width: 100%"
                />
                <span class="tilde">~</span>
                <el-date-picker
                  v-model="stdForm.applyEndAt"
                  type="datetime"
                  placeholder="结束时间"
                  :disabled="!can('club:edit')"
                  value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]"
                  style="width: 100%"
                />
              </div>
              <div v-if="windowText" class="window-text">{{ windowText }}</div>
            </div>

            <el-button
              type="primary"
              :disabled="!can('club:edit')"
              :loading="savingStd"
              style="width: 100%"
              @click="saveStandard"
            >
              保存招新标准
            </el-button>

            <!-- 快捷入口 -->
            <div class="mine-actions">
              <el-button @click="$router.push('/interview')">
                <el-icon><Suitcase /></el-icon> 面试与录用工作台
              </el-button>
              <el-button @click="$router.push('/applications')">
                <el-icon><Files /></el-icon> 本社团简历库
              </el-button>
            </div>

            <!-- 岗位招满进度 -->
            <div class="mine-section" v-if="myClub?.recruitments?.length">
              <div class="section-label"><el-icon><TrendCharts /></el-icon> 岗位招满进度</div>
              <div v-for="rec in myClub.recruitments" :key="rec.id" class="rec-block">
                <div class="rec-title">
                  {{ rec.title }}
                  <el-tag size="small" :type="rec.status === 'open' ? 'success' : 'info'" effect="plain">
                    {{ recStatusLabel(rec.status) }}
                  </el-tag>
                </div>
                <div v-for="p in rec.positions" :key="p.id" class="pos-progress">
                  <div class="pos-line">
                    <span class="pos-name">{{ p.title }}</span>
                    <span class="pos-num">
                      {{ p.filled_count }}/{{ p.headcount }}
                      <span v-if="p.waitlist_count" class="pos-waitlist">候补{{ p.waitlist_count }}</span>
                    </span>
                  </div>
                  <el-progress
                    :percentage="p.headcount ? Math.min(100, Math.round((p.filled_count / p.headcount) * 100)) : 0"
                    :stroke-width="6"
                    :show-text="false"
                    :color="p.filled_count >= p.headcount ? '#67c23a' : '#e6a23c'"
                  />
                </div>
              </div>
            </div>
          </div>
        </template>
      </section>
    </div>

    <!-- ═══ 社团招新情况详情 ═══ -->
    <el-dialog
      v-model="detailVisible"
      :title="detail?.club?.name || '社团招新情况'"
      width="760px"
      top="6vh"
      @opened="chartReady = true"
      @closed="chartReady = false"
    >
      <div v-if="detail" v-loading="loadingDetail" class="detail-body">
        <div class="detail-head">
          <span class="club-emoji big">{{ categoryIcon(detail.club.category) }}</span>
          <div class="detail-head-meta">
            <div class="detail-name">
              {{ detail.club.name }}
              <el-tag :type="stageType(detail.stage)" size="small" round>{{ detail.stageLabel }}</el-tag>
            </div>
            <div class="detail-sub">
              {{ categoryLabel(detail.club.category) }} · 规模 {{ detail.club.scaleLabel || detail.club.scale || '—' }}
              <template v-if="detail.window?.startAt || detail.window?.endAt">
                · 投递时间 {{ fmt(detail.window.startAt) }} ~ {{ fmt(detail.window.endAt) }}
              </template>
            </div>
          </div>
        </div>

        <el-descriptions :column="4" border size="small" class="detail-desc">
          <el-descriptions-item label="累计投递">{{ detail.stats.applicationCount }}</el-descriptions-item>
          <el-descriptions-item label="待处理">{{ detail.stats.pendingCount }}</el-descriptions-item>
          <el-descriptions-item label="已录用">{{ detail.stats.admittedCount }}</el-descriptions-item>
          <el-descriptions-item label="候补">{{ detail.stats.waitlistCount }}</el-descriptions-item>
          <el-descriptions-item label="招新批次">{{ detail.stats.recruitmentCount }}</el-descriptions-item>
          <el-descriptions-item label="岗位数">{{ detail.stats.positionCount }}</el-descriptions-item>
          <el-descriptions-item label="开放名额">{{ detail.stats.openHeadcount }}</el-descriptions-item>
          <el-descriptions-item label="已录满">{{ detail.stats.openFilled }}</el-descriptions-item>
        </el-descriptions>

        <div class="detail-block">
          <h4>📋 信息录入标准</h4>
          <p class="pre-wrap">{{ detail.club.entryCriteria || '（该社团暂未填写招新录入标准）' }}</p>
        </div>

        <div class="detail-block" v-if="detail.club.description">
          <h4>🏷️ 社团说明</h4>
          <p class="pre-wrap">{{ detail.club.description }}</p>
        </div>

        <div class="detail-block">
          <h4>📊 近 {{ detail.trend.length }} 天投递趋势</h4>
          <!-- 等弹窗 opened 后再挂载图表，否则容器宽度还是 0，ECharts 会按 0 宽初始化 -->
          <EChart v-if="chartReady" :option="trendOption" height="180px" />
          <div v-else class="chart-placeholder" />
        </div>

        <div class="detail-block">
          <h4>🎯 招新批次与岗位</h4>
          <div v-for="rec in detail.recruitments" :key="rec.id" class="rec-block">
            <div class="rec-title">
              {{ rec.title }}
              <el-tag size="small" :type="rec.status === 'open' ? 'success' : 'info'" effect="plain">
                {{ recStatusLabel(rec.status) }}
              </el-tag>
              <span class="rec-sum">
                {{ rec.stats.positionCount }} 岗位 · 需 {{ rec.stats.headcount }} 人 ·
                收 {{ rec.stats.applicationCount }} 份 · 已录 {{ rec.stats.filled }}
              </span>
            </div>
            <el-table :data="rec.positions" size="small" border>
              <el-table-column prop="title" label="岗位" min-width="130" />
              <el-table-column label="需求" width="70" align="center">
                <template #default="{ row }">{{ row.headcount }}</template>
              </el-table-column>
              <el-table-column label="已录" width="70" align="center">
                <template #default="{ row }">
                  <span :class="{ full: row.filled_count >= row.headcount }">{{ row.filled_count }}</span>
                </template>
              </el-table-column>
              <el-table-column label="投递" width="70" align="center">
                <template #default="{ row }">{{ row.application_count }}</template>
              </el-table-column>
              <el-table-column label="候补" width="70" align="center">
                <template #default="{ row }">{{ row.waitlist_count || '—' }}</template>
              </el-table-column>
              <el-table-column label="招满进度" min-width="120">
                <template #default="{ row }">
                  <el-progress
                    :percentage="row.headcount ? Math.min(100, Math.round((row.filled_count / row.headcount) * 100)) : 0"
                    :stroke-width="8"
                    :text-inside="true"
                  />
                </template>
              </el-table-column>
            </el-table>
          </div>
          <el-empty v-if="detail.recruitments.length === 0" description="该社团还没有招新批次" :image-size="60" />
        </div>
      </div>
    </el-dialog>

    <!-- ═══ 账号与权限 ═══ -->
    <el-dialog v-model="accountsVisible" title="账号与权限" width="680px">
      <div class="acc-toolbar">
        <el-button type="primary" size="small" @click="openAccountDialog()">
          <el-icon><Plus /></el-icon> 新建账号
        </el-button>
        <span class="acc-tip">不同角色能看到和操作的范围不同（后端强制校验）</span>
      </div>
      <el-table :data="accounts" v-loading="loadingAccounts" size="small" border>
        <el-table-column prop="displayName" label="姓名/备注" min-width="110" />
        <el-table-column prop="username" label="账号" min-width="130" />
        <el-table-column label="角色" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="row.role === 'owner' ? 'danger' : row.role === 'interviewer' ? 'warning' : 'info'">
              {{ row.roleLabel }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.isActive ? 'success' : 'info'" effect="plain">
              {{ row.isActive ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openAccountDialog(row)">编辑</el-button>
            <el-button link type="warning" size="small" @click="resetPwd(row)">重置密码</el-button>
            <el-button link type="danger" size="small" @click="removeAccount(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-divider content-position="left">各角色权限</el-divider>
      <el-table :data="roleMatrix" size="small" border>
        <el-table-column prop="label" label="角色" width="110" />
        <el-table-column prop="desc" label="能做什么" />
      </el-table>
    </el-dialog>

    <el-dialog v-model="accountDialogVisible" :title="accForm.id ? '编辑账号' : '新建账号'" width="440px">
      <el-form :model="accForm" label-width="80px">
        <el-form-item label="账号名">
          <el-input v-model="accForm.username" :disabled="Boolean(accForm.id)" placeholder="登录用的英文名" />
        </el-form-item>
        <el-form-item label="姓名/备注">
          <el-input v-model="accForm.displayName" placeholder="如：张三（社长）" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="accForm.role" style="width: 100%">
            <el-option label="社长 / 管理员（全部权限）" value="owner" />
            <el-option label="面试官（可决策与评分）" value="interviewer" />
            <el-option label="观察员（只读）" value="viewer" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="!accForm.id" label="初始密码">
          <el-input v-model="accForm.password" placeholder="至少 6 位" show-password />
        </el-form-item>
        <el-form-item v-else label="状态">
          <el-switch v-model="accForm.isActive" active-text="启用" inactive-text="停用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="accountDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingAccount" @click="saveAccount">保存</el-button>
      </template>
    </el-dialog>

    <LoginDialog v-model="loginVisible" @success="onLoggedIn" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { squareApi, authApi, clubStandardApi, dictApi } from '../api/index.js';
import { isLoggedIn, account, can, init as initAuth, logout as doLogout } from '../stores/auth.js';
import EChart from '../components/EChart.vue';
import LoginDialog from '../components/LoginDialog.vue';

/* ---------- 分类展示 ---------- */
const CATEGORY_ICON = {
  technical: '💻', artistic: '🎭', organizing: '📋',
  sports: '⚽', academic: '📚', service: '🤝', other: '🎪',
};
const CATEGORY_LABEL = {
  technical: '技术', artistic: '文艺', organizing: '组织',
  sports: '体育', academic: '学术', service: '公益', other: '其他',
};
const REC_STATUS = { draft: '未发布', open: '招新中', closed: '已截止' };

const categoryIcon = (c) => CATEGORY_ICON[c] || '🎪';
const categoryLabel = (c) => CATEGORY_LABEL[c] || (c || '其他');
const recStatusLabel = (s) => REC_STATUS[s] || s;
const stageType = (s) =>
  ({ open: 'success', upcoming: 'warning', closed: 'info', none: 'info' }[s] || 'info');

/* ---------- 状态 ---------- */
const loadingClubs = ref(false);
const loadingDetail = ref(false);
const loadingMine = ref(false);
const savingStd = ref(false);
const clubs = ref([]);
const categories = ref([]);
const totals = reactive({ clubs: 0, openClubs: 0, positions: 0, headcount: 0, applications: 0 });
const filter = reactive({ keyword: '', category: '', stage: '', sort: 'applications' });

const detailVisible = ref(false);
const detail = ref(null);
const chartReady = ref(false);
const loginVisible = ref(false);

const myClub = ref(null);
const stdForm = reactive({ entryCriteria: '', applyStartAt: null, applyEndAt: null });

const myClubId = computed(() => account.value?.clubId || '');

/* ---------- 账号管理 ---------- */
const accountsVisible = ref(false);
const accountDialogVisible = ref(false);
const loadingAccounts = ref(false);
const savingAccount = ref(false);
const accounts = ref([]);
const accForm = reactive({ id: '', username: '', displayName: '', role: 'interviewer', password: '', isActive: true });
const roleMatrix = ref([]);

/* ---------- 数据加载 ---------- */
async function loadClubs() {
  loadingClubs.value = true;
  try {
    const data = await squareApi.clubs({ ...filter });
    clubs.value = data.list || [];
    Object.assign(totals, data.totals || {});
  } finally {
    loadingClubs.value = false;
  }
}

async function loadCategories() {
  try {
    categories.value = await squareApi.categories();
  } catch {
    categories.value = [];
  }
}

async function loadMine() {
  if (!isLoggedIn.value) {
    myClub.value = null;
    return;
  }
  loadingMine.value = true;
  try {
    const d = await squareApi.clubDetail(myClubId.value, { days: 14 });
    myClub.value = d;
    stdForm.entryCriteria = d.club.entryCriteria || '';
    stdForm.applyStartAt = d.club.applyStartAt || null;
    stdForm.applyEndAt = d.club.applyEndAt || null;
  } finally {
    loadingMine.value = false;
  }
}

async function openDetail(c) {
  detailVisible.value = true;
  loadingDetail.value = true;
  detail.value = null;
  try {
    detail.value = await squareApi.clubDetail(c.id, { days: 30 });
  } finally {
    loadingDetail.value = false;
  }
}

const trendOption = computed(() => {
  const t = detail.value?.trend || [];
  return {
    grid: { left: 36, right: 12, top: 16, bottom: 24 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: t.map((x) => x.date.slice(5)),
      axisLabel: { fontSize: 10, interval: Math.ceil(t.length / 8) },
    },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 10 } },
    series: [
      {
        type: 'line',
        smooth: true,
        areaStyle: { opacity: 0.18 },
        data: t.map((x) => x.count),
        itemStyle: { color: '#409eff' },
      },
    ],
  };
});

/* ---------- 保存招新标准 ---------- */
async function saveStandard() {
  savingStd.value = true;
  try {
    await clubStandardApi.update(myClubId.value, {
      entryCriteria: stdForm.entryCriteria,
      applyStartAt: stdForm.applyStartAt || null,
      applyEndAt: stdForm.applyEndAt || null,
    });
    ElMessage.success('招新标准已保存');
    await Promise.all([loadMine(), loadClubs()]);
  } catch {
    /* 拦截器已提示 */
  } finally {
    savingStd.value = false;
  }
}

const windowText = computed(() => {
  const { applyStartAt, applyEndAt } = stdForm;
  if (!applyStartAt && !applyEndAt) return '未设置时间限制（随时可投递）';
  return `投递开放：${fmt(applyStartAt)} ~ ${fmt(applyEndAt)}`;
});

function fmt(v) {
  if (!v) return '不限';
  try {
    return new Date(v).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return v;
  }
}

/* ---------- 账号与权限 ---------- */
async function openAccounts() {
  accountsVisible.value = true;
  loadingAccounts.value = true;
  try {
    accounts.value = await authApi.listAccounts(myClubId.value);
  } finally {
    loadingAccounts.value = false;
  }
}

function openAccountDialog(row) {
  Object.assign(accForm, {
    id: row?.id || '',
    username: row?.username || '',
    displayName: row?.displayName || '',
    role: row?.role || 'interviewer',
    password: '',
    isActive: row ? row.isActive : true,
  });
  accountDialogVisible.value = true;
}

async function saveAccount() {
  savingAccount.value = true;
  try {
    if (accForm.id) {
      await authApi.updateAccount(accForm.id, {
        displayName: accForm.displayName,
        role: accForm.role,
        isActive: accForm.isActive,
      });
    } else {
      await authApi.createAccount(myClubId.value, {
        username: accForm.username,
        displayName: accForm.displayName,
        role: accForm.role,
        password: accForm.password,
      });
    }
    ElMessage.success('已保存');
    accountDialogVisible.value = false;
    await openAccounts();
  } catch {
    /* 拦截器已提示 */
  } finally {
    savingAccount.value = false;
  }
}

async function resetPwd(row) {
  try {
    const { value } = await ElMessageBox.prompt(
      `为「${row.displayName || row.username}」设置新密码（至少 6 位）`,
      '重置密码',
      { inputType: 'password', inputPlaceholder: '新密码' }
    );
    await authApi.updateAccount(row.id, { password: value });
    ElMessage.success('密码已重置');
  } catch (e) {
    if (e !== 'cancel') { /* 已提示 */ }
  }
}

async function removeAccount(row) {
  try {
    await ElMessageBox.confirm(`确定删除账号「${row.displayName || row.username}」？`, '删除账号', { type: 'warning' });
    await authApi.removeAccount(row.id);
    ElMessage.success('已删除');
    await openAccounts();
  } catch (e) {
    if (e !== 'cancel') { /* 已提示 */ }
  }
}

async function onUserCommand(cmd) {
  if (cmd === 'accounts') return openAccounts();
  if (cmd === 'logout') {
    await doLogout();
    ElMessage.success('已退出登录');
    myClub.value = null;
    return;
  }
  if (cmd === 'password') {
    try {
      const { value } = await ElMessageBox.prompt('请输入新的密码（至少 6 位）', '修改我的密码', {
        inputType: 'password',
        inputPlaceholder: '新密码',
      });
      await authApi.changePassword({ oldPassword: '', newPassword: value }).catch(async () => {
        // 需要原密码：改用两步输入
        const oldPwd = await ElMessageBox.prompt('请输入当前密码', '验证身份', { inputType: 'password' });
        await authApi.changePassword({ oldPassword: oldPwd.value, newPassword: value });
      });
      ElMessage.success('密码已修改，请重新登录');
      await doLogout();
    } catch (e) {
      if (e !== 'cancel') { /* 已提示 */ }
    }
  }
}

async function onLoggedIn() {
  await initAuth();
  await Promise.all([loadMine(), loadClubs()]);
}

// 侧边栏也能登录/退出：登录态一变就刷新右侧面板，避免"登录了但面板还是空的"
watch(
  () => account.value?.clubId || '',
  async (clubId, prev) => {
    if (clubId === prev) return;
    if (clubId) {
      await Promise.all([loadMine(), loadClubs()]);
    } else {
      myClub.value = null;
    }
  }
);

onMounted(async () => {
  await initAuth();
  try {
    const dict = await dictApi.get();
    const caps = dict?.roleCapabilities || {};
    roleMatrix.value = [
      { label: '社长 / 管理员', desc: (caps.owner || []).join('、') },
      { label: '面试官', desc: (caps.interviewer || []).join('、') },
      { label: '观察员', desc: (caps.viewer || []).join('、') },
    ];
  } catch {
    /* 字典拿不到不影响主流程 */
  }
  await Promise.all([loadClubs(), loadCategories(), loadMine()]);
});
</script>

<style scoped>
.square-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 顶部 */
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 22px;
  border-radius: 12px;
  background: linear-gradient(120deg, #1f3a8a 0%, #2b5fd9 55%, #4b8bff 100%);
  color: #fff;
  box-shadow: 0 6px 20px rgba(31, 58, 138, 0.22);
}
.hero-main h2 {
  margin: 0 0 6px;
  font-size: 20px;
}
.hero-main p {
  margin: 0;
  font-size: 13px;
  opacity: 0.85;
}
.hero-stats {
  display: flex;
  gap: 26px;
}
.hero-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.hero-stat .num {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.1;
}
.hero-stat .num.accent {
  color: #ffe066;
}
.hero-stat .lbl {
  font-size: 12px;
  opacity: 0.8;
  margin-top: 2px;
}

/* 双面板 */
.panels {
  display: grid;
  grid-template-columns: minmax(0, 1.85fr) minmax(340px, 1fr);
  gap: 14px;
  align-items: start;
}
@media (max-width: 1280px) {
  .panels {
    grid-template-columns: 1fr;
  }
}
.panel {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 10px rgba(0, 21, 41, 0.06);
  padding: 16px;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #1f2d3d;
}
.panel-tools {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* 社团卡片 */
.club-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 12px;
  min-height: 120px;
}
.club-card {
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 14px;
  cursor: pointer;
  transition: all 0.18s;
  background: #fff;
}
.club-card:hover {
  border-color: #409eff;
  box-shadow: 0 6px 18px rgba(64, 158, 255, 0.16);
  transform: translateY(-2px);
}
.club-card.mine {
  border-color: #67c23a;
  background: linear-gradient(180deg, #f4fdf5 0%, #fff 40%);
}
.club-card-top {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.club-emoji {
  font-size: 26px;
  line-height: 1;
}
.club-emoji.big {
  font-size: 40px;
}
.club-meta {
  flex: 1;
  min-width: 0;
}
.club-name {
  font-weight: 600;
  font-size: 15px;
  color: #1f2d3d;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.club-sub {
  font-size: 12px;
  color: #909399;
  margin-top: 3px;
}
.club-desc {
  margin: 10px 0;
  font-size: 12.5px;
  color: #606266;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 40px;
}
.club-metrics {
  display: flex;
  gap: 18px;
  margin-bottom: 10px;
}
.metric {
  display: flex;
  flex-direction: column;
}
.m-num {
  font-size: 17px;
  font-weight: 600;
  color: #1f2d3d;
}
.m-lbl {
  font-size: 11px;
  color: #909399;
}
.club-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11.5px;
  color: #909399;
  margin-top: 6px;
}
.waitlist-hint {
  color: #e6a23c;
}
.view-hint {
  color: #409eff;
  opacity: 0;
  transition: opacity 0.18s;
}
.club-card:hover .view-hint {
  opacity: 1;
}

/* 我的社团面板 */
.mine-login {
  text-align: center;
  padding: 34px 18px;
}
.mine-login-icon {
  font-size: 42px;
  margin-bottom: 10px;
}
.mine-login h3 {
  margin: 0 0 8px;
  color: #1f2d3d;
}
.mine-login p {
  font-size: 13px;
  color: #606266;
  line-height: 1.7;
  margin-bottom: 18px;
}
.mine-login-hint {
  margin-top: 14px;
  font-size: 12px;
  color: #909399;
}
.mine-login-hint code {
  background: #f4f4f5;
  padding: 1px 5px;
  border-radius: 3px;
}
.mine-head {
  margin-bottom: 12px;
}
.user-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-size: 12.5px;
  color: #409eff;
  background: rgba(64, 158, 255, 0.1);
  padding: 4px 10px;
  border-radius: 12px;
}
.mine-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 100px;
}
.mine-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.stat-box {
  background: #f7f9fc;
  border-radius: 8px;
  padding: 10px 6px;
  text-align: center;
}
.s-num {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #1f2d3d;
}
.s-num.warn {
  color: #e6a23c;
}
.s-num.ok {
  color: #67c23a;
}
.s-lbl {
  font-size: 11px;
  color: #909399;
}
.mine-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}
.help-icon {
  color: #c0c4cc;
  cursor: help;
  font-size: 13px;
}
.time-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tilde {
  color: #909399;
}
.window-text {
  font-size: 12px;
  color: #909399;
}
.mine-actions {
  display: flex;
  gap: 8px;
}
.mine-actions .el-button {
  flex: 1;
  margin-left: 0;
}
.perm-alert {
  margin-bottom: 4px;
}

/* 招满进度 */
.rec-block {
  margin-bottom: 14px;
}
.rec-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.rec-sum {
  font-size: 11.5px;
  color: #909399;
  font-weight: 400;
}
.pos-progress {
  margin-bottom: 10px;
}
.pos-line {
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
  color: #606266;
  margin-bottom: 3px;
}
.pos-waitlist {
  color: #e6a23c;
  margin-left: 6px;
  font-size: 11.5px;
}
.full {
  color: #67c23a;
  font-weight: 600;
}

/* 详情弹窗 */
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 68vh;
  overflow-y: auto;
  padding-right: 6px;
}
.detail-head {
  display: flex;
  gap: 14px;
  align-items: center;
}
.detail-name {
  font-size: 17px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}
.detail-sub {
  font-size: 12.5px;
  color: #909399;
  margin-top: 4px;
}
.detail-block h4 {
  margin: 0 0 8px;
  font-size: 13.5px;
  color: #303133;
}
.pre-wrap {
  white-space: pre-wrap;
  margin: 0;
  font-size: 13px;
  color: #606266;
  line-height: 1.7;
}
.chart-placeholder {
  height: 180px;
}
.acc-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.acc-tip {
  font-size: 12px;
  color: #909399;
}
</style>
