<template>
  <div class="page">
    <el-card shadow="never">
      <template #header>
        <div class="card-head">
          <span>我的投递</span>
          <div class="head-actions">
            <el-button size="small" :loading="loading" @click="refresh">
              <el-icon><Refresh /></el-icon>&nbsp;刷新状态
            </el-button>
            <el-button v-if="records.length" size="small" type="danger" plain @click="clearAll">
              清空本地记录
            </el-button>
          </div>
        </div>
      </template>

      <el-alert type="info" :closable="false" show-icon class="tip">
        投递内容保存在服务端，这里的记录只是本机的索引。
        换浏览器或清除缓存后列表会变空，但只要还留着投递编号，仍可凭编号查询进度。
      </el-alert>

      <el-empty v-if="!records.length" description="还没有投递记录">
        <el-button type="primary" @click="$router.push('/clubs')">去看看有哪些社团在招新</el-button>
      </el-empty>

      <el-table v-else :data="rows" v-loading="loading" style="width: 100%">
        <el-table-column label="社团" min-width="140">
          <template #default="{ row }">
            <div class="club">{{ row.clubName }}</div>
            <div class="sub">{{ row.clubId }}</div>
          </template>
        </el-table-column>

        <el-table-column label="岗位" min-width="150" prop="positionName" />

        <el-table-column label="投递时间" width="170">
          <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
        </el-table-column>

        <el-table-column label="进度" width="120" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="tone(row.status)" effect="light">
              {{ label(row.status) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="投递编号" width="190">
          <template #default="{ row }">
            <span class="code">{{ row.applicationId }}</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="150" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="openDetail(row)">查看详情</el-button>
            <el-button type="danger" link @click="removeOne(row)">删除记录</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header><span>凭投递编号查询</span></template>
      <div class="query">
        <el-input v-model="manualId" placeholder="粘贴投递编号，例如 app_xxxxxxxx" style="width: 320px" clearable />
        <el-button type="primary" :loading="querying" @click="queryManual">查询</el-button>
      </div>
      <div class="hint">清理过浏览器缓存、或换了设备时，可以用投递编号直接查到最新进度。</div>
    </el-card>

    <!-- 详情抽屉 -->
    <el-drawer v-model="detailVisible" title="投递详情" size="520px">
      <template v-if="detail">
        <el-descriptions :column="1" border size="default">
          <el-descriptions-item label="社团">{{ detail.club_name }}</el-descriptions-item>
          <el-descriptions-item label="批次 / 岗位">
            {{ detail.recruitment_title }} / {{ detail.position_title }}
          </el-descriptions-item>
          <el-descriptions-item label="当前状态">
            <el-tag size="small" :type="tone(detail.status)">{{ label(detail.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="投递时间">{{ fmt(detail.created_at) }}</el-descriptions-item>
          <el-descriptions-item label="姓名">{{ detail.student_name }}</el-descriptions-item>
          <el-descriptions-item label="学校 / 专业">
            {{ detail.school || '—' }} / {{ detail.major || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="联系方式">
            {{ detail.phone || '—' }}　{{ detail.email || '' }}
          </el-descriptions-item>
          <el-descriptions-item label="技能标签">
            <el-tag
              v-for="s in splitSkills(detail.skills)"
              :key="s"
              size="small"
              effect="plain"
              style="margin-right: 4px"
            >{{ s }}</el-tag>
            <span v-if="!splitSkills(detail.skills).length" class="muted">未填写</span>
          </el-descriptions-item>
        </el-descriptions>

        <div class="content-title">简历正文</div>
        <div class="content-body">{{ detail.content || '（无内容）' }}</div>

        <el-alert type="info" :closable="false" show-icon class="tip2">
          社团端对简历的处理进度会在这里同步展示。如长时间没有变化，可通过社团公告里的联系方式询问。
        </el-alert>
      </template>
      <el-empty v-else description="暂无数据" />
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getApplication, STATUS_LABEL, STATUS_TONE } from '../api.js';
import { records, loadRecords, removeRecord, clearRecords } from '../store.js';

const loading = ref(false);
const querying = ref(false);
const detailVisible = ref(false);
const detail = ref(null);
const manualId = ref('');

/** 本地记录 + 从服务端拉到的状态 */
const rows = computed(() => records.map((r) => ({ ...r })));

const label = (s) => STATUS_LABEL[s] || s;
const tone = (s) => STATUS_TONE[s] || 'info';
const splitSkills = (s) => String(s || '').split(/[,，、;；]/).map((x) => x.trim()).filter(Boolean);

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

/** 逐条向后端核对最新状态；失败的标记为 unknown（记录已被社团删除） */
async function refresh() {
  if (!records.length) return;
  loading.value = true;
  try {
    const results = await Promise.allSettled(
      records.map((r) => getApplication(r.applicationId))
    );
    results.forEach((res, i) => {
      const rec = records[i];
      if (res.status === 'fulfilled' && res.value) {
        rec.status = res.value.status || rec.status;
        if (res.value.position_title) rec.positionName = res.value.position_title;
      } else {
        const code = res.reason && res.reason.status;
        rec.status = code === 404 ? 'unknown' : rec.status;
      }
    });
  } finally {
    loading.value = false;
  }
}

async function openDetail(row) {
  detailVisible.value = true;
  detail.value = null;
  try {
    detail.value = await getApplication(row.applicationId);
    if (detail.value) row.status = detail.value.status || row.status;
  } catch (e) {
    ElMessage.error(e.status === 404 ? '该投递已被社团删除' : (e.message || '查询失败'));
  }
}

async function removeOne(row) {
  try {
    await ElMessageBox.confirm(
      '只删除本机保存的这条记录，不会影响服务端的投递。确定继续？',
      '删除本地记录',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    );
    removeRecord(row.applicationId);
    ElMessage.success('已从本机记录中删除');
  } catch (e) {
    /* 用户取消 */
  }
}

async function clearAll() {
  try {
    await ElMessageBox.confirm(
      '将清空本机保存的全部投递记录（服务端数据不受影响）。清空后可用投递编号重新查询。',
      '清空本地记录',
      { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' }
    );
    clearRecords();
    ElMessage.success('已清空本地记录');
  } catch (e) {
    /* 取消 */
  }
}

async function queryManual() {
  const id = manualId.value.trim();
  if (!id) {
    ElMessage.warning('请输入投递编号');
    return;
  }
  querying.value = true;
  detailVisible.value = true;
  detail.value = null;
  try {
    detail.value = await getApplication(id);
  } catch (e) {
    ElMessage.error(e.status === 404 ? '没有找到该投递编号' : (e.message || '查询失败'));
  } finally {
    querying.value = false;
  }
}

onMounted(async () => {
  loadRecords();
  await refresh();
});
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.head-actions { display: flex; gap: 8px; }
.tip { margin-bottom: 14px; line-height: 1.7; }
.club { font-size: 13.5px; font-weight: 600; color: #1f2d3d; }
.sub { font-size: 11px; color: #a0a6b1; margin-top: 2px; }
.code { font-family: Consolas, monospace; font-size: 12px; color: #606266; }
.query { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.hint { font-size: 12px; color: #909399; margin-top: 10px; line-height: 1.7; }
.content-title { margin: 16px 0 8px; font-size: 13px; font-weight: 600; color: #2e5496; }
.content-body {
  white-space: pre-wrap;
  background: #f7f9fc;
  border: 1px solid #e6e9ef;
  border-radius: 6px;
  padding: 12px 14px;
  font-size: 13px;
  line-height: 1.8;
  color: #303133;
}
.tip2 { margin-top: 14px; line-height: 1.7; }
.muted { color: #a0a6b1; }
</style>
