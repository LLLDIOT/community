<template>
  <div class="interview-page">
    <!-- 未登录 -->
    <el-alert
      v-if="!isLoggedIn"
      type="warning"
      show-icon
      :closable="false"
      title="请先登录社团账号"
      description="面试标注、录用、调剂、候补递补都需要社团账号权限。可在「招新广场」右侧面板登录。"
    >
      <template #default>
        <div class="alert-row">
          <span>面试标注、录用、调剂、候补递补都需要社团账号权限。</span>
          <el-button size="small" type="primary" @click="loginVisible = true">去登录</el-button>
        </div>
      </template>
    </el-alert>

    <!-- 汇总条 -->
    <div v-if="isLoggedIn" class="summary-bar">
      <div class="sum-item">
        <span class="sum-num">{{ summary.total }}</span>
        <span class="sum-lbl">候选总数</span>
      </div>
      <div class="sum-item">
        <span class="sum-num ok">{{ summary.hired }}</span>
        <span class="sum-lbl">已录用</span>
      </div>
      <div class="sum-item">
        <span class="sum-num warn">{{ summary.waitlist }}</span>
        <span class="sum-lbl">候补中</span>
      </div>
      <div class="sum-item">
        <span class="sum-num accent">{{ summary.adjust }}</span>
        <span class="sum-lbl">已调剂</span>
      </div>
      <div class="sum-item">
        <span class="sum-num">{{ summary.undecided }}</span>
        <span class="sum-lbl">未决定</span>
      </div>
      <div class="sum-divider" />
      <div class="sum-item">
        <span class="sum-num">{{ summary.filledTotal }}/{{ summary.needTotal }}</span>
        <span class="sum-lbl">已录/需求</span>
      </div>
      <div class="sum-item">
        <span class="sum-num" :class="{ ok: summary.remainingTotal === 0 }">{{ summary.remainingTotal }}</span>
        <span class="sum-lbl">还缺</span>
      </div>
      <div class="sum-progress">
        <el-progress
          :percentage="summary.fillRate"
          :stroke-width="10"
          :color="summary.fillRate >= 100 ? '#67c23a' : '#409eff'"
        />
      </div>
    </div>

    <!-- 岗位招满进度 + 递补 -->
    <section v-if="isLoggedIn" class="panel">
      <header class="panel-head">
        <div class="panel-title"><el-icon><TrendCharts /></el-icon> 岗位招满进度与候补递补</div>
        <span class="panel-tip">有人放弃时，点「递补」把候补 1 号提升为录用，直到招满</span>
      </header>
      <div class="pos-cards">
        <div v-for="p in progress" :key="p.positionId" class="pos-card" :class="{ full: p.isFull }">
          <div class="pos-card-head">
            <span class="pos-title">{{ p.title }}</span>
            <el-tag size="small" :type="p.isFull ? 'success' : 'warning'" effect="light" round>
              {{ p.isFull ? '已招满' : `还缺 ${p.remaining}` }}
            </el-tag>
          </div>
          <div class="pos-rec">{{ p.recruitmentTitle }}</div>
          <el-progress
            :percentage="p.headcount ? Math.min(100, Math.round((p.filled / p.headcount) * 100)) : 0"
            :stroke-width="8"
            :color="p.isFull ? '#67c23a' : '#e6a23c'"
          />
          <div class="pos-card-foot">
            <span>已录 {{ p.filled }}/{{ p.headcount }}</span>
            <span v-if="p.waitlistCount" class="wl">候补 {{ p.waitlistCount }} 人</span>
            <el-button
              size="small"
              type="warning"
              plain
              :disabled="!canDecide || p.waitlistCount === 0"
              @click="openWaitlist(p)"
            >
              递补
            </el-button>
          </div>
        </div>
        <el-empty v-if="progress.length === 0" description="暂无岗位" :image-size="60" />
      </div>
    </section>

    <!-- 筛选 -->
    <section v-if="isLoggedIn" class="panel">
      <header class="panel-head">
        <div class="panel-title"><el-icon><Filter /></el-icon> 候选人筛选</div>
        <div class="panel-tools">
          <el-select v-model="query.recruitmentId" placeholder="全部批次" size="small" clearable style="width: 160px" @change="onRecChange">
            <el-option v-for="r in recruitments" :key="r.id" :label="r.title" :value="r.id" />
          </el-select>
          <el-select v-model="query.positionId" placeholder="全部岗位" size="small" clearable style="width: 160px" @change="load">
            <el-option v-for="p in positions" :key="p.id" :label="p.title" :value="p.id" />
          </el-select>
          <el-input
            v-model="query.keyword"
            placeholder="搜索姓名/专业/学校"
            size="small"
            clearable
            style="width: 170px"
            @keyup.enter="load"
            @clear="load"
          />
          <el-checkbox v-model="query.onlyUndecided" size="small" @change="load">只看未决定</el-checkbox>
          <el-button size="small" @click="load"><el-icon><Refresh /></el-icon> 刷新</el-button>
        </div>
      </header>

      <!-- 看板分列 -->
      <div v-loading="loading" class="board">
        <div v-for="col in columns" :key="col.key" class="board-col">
          <div class="col-head" :style="{ borderTopColor: col.color }">
            <span class="col-name">{{ col.label }}</span>
            <el-tag size="small" effect="plain" round>{{ col.items.length }}</el-tag>
          </div>
          <div class="col-body">
            <article v-for="c in col.items" :key="c.id" class="cand-card" :class="{ decided: c.decision }">
              <div class="cand-top">
                <span class="cand-name">{{ c.studentName }}</span>
                <el-tag
                  v-if="c.decision"
                  size="small"
                  :type="decisionColor(c.decision)"
                  effect="dark"
                  round
                >
                  {{ decisionText(c) }}
                </el-tag>
              </div>
              <div class="cand-sub">
                {{ c.grade || '—' }} · {{ c.major || '—' }}
              </div>
              <div class="cand-pos" :title="c.positionTitle">
                <el-icon><Suitcase /></el-icon> {{ c.positionTitle }}
              </div>

              <div class="cand-skills" v-if="c.skills">
                <el-tag
                  v-for="s in splitSkills(c.skills)"
                  :key="s"
                  size="small"
                  :type="c.hitSkills.includes(s.toLowerCase()) ? 'success' : 'info'"
                  effect="plain"
                >
                  {{ s }}
                </el-tag>
              </div>

              <div class="cand-metrics">
                <el-tooltip content="技能匹配度（命中/岗位期望技能）" placement="top">
                  <span class="match" :class="matchClass(c.matchScore)">{{ c.matchScore }}%</span>
                </el-tooltip>
                <el-rate v-model="c.score" disabled size="small" />
              </div>

              <div v-if="c.note" class="cand-note">{{ c.note }}</div>

              <div class="cand-actions">
                <template v-if="canDecide">
                  <el-button size="small" type="success" plain @click="mark(c, 'hired')">录用</el-button>
                  <el-button size="small" type="warning" plain @click="markWaitlist(c)">候补</el-button>
                  <el-button size="small" type="primary" plain @click="openAdjust(c)">调剂</el-button>
                  <el-button size="small" type="danger" plain @click="mark(c, 'reject')">淘汰</el-button>
                  <el-button v-if="c.decision" size="small" link @click="mark(c, '')">撤销</el-button>
                </template>
                <span v-else class="readonly-hint">只读</span>
              </div>

              <div v-if="canDecide && (c.status === 'new' || c.status === 'screening')" class="cand-advance">
                <el-button
                  v-if="c.status === 'new'"
                  size="small"
                  link
                  type="primary"
                  @click="advance(c, 'screening')"
                >
                  标记为待筛选 →
                </el-button>
                <el-button
                  v-else
                  size="small"
                  link
                  type="primary"
                  @click="advance(c, 'interviewing')"
                >
                  进入面试 →
                </el-button>
              </div>
            </article>
            <div v-if="col.items.length === 0" class="col-empty">暂无</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 调剂对话框 -->
    <el-dialog v-model="adjustVisible" title="调剂到其他岗位" width="620px">
      <div v-if="adjustTarget">
        <el-alert type="info" :closable="false" class="adjust-alert">
          <template #default>
            为 <b>{{ adjustTarget.studentName }}</b> 调剂：
            当前岗位「{{ adjustTarget.positionTitle }}」→ 选择更合适的岗位。
            确认后会在目标岗位生成一条新投递，并把原投递标注为「调剂」。
          </template>
        </el-alert>

        <el-table
          :data="adjustSuggestions"
          v-loading="loadingAdjust"
          size="small"
          border
          highlight-current-row
          @current-change="(row) => (selectedAdjust = row)"
        >
          <el-table-column label="目标岗位" min-width="140">
            <template #default="{ row }">
              {{ row.positionTitle }}
              <div class="sug-rec">{{ row.recruitmentTitle }}</div>
            </template>
          </el-table-column>
          <el-table-column label="匹配度" width="90" align="center">
            <template #default="{ row }">
              <span class="match" :class="matchClass(row.matchScore)">{{ row.matchScore }}%</span>
            </template>
          </el-table-column>
          <el-table-column label="命中技能" min-width="150">
            <template #default="{ row }">
              <el-tag v-for="s in row.hitSkills" :key="s" size="small" type="success" effect="plain">{{ s }}</el-tag>
              <el-tag v-for="s in row.missingSkills" :key="s" size="small" type="info" effect="plain">{{ s }}</el-tag>
              <span v-if="!row.hitSkills.length && !row.missingSkills.length" class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="剩余名额" width="90" align="center">
            <template #default="{ row }">{{ row.remaining }}/{{ row.headcount }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loadingAdjust && adjustSuggestions.length === 0" description="本社团内暂无可调剂岗位" :image-size="60" />
      </div>
      <template #footer>
        <el-button @click="adjustVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!selectedAdjust" :loading="savingAdjust" @click="doAdjust">
          确认调剂
        </el-button>
      </template>
    </el-dialog>

    <!-- 候补队列 / 递补 -->
    <el-dialog v-model="waitlistVisible" :title="`候补队列 · ${waitlistPos?.title || ''}`" width="560px">
      <el-alert type="warning" :closable="false" class="adjust-alert">
        <template #default>
          按序号递补：点「递补」会把当前 <b>候补 1 号</b> 提升为录用，其余候补序号自动前移。
        </template>
      </el-alert>
      <el-table :data="waitlist" v-loading="loadingWaitlist" size="small" border>
        <el-table-column label="序号" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small" type="warning" effect="dark" round>候补 {{ row.waitlistRank }} 号</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="studentName" label="姓名" min-width="90" />
        <el-table-column prop="grade" label="年级" width="70" />
        <el-table-column prop="major" label="专业" min-width="110" />
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row, $index }">
            <el-button
              size="small"
              type="success"
              plain
              :disabled="!canDecide || $index !== 0"
              @click="promote(row)"
            >
              递补
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loadingWaitlist && waitlist.length === 0" description="该岗位暂无候补" :image-size="60" />
    </el-dialog>

    <LoginDialog v-model="loginVisible" @success="onLoggedIn" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { decisionApi, recruitmentApi, applicationApi } from '../api/index.js';
import { isLoggedIn, account, can, init as initAuth } from '../stores/auth.js';
import LoginDialog from '../components/LoginDialog.vue';

const loginVisible = ref(false);
const loading = ref(false);
const canDecide = computed(() => can('application:decide'));

const board = ref({ candidates: [], columns: {}, progress: [], summary: {}, positions: [] });
const recruitments = ref([]);
const query = reactive({ recruitmentId: '', positionId: '', keyword: '', onlyUndecided: false });

const summary = computed(() => board.value.summary || {});
const progress = computed(() => board.value.progress || []);
const positions = computed(() => {
  const list = board.value.positions || [];
  return query.recruitmentId ? list.filter((p) => p.recruitmentId === query.recruitmentId) : list;
});

const COLUMN_DEFS = [
  { key: 'new', label: '新收到', color: '#409eff' },
  { key: 'screening', label: '待筛选', color: '#e6a23c' },
  { key: 'interviewing', label: '面试中', color: '#a06cd5' },
  { key: 'admitted', label: '已录取', color: '#67c23a' },
  { key: 'rejected', label: '已淘汰/归档', color: '#909399' },
];
const columns = computed(() =>
  COLUMN_DEFS.map((d) => ({ ...d, items: board.value.columns?.[d.key] || [] }))
);

const DECISION_COLOR = { hired: 'success', waitlist: 'warning', adjust: 'primary', reject: 'danger' };
const decisionColor = (d) => DECISION_COLOR[d] || 'info';
const decisionText = (c) =>
  c.decision === 'waitlist' ? `候补 ${c.waitlistRank} 号`
    : c.decision === 'hired' ? '录用'
    : c.decision === 'adjust' ? `调剂 → ${c.adjustPositionTitle || '其他岗位'}`
    : c.decision === 'reject' ? '淘汰'
    : '';

function splitSkills(raw) {
  return String(raw || '').split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean);
}
function matchClass(score) {
  if (score >= 80) return 'high';
  if (score >= 50) return 'mid';
  return 'low';
}

/* ---------- 数据 ---------- */
async function load() {
  if (!isLoggedIn.value) return;
  loading.value = true;
  try {
    board.value = await decisionApi.board(account.value.clubId, {
      recruitmentId: query.recruitmentId,
      positionId: query.positionId,
      keyword: query.keyword,
      onlyUndecided: query.onlyUndecided ? '1' : '',
    });
  } finally {
    loading.value = false;
  }
}

async function loadRecruitments() {
  if (!isLoggedIn.value) return;
  try {
    recruitments.value = await recruitmentApi.list(account.value.clubId);
  } catch {
    recruitments.value = [];
  }
}

function onRecChange() {
  query.positionId = '';
  load();
}

/* ---------- 决策动作 ---------- */
async function mark(cand, decision) {
  try {
    await decisionApi.set(cand.id, { decision });
    ElMessage.success(
      decision === 'hired' ? `已录用 ${cand.studentName}`
        : decision === 'reject' ? `已淘汰 ${cand.studentName}`
        : `已撤销 ${cand.studentName} 的结论`
    );
    await load();
  } catch {
    /* 拦截器已提示 */
  }
}

async function markWaitlist(cand) {
  try {
    const { value } = await ElMessageBox.prompt(
      `为「${cand.studentName}」设置候补序号（1 号最优先，可不填自动排到队尾）`,
      '标注候补',
      { inputPlaceholder: '如 1', inputValue: '', confirmButtonText: '确定', cancelButtonText: '取消' }
    );
    await decisionApi.set(cand.id, {
      decision: 'waitlist',
      waitlistRank: value === '' ? undefined : Number(value),
    });
    ElMessage.success('已加入候补队列');
    await load();
  } catch (e) {
    if (e !== 'cancel') { /* 已提示 */ }
  }
}

async function advance(cand, status) {
  try {
    await applicationApi.transition(cand.id, status);
    ElMessage.success(status === 'screening' ? '已标记为待筛选' : '已进入面试中');
    await load();
  } catch {
    /* 拦截器已提示 */
  }
}

/* ---------- 调剂 ---------- */
const adjustVisible = ref(false);
const loadingAdjust = ref(false);
const savingAdjust = ref(false);
const adjustTarget = ref(null);
const adjustSuggestions = ref([]);
const selectedAdjust = ref(null);

async function openAdjust(cand) {
  adjustTarget.value = cand;
  selectedAdjust.value = null;
  adjustSuggestions.value = [];
  adjustVisible.value = true;
  loadingAdjust.value = true;
  try {
    const data = await decisionApi.adjustSuggestions(cand.id);
    adjustSuggestions.value = data.suggestions || [];
  } finally {
    loadingAdjust.value = false;
  }
}

async function doAdjust() {
  if (!selectedAdjust.value) return;
  savingAdjust.value = true;
  try {
    const res = await decisionApi.adjust(adjustTarget.value.id, {
      adjustPositionId: selectedAdjust.value.positionId,
    });
    ElMessage.success(
      res.alreadyApplied
        ? `已标注调剂（该候选人此前已投过「${selectedAdjust.value.positionTitle}」）`
        : `已调剂到「${selectedAdjust.value.positionTitle}」并生成新投递`
    );
    adjustVisible.value = false;
    await load();
  } catch {
    /* 拦截器已提示 */
  } finally {
    savingAdjust.value = false;
  }
}

/* ---------- 候补队列 / 递补 ---------- */
const waitlistVisible = ref(false);
const loadingWaitlist = ref(false);
const waitlist = ref([]);
const waitlistPos = ref(null);

async function openWaitlist(p) {
  waitlistPos.value = p;
  waitlistVisible.value = true;
  loadingWaitlist.value = true;
  try {
    waitlist.value = await decisionApi.waitlist(p.positionId);
  } finally {
    loadingWaitlist.value = false;
  }
}

async function promote(row) {
  try {
    await ElMessageBox.confirm(
      `把「${row.studentName}」从候补 ${row.waitlistRank} 号提升为录用？`,
      '候补递补',
      { type: 'warning' }
    );
    const res = await decisionApi.promoteWaitlist(waitlistPos.value.positionId, { applicationId: row.id });
    ElMessage.success(`已录用 ${res.promoted.studentName}，剩余候补 ${res.remaining.length} 人`);
    waitlist.value = res.remaining;
    await load();
  } catch (e) {
    if (e !== 'cancel') { /* 已提示 */ }
  }
}

async function onLoggedIn() {
  await initAuth();
  await Promise.all([load(), loadRecruitments()]);
}

// 侧边栏也能登录：登录态一变就把工作台数据拉起来
watch(
  () => account.value?.clubId || '',
  async (clubId, prev) => {
    if (clubId === prev || !clubId) return;
    await Promise.all([load(), loadRecruitments()]);
  }
);

onMounted(async () => {
  await initAuth();
  await Promise.all([load(), loadRecruitments()]);
});
</script>

<style scoped>
.interview-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.alert-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

/* 汇总 */
.summary-bar {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 16px 22px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 10px rgba(0, 21, 41, 0.06);
  flex-wrap: wrap;
}
.sum-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 62px;
}
.sum-num {
  font-size: 21px;
  font-weight: 700;
  color: #1f2d3d;
  line-height: 1.1;
}
.sum-num.ok { color: #67c23a; }
.sum-num.warn { color: #e6a23c; }
.sum-num.accent { color: #409eff; }
.sum-lbl {
  font-size: 11.5px;
  color: #909399;
  margin-top: 2px;
}
.sum-divider {
  width: 1px;
  height: 34px;
  background: #ebeef5;
}
.sum-progress {
  flex: 1;
  min-width: 160px;
}

/* 面板 */
.panel {
  background: #fff;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 10px rgba(0, 21, 41, 0.06);
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
.panel-tip {
  font-size: 12px;
  color: #909399;
}
.panel-tools {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

/* 岗位卡 */
.pos-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px;
}
.pos-card {
  border: 1px solid #ebeef5;
  border-left: 3px solid #e6a23c;
  border-radius: 9px;
  padding: 12px;
}
.pos-card.full {
  border-left-color: #67c23a;
  background: #f6fdf7;
}
.pos-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}
.pos-title {
  font-weight: 600;
  font-size: 13.5px;
  color: #1f2d3d;
}
.pos-rec {
  font-size: 11.5px;
  color: #909399;
  margin-bottom: 8px;
}
.pos-card-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 12px;
  color: #606266;
}
.pos-card-foot .wl {
  color: #e6a23c;
}
.pos-card-foot .el-button {
  margin-left: auto;
}

/* 看板 */
.board {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  min-height: 160px;
}
@media (max-width: 1500px) {
  .board {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 1000px) {
  .board {
    grid-template-columns: 1fr;
  }
}
.board-col {
  background: #f7f9fc;
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  min-height: 120px;
}
.col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 3px solid #409eff;
  padding-top: 8px;
  margin-bottom: 10px;
}
.col-name {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}
.col-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}
.col-empty {
  text-align: center;
  color: #c0c4cc;
  font-size: 12px;
  padding: 18px 0;
}

/* 候选人卡 */
.cand-card {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 9px;
  padding: 11px;
  transition: box-shadow 0.18s;
}
.cand-card:hover {
  box-shadow: 0 4px 14px rgba(0, 21, 41, 0.1);
}
.cand-card.decided {
  border-color: #d9ecff;
}
.cand-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.cand-name {
  font-weight: 600;
  font-size: 13.5px;
  color: #1f2d3d;
}
.cand-sub {
  font-size: 11.5px;
  color: #909399;
  margin-top: 3px;
}
.cand-pos {
  font-size: 11.5px;
  color: #409eff;
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cand-skills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}
.cand-skills :deep(.el-tag) {
  margin: 0;
}
.cand-metrics {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}
.match {
  font-weight: 700;
  font-size: 13px;
}
.match.high { color: #67c23a; }
.match.mid { color: #e6a23c; }
.match.low { color: #c0c4cc; }
.cand-note {
  margin-top: 7px;
  font-size: 11.5px;
  color: #606266;
  background: #f7f9fc;
  border-radius: 5px;
  padding: 5px 7px;
  line-height: 1.5;
}
.cand-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 9px;
}
.cand-actions :deep(.el-button) {
  margin: 0;
}
.readonly-hint {
  font-size: 11.5px;
  color: #c0c4cc;
}
.cand-advance {
  margin-top: 4px;
}
.sug-rec {
  font-size: 11px;
  color: #909399;
}
.muted {
  color: #c0c4cc;
}
.adjust-alert {
  margin-bottom: 12px;
}
</style>
