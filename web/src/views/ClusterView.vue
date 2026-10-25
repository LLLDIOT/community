<template>
  <div class="cluster-page">
    <!-- 未登录 -->
    <el-alert
      v-if="!isLoggedIn"
      type="warning"
      show-icon
      :closable="false"
      title="请先登录社团账号"
    >
      <template #default>
        <div class="gate-row">
          <span>聚类要读取本社团收到的简历正文，需要登录。</span>
          <el-button size="small" type="primary" @click="loginVisible = true">去登录</el-button>
        </div>
      </template>
    </el-alert>

    <template v-else>
      <!-- 说明 -->
      <el-card shadow="never" class="intro">
        <div class="intro-head">
          <div>
            <h3>🧩 候选人分组（无监督聚类）</h3>
            <p>
              用中文语义嵌入把候选人按"画像"分组，再逐组筛选，比一份份看要快。
              <b>这不是分类预测</b>——它不需要任何标注，只在向量空间里找彼此相似的人。
            </p>
          </div>
          <div class="intro-actions">
            <el-tooltip content="自动在 2~4 之间用轮廓系数挑选最优分组数">
              <el-switch v-model="autoK" active-text="自动选 k" inactive-text="手动" @change="load" />
            </el-tooltip>
            <el-input-number
              v-if="!autoK"
              v-model="manualK"
              :min="2"
              :max="6"
              size="small"
              @change="load"
            />
            <el-button type="primary" :loading="loading" @click="load">
              <el-icon><Refresh /></el-icon>&nbsp;重新分组
            </el-button>
          </div>
        </div>

        <!-- 模型状态 -->
        <div class="ml-status">
          <el-tag v-if="mlReady" type="success" effect="dark" size="small">语义模式</el-tag>
          <el-tag v-else type="info" effect="dark" size="small">规则模式</el-tag>
          <span class="ml-note">{{ mlNote }}</span>
        </div>
      </el-card>

      <!-- 指标 -->
      <el-row v-if="result.clusters?.length" :gutter="12" class="metrics">
        <el-col :span="6">
          <el-card shadow="never" :body-style="{ padding: '14px' }">
            <div class="m-num">{{ result.k }}</div>
            <div class="m-lbl">分组数</div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="never" :body-style="{ padding: '14px' }">
            <div class="m-num" :style="{ color: silhouetteColor }">{{ result.silhouette }}</div>
            <div class="m-lbl">轮廓系数（越接近 1 越清晰）</div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="never" :body-style="{ padding: '14px' }">
            <div class="m-num">{{ totalMembers }}</div>
            <div class="m-lbl">覆盖候选人数</div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="never" :body-style="{ padding: '14px' }">
            <div class="m-num" style="font-size: 14px; font-weight: 500">{{ silhouetteHint }}</div>
            <div class="m-lbl">怎么读这个数</div>
          </el-card>
        </el-col>
      </el-row>

      <!-- 分组结果 -->
      <div v-loading="loading" class="clusters">
        <el-card
          v-for="c in result.clusters"
          :key="c.index"
          shadow="hover"
          class="cluster-card"
          :body-style="{ padding: '0' }"
        >
          <div class="c-head">
            <div class="c-title">
              <span class="c-badge">{{ c.index + 1 }}</span>
              第 {{ c.index + 1 }} 组
              <el-tag size="small" type="info" round>{{ c.size }} 人</el-tag>
            </div>
          </div>

          <div class="c-profile">
            <span class="c-label">共同特征</span>
            <div class="c-skills">
              <el-tag
                v-for="p in c.profile"
                :key="p.skill"
                size="small"
                :type="p.count > 1 ? 'success' : 'info'"
                effect="plain"
              >
                {{ p.skill }}<span v-if="p.count > 1"> ×{{ p.count }}</span>
              </el-tag>
              <span v-if="!c.profile.length" class="muted">技能标签较少，无法提炼共同特征</span>
            </div>
          </div>

          <div class="c-members">
            <div v-for="m in c.members" :key="m.applicationId" class="member">
              <div class="member-main">
                <span class="member-name">{{ m.studentName }}</span>
                <span class="member-meta">{{ m.grade || '—' }} · {{ m.major || '—' }}</span>
              </div>
              <div class="member-side">
                <el-tag size="small" effect="plain">{{ m.positionTitle }}</el-tag>
                <el-tag v-if="m.decision" size="small" effect="dark" :type="decisionColor(m.decision)">
                  {{ decisionText(m) }}
                </el-tag>
                <el-tag v-else size="small" type="info" effect="plain">未决定</el-tag>
              </div>
            </div>
          </div>
        </el-card>
      </div>

      <!-- 空状态 -->
      <el-empty
        v-if="!loading && !result.clusters?.length"
        :description="result.reason || '暂无分组结果'"
      >
        <div class="empty-hint">
          <p v-if="!mlReady">
            语义模型未就绪，聚类不可用。<br />
            这不影响其他功能——匹配会自动回退到规则模式。
          </p>
          <p v-else>
            人数太少时聚类没有统计意义（K-means 在 n 很小时会退化出单点簇）。<br />
            建议直接到「面试与录用」工作台人工筛选。
          </p>
        </div>
      </el-empty>

      <!-- 说明脚注 -->
      <el-alert type="info" :closable="false" class="footnote">
        <template #default>
          <b>怎么用这个页面：</b>先看每组「共同特征」，判断这是哪一类候选人；
          再进组内逐份筛选。分组只提供<b>视角</b>，不替你做录用决定。
          <br />
          <b>为什么可能分不出来：</b>如果投递的人本身很同质（比如都填了相似技能），
          轮廓系数会接近 0，说明"这批人分不出明显类别"——这也是有价值的结论。
        </template>
      </el-alert>
    </template>

    <LoginDialog v-model="loginVisible" @success="onLoggedIn" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { mlApi } from '../api/index.js';
import { isLoggedIn, account, init as initAuth } from '../stores/auth.js';
import LoginDialog from '../components/LoginDialog.vue';

const loginVisible = ref(false);
const loading = ref(false);
const autoK = ref(true);
const manualK = ref(3);
const mlReady = ref(false);
const mlNote = ref('');

const result = reactive({ available: false, clusters: [], k: 0, silhouette: 0, reason: '' });

const myClubId = computed(() => account.value?.clubId || '');
const totalMembers = computed(() =>
  (result.clusters || []).reduce((s, c) => s + c.size, 0)
);

const silhouetteColor = computed(() => {
  const s = result.silhouette;
  if (s >= 0.5) return '#67C23A';
  if (s >= 0.25) return '#E6A23C';
  return '#909399';
});

const silhouetteHint = computed(() => {
  const s = result.silhouette;
  if (s >= 0.5) return '分组清晰';
  if (s >= 0.25) return '勉强可分';
  if (s >= 0) return '较同质';
  return '基本分不开';
});

const DECISION_COLOR = { hired: 'success', waitlist: 'warning', adjust: 'primary', reject: 'danger' };
const decisionColor = (d) => DECISION_COLOR[d] || 'info';
const decisionText = (m) =>
  m.decision === 'waitlist'
    ? `候补`
    : m.decision === 'hired'
      ? '录用'
      : m.decision === 'adjust'
        ? '调剂'
        : m.decision === 'reject'
          ? '淘汰'
          : '';

async function loadStatus() {
  try {
    const st = await mlApi.status();
    mlReady.value = Boolean(st?.ready);
    mlNote.value = st?.note || '';
  } catch {
    mlReady.value = false;
    mlNote.value = '模型状态获取失败';
  }
}

async function load() {
  if (!isLoggedIn.value) return;
  loading.value = true;
  try {
    const params = autoK.value ? {} : { k: manualK.value };
    const data = await mlApi.clusters(myClubId.value, params);
    Object.assign(result, {
      available: data.available,
      clusters: data.clusters || [],
      k: data.k || 0,
      silhouette: data.silhouette ?? 0,
      reason: data.reason || '',
    });
  } catch {
    /* 错误提示由拦截器给出 */
  } finally {
    loading.value = false;
  }
}

async function onLoggedIn() {
  await initAuth();
  await loadStatus();
  await load();
}

watch(
  () => myClubId.value,
  async (id, prev) => {
    if (id === prev) return;
    if (id) {
      await loadStatus();
      await load();
    } else {
      Object.assign(result, { clusters: [], k: 0, silhouette: 0, reason: '' });
    }
  }
);

onMounted(async () => {
  await initAuth();
  await loadStatus();
  await load();
});
</script>

<style scoped>
.cluster-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.gate-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.intro-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}
.intro-head h3 {
  margin: 0 0 6px;
  font-size: 16px;
  color: #1f2d3d;
}
.intro-head p {
  margin: 0;
  font-size: 13px;
  color: #606266;
  line-height: 1.7;
  max-width: 760px;
}
.intro-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ml-status {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  color: #909399;
}
.ml-note {
  line-height: 1.5;
}
.metrics {
  margin: 0;
}
.m-num {
  font-size: 22px;
  font-weight: 700;
  color: #1f2d3d;
}
.m-lbl {
  font-size: 11.5px;
  color: #909399;
  margin-top: 2px;
}
.clusters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  gap: 14px;
  min-height: 80px;
}
.cluster-card {
  border-top: 3px solid #409eff;
}
.c-head {
  padding: 12px 16px;
  background: #f7f9fc;
}
.c-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #1f2d3d;
}
.c-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #409eff;
  color: #fff;
  font-size: 12px;
}
.c-profile {
  padding: 12px 16px;
  border-bottom: 1px dashed #ebeef5;
}
.c-label {
  font-size: 12px;
  color: #909399;
  margin-right: 8px;
}
.c-skills {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  vertical-align: middle;
}
.c-members {
  padding: 4px 0;
}
.member {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 9px 16px;
  border-bottom: 1px solid #f5f7fa;
}
.member:last-child {
  border-bottom: none;
}
.member-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.member-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #1f2d3d;
}
.member-meta {
  font-size: 11.5px;
  color: #909399;
  margin-top: 2px;
}
.member-side {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.muted {
  color: #c0c4cc;
  font-size: 12px;
}
.empty-hint {
  font-size: 13px;
  color: #909399;
  line-height: 1.8;
}
.footnote {
  line-height: 1.8;
}
</style>
