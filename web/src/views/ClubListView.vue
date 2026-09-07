<template>
  <div class="club-list">
    <!-- 顶部操作条 -->
    <el-card shadow="never" class="toolbar">
      <div class="toolbar-inner">
        <el-input
          v-model="query.keyword"
          placeholder="搜索社团名称 / 说明"
          clearable
          style="width: 260px"
          @keyup.enter="load"
          @clear="load"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="query.category" placeholder="社团类型" clearable style="width: 160px" @change="load">
          <el-option v-for="c in categoryOptions" :key="c.value" :label="c.label" :value="c.value" />
        </el-select>
        <el-button type="primary" @click="load">
          <el-icon><Refresh /></el-icon>&nbsp;查询
        </el-button>
        <el-button type="success" @click="openCreate">
          <el-icon><Plus /></el-icon>&nbsp;新建社团
        </el-button>
      </div>
    </el-card>

    <!-- 社团卡片列表 -->
    <el-row :gutter="16" v-loading="loading">
      <el-col v-for="club in list" :key="club.id" :xs="24" :sm="12" :md="8" :lg="6">
        <el-card shadow="hover" class="club-card" @click="goDetail(club.id)">
          <div class="club-head">
            <el-avatar :size="44" class="club-logo">
              {{ club.name.slice(0, 1) }}
            </el-avatar>
            <div class="club-title">
              <div class="club-name">{{ club.name }}</div>
              <div class="club-meta">
                <el-tag size="small" type="info">{{ categoryLabel(club.category) }}</el-tag>
                <span class="scale">👥 {{ club.scale }} 人</span>
              </div>
            </div>
          </div>
          <p class="club-desc">{{ club.description || '暂无社团说明' }}</p>
          <div class="club-foot">
            <span v-if="club.contact_name">📞 {{ club.contact_name }}</span>
            <span v-else class="muted">未填联系人</span>
            <el-button type="primary" link size="small" @click.stop="goDetail(club.id)">进入管理 →</el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-empty v-if="!loading && list.length === 0" description="暂无社团，点击右上角「新建社团」开始" />

    <!-- 分页 -->
    <el-pagination
      v-if="total > pageSize"
      class="pager"
      layout="total, prev, pager, next"
      :total="total"
      :page-size="pageSize"
      :current-page="query.page"
      @current-change="onPageChange"
    />

    <!-- 新建/编辑弹窗 -->
    <el-dialog v-model="dialog.visible" :title="dialog.isEdit ? '编辑社团' : '新建社团'" width="560px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="社团名称" prop="name">
          <el-input v-model="form.name" placeholder="如：计算机协会" />
        </el-form-item>
        <el-form-item label="社团类型" prop="category">
          <el-select v-model="form.category" placeholder="选择类型" style="width: 100%">
            <el-option v-for="c in categoryOptions" :key="c.value" :label="c.label" :value="c.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="规模人数" prop="scale">
          <el-input-number v-model="form.scale" :min="0" :max="99999" style="width: 160px" />
          <span style="margin-left: 12px; color: #909399; font-size: 12px">当前成员数</span>
        </el-form-item>
        <el-form-item label="社团说明" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="4" placeholder="介绍社团定位、日常活动、招新亮点…（支持纯文本）" />
        </el-form-item>
        <el-form-item label="联系人">
          <div class="contact-row">
            <el-input v-model="form.contactName" placeholder="姓名" style="width: 32%" />
            <el-input v-model="form.contactPhone" placeholder="电话" style="width: 32%" />
            <el-input v-model="form.contactEmail" placeholder="邮箱" style="width: 32%" />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="dialog.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { clubApi } from '../api/index.js';

const router = useRouter();

const categoryOptions = [
  { value: 'technical', label: '技术类' },
  { value: 'organizing', label: '组织策划类' },
  { value: 'artistic', label: '文艺类' },
  { value: 'sports', label: '体育类' },
  { value: 'academic', label: '学术类' },
  { value: 'service', label: '公益服务类' },
  { value: 'other', label: '其他' },
];
const categoryLabel = (v) => categoryOptions.find((c) => c.value === v)?.label || v || '未分类';

const loading = ref(false);
const list = ref([]);
const total = ref(0);
const pageSize = 12;
const query = reactive({ keyword: '', category: '', page: 1 });

const dialog = reactive({ visible: false, isEdit: false, saving: false, id: null });
const formRef = ref();
const emptyForm = () => ({ name: '', category: 'technical', scale: 0, description: '', contactName: '', contactPhone: '', contactEmail: '' });
const form = reactive(emptyForm());
const rules = {
  name: [{ required: true, message: '请输入社团名称', trigger: 'blur' }],
};

async function load() {
  loading.value = true;
  try {
    const data = await clubApi.list({ ...query, pageSize });
    list.value = data.list;
    total.value = data.total;
  } finally {
    loading.value = false;
  }
}

function onPageChange(p) {
  query.page = p;
  load();
}

function openCreate() {
  Object.assign(form, emptyForm());
  dialog.isEdit = false;
  dialog.id = null;
  dialog.visible = true;
}

function goDetail(id) {
  router.push(`/clubs/${id}`);
}

async function save() {
  await formRef.value.validate();
  dialog.saving = true;
  try {
    const payload = { ...form, scale: Number(form.scale) || 0 };
    if (dialog.isEdit) {
      await clubApi.update(dialog.id, payload);
      ElMessage.success('社团已更新');
    } else {
      await clubApi.create(payload);
      ElMessage.success('社团已创建');
    }
    dialog.visible = false;
    load();
  } finally {
    dialog.saving = false;
  }
}

onMounted(load);
</script>

<style scoped>
.toolbar-inner {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.club-card {
  margin-bottom: 16px;
  cursor: pointer;
}
.club-head {
  display: flex;
  gap: 12px;
  align-items: center;
}
.club-logo {
  background: #409eff;
  color: #fff;
  font-weight: 600;
  flex-shrink: 0;
}
.club-title {
  min-width: 0;
}
.club-name {
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.club-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 12px;
  color: #606266;
}
.club-desc {
  color: #606266;
  font-size: 13px;
  line-height: 1.7;
  height: 54px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  margin: 12px 0;
}
.club-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: #303133;
}
.muted {
  color: #c0c4cc;
}
.contact-row {
  display: flex;
  gap: 8px;
  width: 100%;
}
.pager {
  margin-top: 8px;
  justify-content: flex-end;
}
</style>
