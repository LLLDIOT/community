<template>
  <div class="app-library" v-loading="loading">
    <!-- 筛选工具栏 -->
    <el-card shadow="never" class="toolbar">
      <div class="filters">
        <el-select v-model="query.clubId" placeholder="选择社团" style="width: 170px" @change="onClubChange">
          <el-option v-for="c in clubs" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select v-model="query.recruitmentId" placeholder="招新批次" clearable style="width: 160px" @change="onRecChange">
          <el-option v-for="r in recruitments" :key="r.id" :label="r.title" :value="r.id" />
        </el-select>
        <el-select v-model="query.positionId" placeholder="招新岗位（按需求）" clearable filterable style="width: 200px" @change="resetPage">
          <el-option v-for="p in positions" :key="p.id" :label="p.title" :value="p.id" />
        </el-select>
        <el-select v-model="query.typeTag" placeholder="简历类型" clearable style="width: 140px" @change="resetPage">
          <el-option v-for="t in typeTagOptions" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
        <el-select v-model="query.status" placeholder="处理状态" clearable style="width: 130px" @change="resetPage">
          <el-option v-for="(label, value) in statusOptions" :key="value" :label="label" :value="value" />
        </el-select>
        <el-input v-model="query.keyword" placeholder="姓名 / 专业 / 学校" clearable style="width: 180px" @keyup.enter="load" @clear="load" />
        <el-button type="primary" @click="load">查询</el-button>
        <el-button :disabled="!query.clubId" @click="exportCsv">导出 CSV</el-button>
      </div>
      <div v-if="!query.clubId" class="tip">请先在上方选择社团，查看该社团的简历库</div>
    </el-card>

    <!-- 汇总统计 -->
    <el-row v-if="query.clubId" :gutter="12" class="stats">
      <el-col v-for="s in stats" :key="s.key" :span="4">
        <el-card shadow="never" :body-style="{ padding: '12px' }">
          <div class="stat-num" :style="{ color: s.color }">{{ s.count }}</div>
          <div class="stat-label">{{ s.label }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 简历表格 -->
    <el-card shadow="never">
      <el-table :data="list" size="default" empty-text="暂无投递记录">
        <el-table-column label="姓名" width="100">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row.id)">{{ row.student_name }}</el-button>
          </template>
        </el-table-column>
        <el-table-column prop="grade" label="年级" width="70" align="center" />
        <el-table-column prop="major" label="专业" min-width="120" show-overflow-tooltip />
        <el-table-column label="投递岗位" min-width="150">
          <template #default="{ row }">{{ row.recruitment_title }} · {{ row.position_title }}</template>
        </el-table-column>
        <el-table-column label="类型" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="tagColor(row.type_tag)">{{ typeLabel(row.type_tag) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="96" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="statusColor(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="评分" width="120" align="center">
          <template #default="{ row }">
            <el-rate :model-value="row.score" disabled size="small" />
          </template>
        </el-table-column>
        <el-table-column label="投递时间" width="110">
          <template #default="{ row }">{{ fmtDate(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-dropdown trigger="click" @command="(cmd) => handleStatus(row, cmd)">
              <el-button size="small" type="primary" plain>
                状态<el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="(label, val) in nextStatuses(row.status)" :key="val" :command="val">{{ label }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button size="small" @click="openDetail(row.id)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        class="pager"
        layout="total, prev, pager, next"
        :total="total"
        :page-size="query.pageSize"
        :current-page="query.page"
        @current-change="(p) => { query.page = p; load(); }"
      />
    </el-card>

    <!-- 简历详情抽屉 -->
    <el-drawer v-model="drawer.visible" size="480px" :title="drawer.app ? `${drawer.app.student_name} 的简历` : '简历详情'">
      <template v-if="drawer.app">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="姓名">{{ drawer.app.student_name }}</el-descriptions-item>
          <el-descriptions-item label="联系方式">{{ drawer.app.phone || '-' }} {{ drawer.app.email || '' }}</el-descriptions-item>
          <el-descriptions-item label="学校 / 专业">{{ drawer.app.school || '-' }} · {{ drawer.app.major || '-' }}</el-descriptions-item>
          <el-descriptions-item label="年级">{{ drawer.app.grade || '-' }}</el-descriptions-item>
          <el-descriptions-item label="投递岗位">{{ drawer.app.club_name }} / {{ drawer.app.recruitment_title }} / {{ drawer.app.position_title }}</el-descriptions-item>
          <el-descriptions-item label="当前状态">
            <el-tag size="small" :type="statusColor(drawer.app.status)">{{ statusLabel(drawer.app.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item v-if="drawer.app.skills" label="技能标签">
            <el-tag v-for="s in splitSkills(drawer.app.skills)" :key="s" size="small" type="warning" effect="plain" style="margin-right: 4px">{{ s }}</el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <div class="drawer-block">
          <div class="drawer-title">简历正文</div>
          <div class="resume-content">{{ drawer.app.content || '（无在线简历内容）' }}</div>
        </div>

        <div v-if="drawer.app.attachment_path" class="drawer-block">
          <div class="drawer-title">附件简历</div>
          <el-button type="primary" link @click="openAttachment(drawer.app.attachment_path)">
            <el-icon><Download /></el-icon>&nbsp;查看附件
          </el-button>
        </div>

        <!-- 智能匹配：推荐该简历可投的其它岗位 -->
        <div class="drawer-block">
          <div class="drawer-title">
            智能匹配推荐
            <el-button type="primary" link size="small" :loading="matchLoading" @click="loadMatchSuggestions">
              <el-icon><MagicStick /></el-icon>&nbsp;计算匹配
            </el-button>
          </div>
          <div v-if="matchLoading" class="muted">匹配计算中…</div>
          <div v-else-if="matchSuggs === null" class="muted">点击"计算匹配"，查看该简历与各社团开放岗位的匹配度</div>
          <template v-else>
            <el-empty v-if="matchSuggs.length === 0" description="暂无匹配岗位" :image-size="60" />
            <div v-for="(r, i) in matchSuggs.slice(0, 5)" :key="r.positionId" class="sug-item">
              <div class="sug-rank" :class="{ top: i === 0 }">{{ i + 1 }}</div>
              <div class="sug-main">
                <div class="sug-title">
                  <span class="sug-club">{{ r.clubName }}</span>
                  <span class="sug-pos">{{ r.recruitmentTitle }} · {{ r.positionTitle }}</span>
                </div>
                <div class="sug-skills">
                  <span v-for="h in r.hitSkills" :key="h" class="sug-hit">{{ h }} ✓</span>
                  <span v-for="m in r.missingSkills" :key="m" class="sug-miss">{{ m }}</span>
                </div>
              </div>
              <div class="sug-right">
                <div class="sug-score">{{ r.score }}%</div>
                <el-button
                  v-if="r.status === 'open'"
                  size="small"
                  type="success"
                  plain
                  :disabled="r.positionId === drawer.app.position_id"
                  @click="quickApply(r)"
                >{{ r.positionId === drawer.app.position_id ? '已投此岗' : '转投' }}</el-button>
              </div>
            </div>
          </template>
        </div>

        <div class="drawer-block">
          <div class="drawer-title">处理操作</div>
          <el-form label-width="70px" size="small">
            <el-form-item label="评分">
              <el-rate v-model="scoreForm.score" />
            </el-form-item>
            <el-form-item label="简历类型">
              <el-select v-model="scoreForm.typeTag" style="width: 100%">
                <el-option v-for="t in typeTagOptions" :key="t.value" :label="t.label" :value="t.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="scoreForm.note" type="textarea" :rows="3" placeholder="记录面试情况、倾向…" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveScore">保存评分备注</el-button>
              <el-button
                v-if="drawer.app.status !== 'archived'"
                type="warning"
                plain
                @click="doArchive(true)"
              >归档</el-button>
              <el-button
                v-else
                type="info"
                plain
                @click="doArchive(false)"
              >取消归档（回到已淘汰）</el-button>
              <el-button type="danger" plain @click="doDelete">删除</el-button>
            </el-form-item>
          </el-form>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { clubApi, recruitmentApi, positionApi, applicationApi, dictApi, matchApi } from '../api/index.js';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const list = ref([]);
const total = ref(0);
const statusCounts = ref({});
const clubs = ref([]);
const recruitments = ref([]);
const positions = ref([]);
const dict = reactive({ typeTags: [], statuses: {}, transitions: {} });

const query = reactive({
  clubId: '',
  recruitmentId: '',
  positionId: '',
  typeTag: '',
  status: '',
  keyword: '',
  page: 1,
  pageSize: 10,
});

const TYPE_LABELS = {
  technical: '技术型', organizing: '组织策划型', artistic: '文艺特长型',
  sports: '体育型', academic: '学术竞赛型', service: '志愿服务型', other: '其他',
};
const STATUS_COLORS = {
  new: 'danger', screening: 'warning', interviewing: 'warning',
  admitted: 'success', rejected: 'info', archived: 'info',
};

const typeTagOptions = computed(() =>
  dict.typeTags.map((t) => ({ value: t, label: TYPE_LABELS[t] || t }))
);
const statusOptions = computed(() => dict.statuses || {});
const typeLabel = (v) => TYPE_LABELS[v] || v;
const statusLabel = (v) => dict.statuses?.[v] || v;
const statusColor = (s) => STATUS_COLORS[s] || 'info';
const tagColor = () => 'info';

function fmtDate(iso) {
  return iso ? iso.slice(0, 10) : '';
}
function resetPage() {
  query.page = 1;
  load();
}

/* 某状态下可执行的下一动作（下拉菜单） */
function nextStatuses(status) {
  const trans = dict.transitions?.[status] || [];
  const map = {};
  for (const s of trans) map[s] = statusLabel(s);
  return map;
}

async function handleStatus(row, status) {
  await applicationApi.transition(row.id, status);
  ElMessage.success(`已变为「${statusLabel(status)}」`);
  load();
  refreshDrawer(row.id);
}

/* 汇总统计（statusCounts 由后端忽略 status 过滤计算，其余筛选一致） */
const stats = computed(() => {
  const sc = statusCounts.value;
  const count = (s) => sc[s] || 0;
  const sum = Object.values(sc).reduce((a, b) => a + b, 0);
  return [
    { key: 'all', label: '全部简历', count: sum, color: '#409EFF' },
    { key: 'new', label: '新收到', count: count('new'), color: '#F56C6C' },
    { key: 'screening', label: '待筛选', count: count('screening'), color: '#E6A23C' },
    { key: 'interviewing', label: '面试中', count: count('interviewing'), color: '#E6A23C' },
    { key: 'admitted', label: '已录取', count: count('admitted'), color: '#67C23A' },
    { key: 'rejected', label: '已淘汰', count: count('rejected'), color: '#909399' },
  ];
});

async function load() {
  if (!query.clubId) return;
  loading.value = true;
  try {
    const params = {
      typeTag: query.typeTag || undefined,
      status: query.status || undefined,
      keyword: query.keyword || undefined,
      positionId: query.positionId || undefined,
      recruitmentId: query.recruitmentId || undefined,
      page: query.page,
      pageSize: query.pageSize,
    };
    const data = await applicationApi.listByClub(query.clubId, params);
    list.value = data.list;
    total.value = data.total;
    statusCounts.value = data.statusCounts || {};
  } finally {
    loading.value = false;
  }
}

/* 社团/批次/岗位级联加载 */
async function loadClubs() {
  const data = await clubApi.list({ page: 1, pageSize: 100 });
  clubs.value = data.list;
  if (!query.clubId && clubs.value.length) {
    query.clubId = route.query.clubId || clubs.value[0].id;
  }
}

async function loadRecruitments(clubId) {
  const data = await recruitmentApi.list(clubId);
  recruitments.value = data;
}

async function loadPositions(recId) {
  if (!recId) {
    // 加载某社团全部岗位（跨批次），用于"不限批次只按岗位筛"
    positions.value = [];
    const recs = recruitments.value.length ? recruitments.value : await recruitmentApi.list(query.clubId);
    for (const rec of recs) {
      const ps = await positionApi.list(rec.id);
      ps.forEach((p) => positions.value.push({ ...p, recTitle: rec.title }));
    }
  } else {
    const data = await positionApi.list(recId);
    positions.value = data.map((p) => {
      const rec = recruitments.value.find((r) => r.id === recId);
      return { ...p, recTitle: rec?.title };
    });
  }
}

/** 用户切换社团：重置批次/岗位并刷新全链路 */
async function onClubChange() {
  query.recruitmentId = '';
  query.positionId = '';
  query.page = 1;
  await loadRecruitments(query.clubId);
  await loadPositions('');
  await load();
}

/** 用户切换/清空批次：刷新岗位列表 */
async function onRecChange() {
  query.positionId = '';
  query.page = 1;
  await loadPositions(query.recruitmentId || '');
  await load();
}

/* 详情抽屉 */
const drawer = reactive({ visible: false, app: null });
const scoreForm = reactive({ score: 0, note: '', typeTag: 'other' });
const matchLoading = ref(false);
const matchSuggs = ref(null);

function splitSkills(raw) {
  if (!raw) return [];
  return String(raw).split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean);
}

async function loadMatchSuggestions() {
  if (!drawer.app) return;
  matchLoading.value = true;
  try {
    const r = await matchApi.matchTop(drawer.app.resume_id, { limit: 10, minScore: 10 });
    matchSuggs.value = r.recommendations;
  } finally {
    matchLoading.value = false;
  }
}

/** 一键转投：给推荐岗位创建投递 */
async function quickApply(sug) {
  await ElMessageBox.confirm(
    `将「${drawer.app.student_name}」转投到 ${sug.clubName} / ${sug.positionTitle}？（匹配度 ${sug.score}%）`,
    '确认转投',
    { type: 'info' }
  );
  const app = await applicationApi.create(sug.positionId, {
    resumeId: drawer.app.resume_id,
    typeTag: drawer.app.type_tag || 'other',
  });
  ElMessage.success(`已投递「${sug.positionTitle}」`);
  // 刷新抽屉与列表
  drawer.visible = false;
  load();
}

async function openDetail(appId) {
  const app = await applicationApi.detail(appId);
  drawer.app = app;
  scoreForm.score = app.score || 0;
  scoreForm.note = app.note || '';
  scoreForm.typeTag = app.type_tag || 'other';
  matchSuggs.value = null;
  drawer.visible = true;
  // 有技能标签时自动算一次匹配推荐
  if (app.skills) loadMatchSuggestions();
}

async function refreshDrawer(appId) {
  if (drawer.app && drawer.app.id === appId) {
    drawer.app = await applicationApi.detail(appId);
  }
}

async function saveScore() {
  if (!drawer.app) return;
  await applicationApi.update(drawer.app.id, { ...scoreForm });
  ElMessage.success('已保存');
  load();
  refreshDrawer(drawer.app.id);
}

async function doArchive(archived) {
  await applicationApi.archive(drawer.app.id, archived);
  ElMessage.success(archived ? '已归档' : '已取消归档');
  drawer.visible = false;
  load();
}

async function doDelete() {
  await ElMessageBox.confirm(`删除「${drawer.app.student_name}」的这条投递记录？`, '确认删除', { type: 'warning' });
  await applicationApi.remove(drawer.app.id);
  ElMessage.success('已删除');
  drawer.visible = false;
  load();
}

function openAttachment(p) {
  window.open(p, '_blank');
}

function exportCsv() {
  const params = {
    typeTag: query.typeTag || undefined,
    status: query.status || undefined,
    keyword: query.keyword || undefined,
    positionId: query.positionId || undefined,
    recruitmentId: query.recruitmentId || undefined,
  };
  window.open(applicationApi.exportUrl(query.clubId, params), '_blank');
}

onMounted(async () => {
  const d = await dictApi.get();
  Object.assign(dict, d);
  await loadClubs();
  // 支持从社团详情带 query 直达（clubId/recruitmentId/positionId）
  if (!query.clubId) return; // 无社团可看
  query.recruitmentId = route.query.recruitmentId || '';
  query.positionId = route.query.positionId || '';
  await loadRecruitments(query.clubId);
  await loadPositions(query.recruitmentId || '');
  await load();
});
</script>

<style scoped>
.toolbar .filters {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.tip {
  margin-top: 10px;
  color: #909399;
  font-size: 13px;
}
.stats {
  margin: 12px 0;
}
.stat-num {
  font-size: 22px;
  font-weight: 700;
}
.stat-label {
  color: #909399;
  font-size: 12px;
  margin-top: 2px;
}
.pager {
  margin-top: 12px;
  justify-content: flex-end;
}
.drawer-block {
  margin-top: 16px;
}
.drawer-title {
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 14px;
}
.resume-content {
  white-space: pre-wrap;
  background: #f5f7fa;
  padding: 10px;
  border-radius: 6px;
  color: #303133;
  font-size: 13px;
  line-height: 1.7;
  max-height: 300px;
  overflow-y: auto;
}
.sug-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  margin-bottom: 6px;
}
.sug-rank {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #f0f2f5;
  color: #606266;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}
.sug-rank.top {
  background: #409eff;
  color: #fff;
}
.sug-main {
  flex: 1;
  min-width: 0;
}
.sug-title {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.sug-club {
  color: #409eff;
  font-weight: 600;
  font-size: 13px;
}
.sug-pos {
  font-size: 13px;
  color: #303133;
}
.sug-skills {
  margin-top: 4px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.sug-hit {
  font-size: 11px;
  background: #f0f9eb;
  color: #67c23a;
  border-radius: 3px;
  padding: 0 5px;
}
.sug-miss {
  font-size: 11px;
  color: #c0c4cc;
  border: 1px dashed #dcdfe6;
  border-radius: 3px;
  padding: 0 5px;
}
.sug-right {
  text-align: center;
  flex-shrink: 0;
}
.sug-score {
  font-weight: 700;
  color: #67c23a;
  font-size: 15px;
}
.muted {
  color: #c0c4cc;
  font-size: 13px;
}
</style>
