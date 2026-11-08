<template>
  <div class="page">
    <el-card shadow="never" class="toolbar-card">
      <div class="toolbar">
        <el-input
          v-model="keyword"
          placeholder="搜索社团名称或简介"
          clearable
          style="width: 240px"
          @keyup.enter="load"
          @clear="load"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="category" placeholder="全部类别" clearable style="width: 150px" @change="load">
          <el-option v-for="c in CATEGORIES" :key="c.value" :label="c.label" :value="c.value" />
        </el-select>
        <el-button type="primary" :loading="loading" @click="load">
          <el-icon><Refresh /></el-icon>&nbsp;刷新
        </el-button>
        <div class="spacer" />
        <el-button v-if="records.length" plain @click="$router.push('/progress')">
          已有 {{ records.length }} 条投递，查看进度
        </el-button>
      </div>
    </el-card>

    <div class="stats">
      <div class="stat">
        <div class="n">{{ total }}</div>
        <div class="l">可见社团</div>
      </div>
      <div class="stat">
        <div class="n">{{ openPositionCount }}</div>
        <div class="l">在招岗位</div>
      </div>
      <div class="stat">
        <div class="n">{{ records.length }}</div>
        <div class="l">我的投递</div>
      </div>
      <div class="stat">
        <div class="n" :class="{ ok: profileReady }">{{ profileReady ? '已填写' : '未填写' }}</div>
        <div class="l">学生资料</div>
      </div>
    </div>

    <el-alert
      v-if="!profileReady"
      type="warning"
      :closable="false"
      show-icon
      class="notice"
      title="还没有填写学生资料：投递时需要逐项手填。填写一次后，之后每个社团的表单都会自动带出。"
    />

    <div v-loading="loading" class="grid-wrap">
      <el-empty v-if="!loading && clubs.length === 0" description="没有符合条件的社团" />

      <div class="grid">
        <el-card v-for="c in clubs" :key="c.id" shadow="hover" class="club-card" :body-style="{ padding: '0' }">
          <div class="head">
            <div class="avatar" :style="{ background: colorOf(c.id) }">{{ iconOf(c.category) }}</div>
            <div class="head-main">
              <div class="name">{{ c.name }}</div>
              <div class="meta">
                <el-tag size="small" effect="plain">{{ categoryLabel(c.category) }}</el-tag>
                <span v-if="c.scale_label || c.scale" class="scale">{{ c.scale_label || '规模 ' + c.scale }}</span>
              </div>
            </div>
          </div>

          <div class="desc">{{ c.description || '该社团暂未填写介绍' }}</div>

          <div class="facts">
            <div class="fact">
              <span class="k">在招岗位</span>
              <span class="v">{{ statsOf(c.id).open || '—' }}</span>
            </div>
            <div class="fact">
              <span class="k">招新批次</span>
              <span class="v">{{ statsOf(c.id).openRec || '—' }}</span>
            </div>
            <div class="fact">
              <span class="k">投递窗口</span>
              <span class="v" :class="{ muted: !statsOf(c.id).window }">
                {{ statsOf(c.id).window || '以社团公告为准' }}
              </span>
            </div>
          </div>

          <div class="actions">
            <el-button type="primary" @click="$router.push(`/clubs/${c.id}`)">
              查看岗位并投递
            </el-button>
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue';
import { listClubs, getClub, CATEGORIES, CATEGORY_ICON, categoryLabel } from '../api.js';
import { records, profile, profileReady } from '../store.js';

const loading = ref(false);
const keyword = ref('');
const category = ref('');
const clubs = ref([]);
const total = ref(0);
/** clubId -> { open, openRec, window } */
const stats = ref({});

const PALETTE = ['#6c5ce7', '#e17055', '#00b894', '#0984e3', '#fd79a8', '#636e72', '#e0902a'];
function hash(str) {
  let h = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return h;
}
const colorOf = (id) => PALETTE[hash(id) % PALETTE.length];
const iconOf = (cat) => CATEGORY_ICON[cat] || CATEGORY_ICON.other;
const statsOf = (id) => stats.value[id] || {};

const openPositionCount = computed(() =>
  Object.values(stats.value).reduce((s, x) => s + (x.open || 0), 0)
);

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 列表接口只返回社团本身，不带岗位数。
 * 为了在卡片上显示"在招岗位"，对每个社团并发取一次详情。
 * 社团数量少（十几个），可以接受；失败时静默降级为不显示统计。
 */
async function loadStats(list) {
  const picks = list.slice(0, 24);
  const results = await Promise.allSettled(picks.map((c) => getClub(c.id)));
  const next = { ...stats.value };
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const d = r.value;
    const recs = d.recruitments || [];
    const openRecs = recs.filter((x) => x.status === 'open');
    const open = openRecs.reduce((s, rec) => s + ((rec.positions || []).filter((p) => (p.filled_count || 0) < (p.headcount || 0) || !p.headcount).length), 0);
    const win = d.apply_start_at || d.apply_end_at
      ? `${fmtDate(d.apply_start_at)} - ${fmtDate(d.apply_end_at)}`
      : '';
    next[picks[i].id] = { open, openRec: openRecs.length, window: win };
  });
  stats.value = next;
}

async function load() {
  loading.value = true;
  try {
    const data = await listClubs({ keyword: keyword.value.trim(), category: category.value });
    clubs.value = data.list || [];
    total.value = data.total || clubs.value.length;
    await loadStats(clubs.value);
  } catch (e) {
    clubs.value = [];
    total.value = 0;
    // 错误提示交给页面上的空状态，避免弹出过多 toast
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; }
.toolbar-card :deep(.el-card__body) { padding: 12px 14px; }
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.spacer { flex: 1; }

.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.stat { background: #fff; border: 1px solid #e6e9ef; border-radius: 8px; padding: 14px 16px; }
.stat .n { font-size: 22px; font-weight: 700; color: #1f2d3d; line-height: 1.2; }
.stat .n.ok { color: #25a35a; font-size: 17px; }
.stat .l { font-size: 12px; color: #909399; margin-top: 2px; }

.notice { line-height: 1.7; }

.grid-wrap { min-height: 140px; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 14px;
}
.club-card { border-top: 3px solid #4f8cff; }
.head { display: flex; gap: 12px; padding: 14px 16px 10px; }
.avatar {
  width: 46px; height: 46px; border-radius: 10px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 22px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}
.head-main { min-width: 0; }
.name { font-size: 15px; font-weight: 700; color: #1f2d3d; }
.meta { display: flex; align-items: center; gap: 8px; margin-top: 5px; flex-wrap: wrap; }
.scale { font-size: 11.5px; color: #909399; }

.desc {
  padding: 0 16px;
  font-size: 12.5px;
  color: #606266;
  line-height: 1.75;
  height: 44px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 12px 16px;
  margin-top: 6px;
  border-top: 1px dashed #ebeef5;
}
.fact { display: flex; flex-direction: column; gap: 2px; }
.fact .k { font-size: 11px; color: #a0a6b1; }
.fact .v { font-size: 13px; font-weight: 600; color: #1f2d3d; }
.fact .v.muted { font-weight: 400; font-size: 11.5px; color: #a0a6b1; }
.actions { padding: 0 16px 14px; }
.actions :deep(.el-button) { width: 100%; }
</style>
