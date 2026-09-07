<template>
  <div v-loading="loading" class="club-detail">
    <el-page-header @back="router.back()">
      <template #content>
        <span class="page-title">{{ club.name || '社团详情' }}</span>
      </template>
      <template #extra>
        <el-button type="primary" plain @click="editVisible = true">编辑社团资料</el-button>
      </template>
    </el-page-header>

    <!-- 社团概要 -->
    <el-card shadow="never" class="mt-16">
      <div class="summary">
        <div>
          <h2 class="name">{{ club.name }}</h2>
          <div class="tags">
            <el-tag type="info">{{ categoryLabel(club.category) }}</el-tag>
            <el-tag type="warning">👥 规模 {{ club.scale }} 人</el-tag>
          </div>
          <p class="desc">{{ club.description || '暂无说明' }}</p>
          <div class="contact" v-if="club.contact_name || club.contact_phone || club.contact_email">
            📞 {{ club.contact_name || '-' }}
            {{ club.contact_phone || '' }}
            {{ club.contact_email || '' }}
          </div>
        </div>
      </div>
    </el-card>

    <!-- 招新批次区 -->
    <el-card shadow="never" class="mt-16">
      <template #header>
        <div class="card-head">
          <span class="card-title">招新批次</span>
          <el-button type="primary" size="small" @click="openRecDialog()">
            <el-icon><Plus /></el-icon>&nbsp;新建招新批次
          </el-button>
        </div>
      </template>

      <el-empty v-if="club.recruitments?.length === 0" description="还没有招新批次，点击右上角创建" />
      <div v-else class="rec-list">
        <el-card
          v-for="rec in club.recruitments"
          :key="rec.id"
          shadow="hover"
          class="rec-card"
        >
          <div class="rec-head">
            <span class="rec-title">{{ rec.title }}</span>
            <el-tag :type="recStatusType(rec.status)" size="small">{{ recStatusLabel(rec.status) }}</el-tag>
            <span v-if="rec.start_at || rec.end_at" class="rec-time">
              {{ rec.start_at || '?' }} ~ {{ rec.end_at || '?' }}
            </span>
          </div>
          <el-button
            v-if="rec.status === 'draft'"
            size="small"
            type="success"
            plain
            @click="changeRecStatus(rec, 'open')"
          >开始招新</el-button>
          <el-button
            v-if="rec.status === 'open'"
            size="small"
            type="info"
            plain
            @click="changeRecStatus(rec, 'closed')"
          >结束招新</el-button>
          <el-button size="small" plain @click="openRecDialog(rec)">编辑</el-button>
          <el-button size="small" type="danger" plain @click="removeRec(rec)">删除</el-button>

          <!-- 岗位列表 -->
          <el-table :data="rec.positions" size="small" class="pos-table">
            <el-table-column label="招新岗位（需求）" min-width="160">
              <template #default="{ row }">
                <span class="pos-title">{{ row.title }}</span>
                <div class="pos-req" v-if="row.requirement">{{ row.requirement }}</div>
              </template>
            </el-table-column>
            <el-table-column label="需求人数" width="120" align="center">
              <template #default="{ row }">
                <el-tag :type="row.filled_count >= row.headcount ? 'success' : 'info'" size="small">
                  {{ row.filled_count }}/{{ row.headcount }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="220" align="right">
              <template #default="{ row }">
                <el-button size="small" link type="primary" @click="viewPositionApps(rec, row)">简历</el-button>
                <el-button size="small" link @click="openPosDialog(rec, row)">编辑</el-button>
                <el-button size="small" link type="danger" @click="removePos(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-button
            size="small"
            type="primary"
            plain
            class="add-pos"
            @click="openPosDialog(rec)"
          >
            <el-icon><Plus /></el-icon>&nbsp;添加岗位需求
          </el-button>
        </el-card>
      </div>
    </el-card>

    <!-- 编辑社团资料 -->
    <el-dialog v-model="editVisible" title="编辑社团资料" width="560px" destroy-on-close>
      <el-form ref="clubFormRef" :model="clubForm" :rules="clubRules" label-width="96px">
        <el-form-item label="社团名称" prop="name"><el-input v-model="clubForm.name" /></el-form-item>
        <el-form-item label="社团类型"><el-select v-model="clubForm.category" style="width: 100%"><el-option v-for="c in categoryOptions" :key="c.value" :label="c.label" :value="c.value" /></el-select></el-form-item>
        <el-form-item label="规模人数"><el-input-number v-model="clubForm.scale" :min="0" /></el-form-item>
        <el-form-item label="社团说明"><el-input v-model="clubForm.description" type="textarea" :rows="4" /></el-form-item>
        <el-form-item label="联系人姓名"><el-input v-model="clubForm.contactName" /></el-form-item>
        <el-form-item label="联系人电话"><el-input v-model="clubForm.contactPhone" /></el-form-item>
        <el-form-item label="联系人邮箱"><el-input v-model="clubForm.contactEmail" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" @click="saveClub">保存</el-button>
      </template>
    </el-dialog>

    <!-- 批次弹窗 -->
    <el-dialog v-model="recDialog.visible" :title="recDialog.isEdit ? '编辑招新批次' : '新建招新批次'" width="480px">
      <el-form label-width="90px">
        <el-form-item label="批次名称"><el-input v-model="recForm.title" placeholder="如：2026 秋季招新" /></el-form-item>
        <el-form-item label="开始时间"><el-date-picker v-model="recForm.startAt" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="结束时间"><el-date-picker v-model="recForm.endAt" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="recForm.remark" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="recDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveRec">保存</el-button>
      </template>
    </el-dialog>

    <!-- 岗位弹窗 -->
    <el-dialog v-model="posDialog.visible" :title="posDialog.isEdit ? '编辑岗位需求' : '添加岗位需求'" width="500px">
      <el-form label-width="90px">
        <el-form-item label="岗位名称"><el-input v-model="posForm.title" placeholder="如：前端开发干事" /></el-form-item>
        <el-form-item label="需求说明"><el-input v-model="posForm.requirement" type="textarea" :rows="3" placeholder="需要具备哪些能力 / 承担什么工作…" /></el-form-item>
        <el-form-item label="招新人数"><el-input-number v-model="posForm.headcount" :min="1" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="posDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="savePos">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { clubApi, recruitmentApi, positionApi } from '../api/index.js';

const route = useRoute();
const router = useRouter();
const clubId = route.params.id;

const categoryOptions = [
  { value: 'technical', label: '技术类' }, { value: 'organizing', label: '组织策划类' },
  { value: 'artistic', label: '文艺类' }, { value: 'sports', label: '体育类' },
  { value: 'academic', label: '学术类' }, { value: 'service', label: '公益服务类' },
  { value: 'other', label: '其他' },
];
const categoryLabel = (v) => categoryOptions.find((c) => c.value === v)?.label || v || '未分类';

const REC_STATUS = {
  draft: { label: '草稿', type: 'info' },
  open: { label: '招新中', type: 'success' },
  closed: { label: '已结束', type: 'warning' },
};
const recStatusLabel = (s) => REC_STATUS[s]?.label || s;
const recStatusType = (s) => REC_STATUS[s]?.type || 'info';

const loading = ref(false);
const club = ref({ recruitments: [] });

async function load() {
  loading.value = true;
  try {
    club.value = await clubApi.detail(clubId);
  } finally {
    loading.value = false;
  }
}

/* ---- 编辑社团 ---- */
const editVisible = ref(false);
const clubFormRef = ref();
const clubForm = reactive({});
const clubRules = { name: [{ required: true, message: '请输入社团名称', trigger: 'blur' }] };

function openEditDialog() {
  const c = club.value;
  Object.assign(clubForm, {
    name: c.name, category: c.category, scale: c.scale,
    description: c.description, contactName: c.contact_name,
    contactPhone: c.contact_phone, contactEmail: c.contact_email,
  });
  editVisible.value = true;
}

async function saveClub() {
  await clubFormRef.value.validate();
  await clubApi.update(clubId, { ...clubForm, scale: Number(clubForm.scale) || 0 });
  ElMessage.success('保存成功');
  editVisible.value = false;
  load();
}

/* ---- 批次 ---- */
const recDialog = reactive({ visible: false, isEdit: false, id: null });
const recForm = reactive({ title: '', startAt: '', endAt: '', remark: '' });

function openRecDialog(rec) {
  if (rec) {
    Object.assign(recForm, { title: rec.title, startAt: rec.start_at, endAt: rec.end_at, remark: rec.remark });
    recDialog.isEdit = true;
    recDialog.id = rec.id;
  } else {
    Object.assign(recForm, { title: '', startAt: '', endAt: '', remark: '' });
    recDialog.isEdit = false;
    recDialog.id = null;
  }
  recDialog.visible = true;
}

async function saveRec() {
  if (!recForm.title) return ElMessage.warning('请输入批次名称');
  if (recDialog.isEdit) {
    await recruitmentApi.update(recDialog.id, { ...recForm });
  } else {
    await recruitmentApi.create(clubId, { ...recForm });
  }
  ElMessage.success('保存成功');
  recDialog.visible = false;
  load();
}

async function changeRecStatus(rec, status) {
  await recruitmentApi.setStatus(rec.id, status);
  ElMessage.success(status === 'open' ? '招新已开始' : '招新已结束');
  load();
}

async function removeRec(rec) {
  await ElMessageBox.confirm(`删除批次「${rec.title}」？其下如有岗位将无法删除。`, '确认删除', { type: 'warning' });
  await recruitmentApi.remove(rec.id);
  ElMessage.success('已删除');
  load();
}

/* ---- 岗位 ---- */
const posDialog = reactive({ visible: false, isEdit: false, id: null, recId: null });
const posForm = reactive({ title: '', requirement: '', headcount: 1 });

function openPosDialog(rec, pos) {
  if (pos) {
    Object.assign(posForm, { title: pos.title, requirement: pos.requirement, headcount: pos.headcount });
    posDialog.isEdit = true;
    posDialog.id = pos.id;
  } else {
    Object.assign(posForm, { title: '', requirement: '', headcount: 1 });
    posDialog.isEdit = false;
    posDialog.id = null;
  }
  posDialog.recId = rec.id;
  posDialog.visible = true;
}

async function savePos() {
  if (!posForm.title) return ElMessage.warning('请输入岗位名称');
  if (posDialog.isEdit) {
    await positionApi.update(posDialog.id, { ...posForm });
  } else {
    await positionApi.create(posDialog.recId, { ...posForm });
  }
  ElMessage.success('保存成功');
  posDialog.visible = false;
  load();
}

async function removePos(pos) {
  await ElMessageBox.confirm(`删除岗位「${pos.title}」？`, '确认删除', { type: 'warning' });
  await positionApi.remove(pos.id);
  ElMessage.success('已删除');
  load();
}

/* ---- 查看岗位简历：跳到简历库并按岗位过滤 ---- */
function viewPositionApps(rec, pos) {
  router.push({
    path: '/applications',
    query: { clubId, recruitmentId: rec.id, positionId: pos.id },
  });
}

onMounted(load);
</script>

<style scoped>
.mt-16 { margin-top: 16px; }
.page-title { font-weight: 600; }
.summary .name { margin: 4px 0 8px; }
.tags { display: flex; gap: 8px; }
.desc { color: #606266; line-height: 1.8; margin: 12px 0 4px; white-space: pre-wrap; }
.contact { color: #909399; font-size: 13px; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.card-title { font-weight: 600; }
.rec-card { margin-bottom: 12px; }
.rec-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.rec-title { font-size: 15px; font-weight: 600; }
.rec-time { color: #909399; font-size: 12px; margin-left: auto; }
.pos-title { font-weight: 500; }
.pos-req { color: #909399; font-size: 12px; margin-top: 2px; white-space: pre-wrap; }
.pos-table { margin: 8px 0 10px; }
.add-pos { margin-top: 4px; }
</style>
