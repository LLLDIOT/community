<template>
  <div class="match-view">
    <!-- 说明横幅 -->
    <el-alert
      type="info"
      show-icon
      :closable="false"
      title="智能匹配：简历技能标签 × 岗位期望技能自动算匹配度，帮助发现合适的人与合适的岗位。"
    />

    <!-- 上半部分：选简历 → 推荐岗位 -->
    <el-card shadow="never" class="mt-16">
      <template #header>
        <div class="card-head">
          <span class="card-title">① 简历 → 推荐岗位</span>
          <span class="hint">选择一份简历，系统按技能标签给所有开放岗位算匹配度</span>
        </div>
      </template>
      <div class="pick-row">
        <el-select v-model="resumeId" placeholder="选择简历（按姓名搜索）" filterable style="width: 280px" @change="loadMatch">
          <el-option v-for="r in resumes" :key="r.id" :label="`${r.student_name}（${r.major || '-'} / ${r.grade || '-'}）`" :value="r.id" />
        </el-select>
        <el-button type="primary" :disabled="!resumeId" @click="loadMatch">计算匹配</el-button>
      </div>

      <template v-if="matchResult">
        <el-divider content-position="left">
          匹配结果 · {{ matchResult.resume.student_name }}
          <el-tag size="small" type="warning" style="margin-left: 8px">技能：{{ matchResult.resume.skills || '未填写' }}</el-tag>
        </el-divider>
        <el-empty v-if="matchResult.recommendations.length === 0" description="暂无任何岗位可匹配（可先给岗位配置期望技能）" />
        <div v-else class="match-list">
          <el-card
            v-for="(rec, i) in matchResult.recommendations"
            :key="rec.positionId"
            shadow="hover"
            class="match-item"
          >
            <div class="match-rank" :class="{ top: i < 3 }">{{ i + 1 }}</div>
            <div class="match-main">
              <div class="match-title">
                <span class="club">{{ rec.clubName }}</span>
                <span class="pos">{{ rec.recruitmentTitle }} · {{ rec.positionTitle }}</span>
                <el-tag size="small" :type="rec.status === 'open' ? 'success' : 'info'">
                  {{ rec.status === 'open' ? '招新中' : '已结束' }}
                </el-tag>
                <span class="quota" v-if="rec.headcount">名额 {{ rec.filledCount }}/{{ rec.headcount }}</span>
              </div>
              <div class="match-skills">
                <template v-if="rec.hitSkills.length">
                  <span class="skill-hit" v-for="s in rec.hitSkills" :key="s">{{ s }} ✓</span>
                </template>
                <template v-if="rec.missingSkills.length">
                  <span class="skill-miss" v-for="s in rec.missingSkills" :key="s">{{ s }}</span>
                </template>
                <span v-if="!rec.hitSkills.length && !rec.missingSkills.length" class="muted">岗位未配置期望技能</span>
              </div>
            </div>
            <div class="match-score-col">
              <el-progress
                type="circle"
                :percentage="rec.score"
                :width="64"
                :color="scoreColor(rec.score)"
              />
            </div>
          </el-card>
        </div>
      </template>
    </el-card>

    <!-- 下半部分：社团漏推岗位发现 -->
    <el-card shadow="never" class="mt-16">
      <template #header>
        <div class="card-head">
          <span class="card-title">② 社团内"换岗再推荐"（未录取者 × 开放岗位）</span>
          <span class="hint">某投递者的技能与他投的岗位不匹配，但和社内另一个岗位很匹配 —— 建议引导转投</span>
        </div>
      </template>
      <div class="pick-row">
        <el-select v-model="clubId" placeholder="选择社团" style="width: 200px" @change="loadClubMatches">
          <el-option v-for="c in clubs" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-button type="primary" plain :disabled="!clubId" @click="loadClubMatches">分析</el-button>
      </div>

      <el-empty v-if="clubMatchesLoaded && suggestions.length === 0" description="该社团暂无 50%+ 的转岗建议（或没有开放岗位/未录取投递）" />
      <el-table v-else-if="suggestions.length" :data="suggestions" class="mt-16" size="default">
        <el-table-column label="学生" width="110">
          <template #default="{ row }">
            <b>{{ row.studentName }}</b>
          </template>
        </el-table-column>
        <el-table-column label="当前投递" min-width="150">
          <template #default="{ row }">
            {{ row.currentPosition }}
            <el-tag size="small" :type="'info'" style="margin-left: 6px">{{ statusLabel(row.appStatus) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="建议改投岗位" min-width="180">
          <template #default="{ row }">
            <span class="suggest">{{ row.suggested.positionTitle }}</span>
            <span class="muted" style="margin-left: 6px">（{{ row.suggested.clubName }}）</span>
          </template>
        </el-table-column>
        <el-table-column label="匹配度" width="200">
          <template #default="{ row }">
            <el-progress :percentage="row.suggested.score" :color="scoreColor(row.suggested.score)" :stroke-width="10" style="width: 150px" />
          </template>
        </el-table-column>
        <el-table-column label="命中技能" min-width="150">
          <template #default="{ row }">
            <span class="skill-hit" v-for="s in row.suggested.hitSkills" :key="s">{{ s }} ✓</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { clubApi, matchApi, applicationApi } from '../api/index.js';
import { ElMessage } from 'element-plus';

const clubs = ref([]);
const resumes = ref([]);
const clubId = ref('');
const resumeId = ref('');
const matchResult = ref(null);
const suggestions = ref([]);
const clubMatchesLoaded = ref(false);

const STATUS_LABELS = {
  new: '新收到', screening: '待筛选', interviewing: '面试中',
  admitted: '已录取', rejected: '已淘汰', archived: '已归档',
};
const statusLabel = (s) => STATUS_LABELS[s] || s;
const scoreColor = (score) => (score >= 70 ? '#67C23A' : score >= 40 ? '#E6A23C' : '#909399');

async function loadMatch() {
  if (!resumeId.value) return;
  matchResult.value = await matchApi.matchTop(resumeId.value, { limit: 20, minScore: 0 });
  if (matchResult.value.recommendations.length === 0) {
    ElMessage.info('该简历暂无匹配岗位（可先为岗位配置期望技能标签）');
  }
}

async function loadClubMatches() {
  if (!clubId.value) return;
  suggestions.value = await matchApi.matchApplicants(clubId.value, { limit: 50 });
  clubMatchesLoaded.value = true;
}

onMounted(async () => {
  const [clubData] = await Promise.all([
    clubApi.list({ page: 1, pageSize: 100 }),
    loadAllResumes(),
  ]);
  clubs.value = clubData.list;
});

/** 简历没有列表接口：从各社团应用数据里搜集，或直接提示新建 */
async function loadAllResumes() {
  // resume 无独立 list API（内部归档用），此处先收集应用过的简历，够演示使用
  try {
    const clubsData = await clubApi.list({ page: 1, pageSize: 100 });
    const seen = new Map();
    for (const c of clubsData.list) {
      const apps = await applicationApi.listByClub(c.id, { page: 1, pageSize: 100 });
      for (const a of apps.list) {
        const det = await applicationApi.detail(a.id);
        if (det && !seen.has(det.resume_id)) {
          seen.set(det.resume_id, {
            id: det.resume_id,
            student_name: det.student_name,
            major: det.major,
            grade: det.grade,
            skills: det.skills || '',
          });
        }
      }
    }
    resumes.value = [...seen.values()];
  } catch {
    resumes.value = [];
  }
}
</script>

<style scoped>
.mt-16 { margin-top: 16px; }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.card-title { font-weight: 600; }
.hint { color: #909399; font-size: 12px; }
.pick-row { display: flex; gap: 10px; }
.match-list { display: flex; flex-direction: column; gap: 10px; }
.match-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 6px 8px;
}
.match-rank {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #f0f2f5;
  color: #606266;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  flex-shrink: 0;
}
.match-rank.top {
  background: #409eff;
  color: #fff;
}
.match-main { flex: 1; min-width: 0; }
.match-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.match-title .club { font-weight: 700; color: #409eff; }
.match-title .pos { font-weight: 500; }
.quota { color: #909399; font-size: 12px; }
.match-skills { margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; }
.skill-hit {
  font-size: 12px;
  background: #f0f9eb;
  color: #67c23a;
  border: 1px solid #e1f3d8;
  border-radius: 4px;
  padding: 1px 6px;
}
.skill-miss {
  font-size: 12px;
  background: #f4f4f5;
  color: #a8abb2;
  border: 1px dashed #dcdfe6;
  border-radius: 4px;
  padding: 1px 6px;
}
.match-score-col { flex-shrink: 0; }
.muted { color: #c0c4cc; font-size: 12px; }
.suggest { font-weight: 600; color: #67c23a; }
</style>
