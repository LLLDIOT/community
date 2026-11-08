<template>
  <div class="page" v-loading="loading">
    <el-page-header @back="$router.push('/clubs')" class="ph">
      <template #content>
        <span class="ph-title">{{ club?.name || '社团详情' }}</span>
        <el-tag v-if="club" size="small" effect="plain" class="ph-tag">{{ categoryLabel(club.category) }}</el-tag>
      </template>
      <template #extra>
        <el-button v-if="records.length" plain size="small" @click="$router.push('/progress')">
          我的投递（{{ records.length }}）
        </el-button>
      </template>
    </el-page-header>

    <el-empty v-if="!loading && !club" description="社团不存在或已下架" />

    <template v-if="club">
      <el-card shadow="never" class="info-card">
        <div class="info-grid">
          <div class="info-main">
            <h3>{{ club.name }}</h3>
            <p class="intro">{{ club.description || '该社团暂未填写介绍' }}</p>

            <div class="block">
              <div class="block-title">录入标准</div>
              <div class="block-body">{{ club.entry_criteria || '社团未单独填写录入标准，以岗位要求为准。' }}</div>
            </div>

            <div class="block">
              <div class="block-title">投递时间窗</div>
              <div class="block-body">{{ windowText }}</div>
            </div>
          </div>

          <div class="info-side">
            <div class="side-item">
              <div class="k">社团规模</div>
              <div class="v">{{ club.scale_label || club.scale || '—' }}</div>
            </div>
            <div class="side-item">
              <div class="k">在招岗位</div>
              <div class="v">{{ openPositions.length }}</div>
            </div>
            <div class="side-item">
              <div class="k">联系方式</div>
              <div class="v small">{{ contactText }}</div>
            </div>
          </div>
        </div>
      </el-card>

      <el-alert
        v-if="!profileReady"
        type="warning"
        :closable="false"
        show-icon
        class="notice"
        title="建议先填写学生资料，投递表单会自动带出姓名、学院、联系方式与技能。"
      />

      <el-card shadow="never">
        <template #header>
          <div class="card-head">
            <span>招新岗位</span>
            <el-tag size="small" effect="plain">{{ openPositions.length }} 个在招</el-tag>
          </div>
        </template>

        <el-empty v-if="allPositions.length === 0" description="该社团暂无岗位" />

        <el-table v-else :data="allPositions" size="default" style="width: 100%">
          <el-table-column label="岗位" min-width="150">
            <template #default="{ row }">
              <div class="pos-name">{{ row.title }}</div>
              <div class="pos-rec">{{ row.recruitmentTitle }}</div>
            </template>
          </el-table-column>

          <el-table-column label="岗位要求" min-width="230">
            <template #default="{ row }">
              <div class="req">{{ row.requirement || '（暂无具体要求说明）' }}</div>
            </template>
          </el-table-column>

          <el-table-column label="名额" width="110" align="center">
            <template #default="{ row }">
              <span class="quota">{{ row.filled }} / {{ row.headcount }}</span>
            </template>
          </el-table-column>

          <el-table-column label="状态" width="110" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.closed" size="small" type="info">批次已结束</el-tag>
              <el-tag v-else-if="row.full" size="small" type="warning">已招满</el-tag>
              <el-tag v-else size="small" type="success">招新中</el-tag>
            </template>
          </el-table-column>

          <el-table-column label="操作" width="120" align="center">
            <template #default="{ row }">
              <el-button
                type="primary"
                link
                :disabled="row.closed || row.full"
                @click="openApply(row)"
              >
                投递该岗位
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>

    <!-- 投递抽屉 -->
    <el-drawer
      v-model="applyVisible"
      :title="`投递 · ${applyTarget?.title || ''}`"
      size="560px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form :model="form" label-position="top" class="apply-form">
        <div class="group-title">基本信息</div>
        <div class="row2">
          <el-form-item label="姓名" required>
            <el-input v-model="form.name" placeholder="真实姓名" maxlength="20" />
          </el-form-item>
          <el-form-item label="年级">
            <el-select v-model="form.grade" placeholder="请选择" clearable style="width: 100%">
              <el-option v-for="g in GRADES" :key="g" :label="g" :value="g" />
            </el-select>
          </el-form-item>
        </div>
        <div class="row2">
          <el-form-item label="学校 / 学院">
            <el-input v-model="form.college" placeholder="例如：示例大学 计算机学院" />
          </el-form-item>
          <el-form-item label="专业">
            <el-input v-model="form.major" placeholder="例如：软件工程" />
          </el-form-item>
        </div>
        <div class="row2">
          <el-form-item label="手机号">
            <el-input v-model="form.phone" placeholder="选填" maxlength="20" />
          </el-form-item>
          <el-form-item label="邮箱">
            <el-input v-model="form.email" placeholder="选填" maxlength="60" />
          </el-form-item>
        </div>
        <el-form-item label="技能标签">
          <el-input v-model="form.skills" placeholder="用逗号分隔，例如：Vue,Node.js,活动策划" />
          <div class="hint">技能标签会参与社团端的匹配计算。</div>
        </el-form-item>

        <div class="group-title">
          简历内容
          <span class="group-sub">{{ templateDesc }}</span>
        </div>
        <el-form-item v-for="f in templateFields" :key="f.key" :label="f.label">
          <el-input
            v-if="f.type === 'input'"
            v-model="templateData[f.key]"
            :placeholder="f.source === 'auto' ? '已按学生资料自动填充，可修改' : '选填'"
          />
          <el-input
            v-else
            v-model="templateData[f.key]"
            type="textarea"
            :rows="3"
            :placeholder="f.source === 'auto' ? '已按学生资料自动填充，可修改' : '选填'"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="drawer-foot">
          <el-button @click="applyVisible = false">取消</el-button>
          <el-button type="primary" :loading="submitting" @click="submitApply">确认投递</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getClub, createResume, createApplication, categoryLabel } from '../api.js';
import { profile, profileReady, loadProfile, addRecord, records } from '../store.js';
import { templateFor, autoFill, buildContent, guessTypeTag } from '../templates.js';

const route = useRoute();
const router = useRouter();

const GRADES = ['大一', '大二', '大三', '大四', '研一', '研二', '研三'];

const loading = ref(false);
const club = ref(null);

const applyVisible = ref(false);
const applyTarget = ref(null);
const submitting = ref(false);

const form = reactive({
  name: '', phone: '', email: '', college: '', major: '', grade: '', skills: '',
});
const templateData = reactive({});

/* 模板随社团分类变化 */
const template = computed(() => templateFor(club.value?.category));
const templateFields = computed(() => template.value.fields);
const templateDesc = computed(() => template.value.desc);

/** 把批次与岗位拼成平铺列表 */
const allPositions = computed(() => {
  if (!club.value) return [];
  const out = [];
  for (const rec of club.value.recruitments || []) {
    for (const p of rec.positions || []) {
      const headcount = p.headcount || 0;
      const filled = p.filled_count || 0;
      out.push({
        ...p,
        recruitmentId: rec.id,
        recruitmentTitle: rec.title,
        closed: rec.status !== 'open',
        full: headcount > 0 && filled >= headcount,
        headcount,
        filled,
      });
    }
  }
  return out;
});

const openPositions = computed(() =>
  allPositions.value.filter((p) => !p.closed && !p.full)
);

const contactText = computed(() => {
  if (!club.value) return '—';
  return [club.value.contact_name, club.value.contact_phone, club.value.contact_email]
    .filter(Boolean).join(' / ') || '社团未留联系方式';
});

const windowText = computed(() => {
  if (!club.value) return '—';
  const s = club.value.apply_start_at;
  const e = club.value.apply_end_at;
  if (!s && !e) return '社团未设置统一时间窗，按各批次状态为准';
  const f = (x) => (x ? new Date(x).toLocaleDateString('zh-CN') : '—');
  return `${f(s)} 至 ${f(e)}`;
});

async function load() {
  loading.value = true;
  try {
    club.value = await getClub(route.params.id);
  } catch (e) {
    club.value = null;
    ElMessage.error(e.message || '加载社团失败');
  } finally {
    loading.value = false;
  }
}

function openApply(row) {
  if (row.closed || row.full) return;
  loadProfile();
  applyTarget.value = row;

  Object.assign(form, {
    name: profile.name || '',
    phone: profile.phone || '',
    email: profile.email || '',
    college: profile.college || '',
    major: profile.major || '',
    grade: profile.grade || '',
    skills: profile.skills || '',
  });

  // 清空并重新自动填充模板
  Object.keys(templateData).forEach((k) => delete templateData[k]);
  Object.assign(templateData, autoFill(templateFields.value, profile, {}));

  applyVisible.value = true;
}

async function submitApply() {
  if (!applyTarget.value) return;
  if (!form.name.trim()) {
    ElMessage.warning('请填写姓名');
    return;
  }

  submitting.value = true;
  try {
    const content = buildContent(templateFields.value, templateData);

    // ① 建简历
    const resume = await createResume({
      studentName: form.name.trim(),
      phone: form.phone || null,
      email: form.email || null,
      school: form.college || null,
      major: form.major || null,
      grade: form.grade || null,
      skills: form.skills || null,
      content,
    });

    // ② 投递
    const app = await createApplication(applyTarget.value.id, {
      resumeId: resume.id,
      typeTag: guessTypeTag(club.value.category),
    });

    // ③ 本地只存索引
    addRecord({
      applicationId: app.id,
      clubId: club.value.id,
      clubName: club.value.name,
      positionName: applyTarget.value.title,
      createdAt: app.created_at || new Date().toISOString(),
      status: app.status || 'new',
    });

    ElMessage.success(`已投递「${applyTarget.value.title}」，可在「我的投递」查看进度`);
    applyVisible.value = false;
    router.push('/progress');
  } catch (e) {
    ElMessage.error(e.message || '投递失败');
  } finally {
    submitting.value = false;
  }
}

watch(() => route.params.id, (v, old) => {
  if (v && v !== old) load();
});

onMounted(() => {
  loadProfile();
  load();
});
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; }
.ph { background: #fff; border: 1px solid #e6e9ef; border-radius: 8px; padding: 12px 16px; }
.ph-title { font-size: 15px; font-weight: 600; color: #1f2d3d; }
.ph-tag { margin-left: 8px; }

.info-grid { display: flex; gap: 24px; flex-wrap: wrap; }
.info-main { flex: 1; min-width: 320px; }
.info-main h3 { margin: 0 0 8px; font-size: 16px; color: #1f2d3d; }
.intro { margin: 0 0 14px; font-size: 13px; color: #606266; line-height: 1.8; }
.block { margin-top: 12px; }
.block-title { font-size: 12.5px; font-weight: 600; color: #2e5496; margin-bottom: 4px; }
.block-body { font-size: 13px; color: #606266; line-height: 1.8; white-space: pre-wrap; }

.info-side {
  width: 220px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-left: 20px;
  border-left: 1px dashed #ebeef5;
}
.side-item .k { font-size: 11.5px; color: #a0a6b1; }
.side-item .v { font-size: 14px; font-weight: 600; color: #1f2d3d; }
.side-item .v.small { font-size: 12.5px; font-weight: 400; line-height: 1.7; color: #606266; }

.notice { line-height: 1.7; }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.pos-name { font-size: 13.5px; font-weight: 600; color: #1f2d3d; }
.pos-rec { font-size: 11.5px; color: #a0a6b1; margin-top: 2px; }
.req { font-size: 12.5px; color: #606266; line-height: 1.7; }
.quota { font-variant-numeric: tabular-nums; color: #606266; }

.apply-form :deep(.el-form-item) { margin-bottom: 12px; }
.group-title {
  font-size: 13px;
  font-weight: 600;
  color: #2e5496;
  margin: 6px 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid #ebeef5;
}
.group-sub { font-weight: 400; font-size: 11.5px; color: #a0a6b1; margin-left: 8px; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.hint { font-size: 11.5px; color: #909399; margin-top: 4px; line-height: 1.6; }
.drawer-foot { display: flex; justify-content: flex-end; gap: 8px; }
</style>
