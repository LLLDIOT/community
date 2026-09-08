<template>
  <div class="dashboard" v-loading="loading">
    <!-- 顶部：全局/按社团切换 + 刷新 -->
    <el-card shadow="never" class="toolbar">
      <div class="toolbar-inner">
        <span class="label">数据范围：</span>
        <el-select v-model="clubId" placeholder="全部社团" clearable style="width: 200px" @change="load">
          <el-option v-for="c in clubs" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-radio-group v-model="days" @change="load" style="margin-left: 12px">
          <el-radio-button :value="7">近7天</el-radio-button>
          <el-radio-button :value="30">近30天</el-radio-button>
          <el-radio-button :value="90">近90天</el-radio-button>
        </el-radio-group>
        <el-button style="margin-left: auto" @click="load">
          <el-icon><Refresh /></el-icon>&nbsp;刷新
        </el-button>
      </div>
    </el-card>

    <!-- 1. 核心指标卡 -->
    <el-row :gutter="12" class="stat-row">
      <el-col :xs="12" :sm="8" :md="4" v-for="s in coreCards" :key="s.label">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-value" :style="{ color: s.color }">{{ s.value }}</div>
          <div class="stat-label">{{ s.label }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 2. 招新漏斗 + 趋势 -->
    <el-row :gutter="12">
      <el-col :md="10">
        <el-card shadow="never" header="招新漏斗（投递处理状态）">
          <EChart :option="funnelOption" height="320px" />
        </el-card>
      </el-col>
      <el-col :md="14">
        <el-card shadow="never" :header="`投递趋势（近 ${days} 天）`">
          <EChart :option="trendOption" height="320px" />
        </el-card>
      </el-col>
    </el-row>

    <!-- 3. 分布：类型 / 年级 -->
    <el-row :gutter="12" class="mt">
      <el-col :md="10">
        <el-card shadow="never" header="简历类型分布">
          <EChart :option="typeOption" height="280px" />
        </el-card>
      </el-col>
      <el-col :md="14">
        <el-card shadow="never" header="投递学生年级分布">
          <EChart :option="gradeOption" height="280px" />
        </el-card>
      </el-col>
    </el-row>

    <!-- 4. 岗位招新进度 -->
    <el-card shadow="never" class="mt" header="岗位招新进度（录取 / 需求）">
      <el-empty v-if="progress.length === 0" description="暂无岗位数据" />
      <template v-else>
        <div v-for="p in progress" :key="p.position_id" class="progress-item">
          <div class="progress-info">
            <span class="club">{{ p.club_name }}</span>
            <span class="pos">{{ p.recruitment_title }} · {{ p.position_title }}</span>
            <el-tag size="small" :type="recTag(p.recruitment_status)" class="rec-status">
              {{ recLabel(p.recruitment_status) }}
            </el-tag>
          </div>
          <div class="progress-bar">
            <el-progress
              :percentage="pct(p.filled_count, p.headcount)"
              :stroke-width="12"
              :color="p.filled_count >= p.headcount ? '#67C23A' : '#409EFF'"
            />
          </div>
          <div class="progress-num">{{ p.filled_count }} / {{ p.headcount }}</div>
        </div>
      </template>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import EChart from '../components/EChart.vue';
import { clubApi, dashboardApi } from '../api/index.js';

const TYPE_LABELS = {
  technical: '技术型', organizing: '组织策划型', artistic: '文艺特长型',
  sports: '体育型', academic: '学术竞赛型', service: '志愿服务型', other: '其他',
};
const STATUS_COLORS = {
  new: '#F56C6C', screening: '#E6A23C', interviewing: '#8E44AD',
  admitted: '#67C23A', rejected: '#909399', archived: '#C0C4CC',
};
const STATUS_LABELS = {
  new: '新收到', screening: '待筛选', interviewing: '面试中',
  admitted: '已录取', rejected: '已淘汰', archived: '已归档',
};

const loading = ref(false);
const clubs = ref([]);
const clubId = ref('');
const days = ref(30);
const data = ref(null);

const coreCards = computed(() => {
  const core = data.value?.core || {};
  return [
    { label: '社团总数', value: core.clubsCount ?? 0, color: '#409EFF' },
    { label: '招新批次', value: core.recruitmentsCount ?? 0, color: '#67C23A' },
    { label: '开放岗位', value: core.openPositionsCount ?? 0, color: '#E6A23C' },
    { label: '累计投递', value: core.applicationsCount ?? 0, color: '#8E44AD' },
    { label: '累计录取', value: core.admittedCount ?? 0, color: '#67C23A' },
    {
      label: '录取率',
      value: core.applicationsCount ? `${Math.round((core.admittedCount / core.applicationsCount) * 100)}%` : '—',
      color: '#F56C6C',
    },
  ];
});

const funnelOption = computed(() => {
  const funnel = data.value?.funnel || [];
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} 份' },
    legend: { bottom: 0 },
    series: [
      {
        type: 'funnel',
        left: '8%',
        top: 10,
        bottom: 30,
        width: '84%',
        minSize: '20%',
        label: { formatter: '{b} {c}' },
        data: funnel
          .filter((f) => f.count > 0)
          .map((f) => ({
            name: STATUS_LABELS[f.status] || f.status,
            value: f.count,
            itemStyle: { color: STATUS_COLORS[f.status] },
          })),
      },
    ],
  };
});

const trendOption = computed(() => {
  const trend = data.value?.trend || [];
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 16, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: trend.map((t) => t.date.slice(5)), axisLabel: { rotate: 30 } },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        name: '投递数',
        type: 'line',
        smooth: true,
        areaStyle: { opacity: 0.15 },
        data: trend.map((t) => t.count),
      },
    ],
  };
});

const typeOption = computed(() => {
  const dist = data.value?.distributions?.typeTag || [];
  const hasData = dist.some((d) => d.value > 0);
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    series: [
      {
        type: 'pie',
        radius: ['38%', '68%'],
        label: { formatter: '{b} {c}' },
        data: hasData ? dist.map((d) => ({ name: TYPE_LABELS[d.name] || d.name, value: d.value })) : [],
      },
    ],
    graphic: hasData ? undefined : emptyGraphic(),
  };
});

const gradeOption = computed(() => {
  const dist = data.value?.distributions?.grade || [];
  const hasData = dist.some((d) => d.value > 0);
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 60, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: { type: 'category', data: dist.map((d) => d.name).reverse() },
    series: [
      {
        type: 'bar',
        barWidth: 22,
        itemStyle: { color: '#409EFF', borderRadius: [0, 4, 4, 0] },
        data: dist.map((d) => d.value).reverse(),
        label: { show: true, position: 'right' },
      },
    ],
    graphic: hasData ? undefined : emptyGraphic(),
  };
});

function emptyGraphic() {
  return [
    {
      type: 'text',
      left: 'center',
      top: 'middle',
      style: { text: '暂无数据', fill: '#c0c4cc', fontSize: 14 },
    },
  ];
}

const progress = computed(() => data.value?.progress || []);
const pct = (filled, headcount) => (headcount ? Math.round((filled / headcount) * 100) : 0);
const recLabel = (s) => ({ draft: '草稿', open: '招新中', closed: '已结束' }[s] || s);
const recTag = (s) => ({ draft: 'info', open: 'success', closed: 'warning' }[s] || 'info');

async function load() {
  loading.value = true;
  try {
    data.value = await dashboardApi.get({ clubId: clubId.value || undefined, days: days.value });
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  const clubData = await clubApi.list({ page: 1, pageSize: 100 });
  clubs.value = clubData.list;
  await load();
});
</script>

<style scoped>
.toolbar-inner {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.label {
  color: #606266;
  font-size: 14px;
}
.stat-row {
  margin: 12px 0;
}
.stat-card {
  text-align: center;
  margin-bottom: 12px;
}
.stat-value {
  font-size: 28px;
  font-weight: 700;
}
.stat-label {
  color: #909399;
  font-size: 13px;
  margin-top: 4px;
}
.mt {
  margin-top: 12px;
}
.progress-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #f0f2f5;
}
.progress-item:last-child {
  border-bottom: none;
}
.progress-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 280px;
}
.club {
  font-weight: 600;
  color: #409eff;
}
.pos {
  color: #303133;
}
.rec-status {
  flex-shrink: 0;
}
.progress-bar {
  flex: 1;
}
.progress-num {
  width: 70px;
  text-align: right;
  color: #606266;
  font-size: 13px;
}
</style>
