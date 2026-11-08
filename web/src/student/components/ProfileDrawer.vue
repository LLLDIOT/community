<template>
  <el-drawer v-model="visible" title="学生资料" size="460px" :close-on-click-modal="false">
    <el-alert type="info" :closable="false" show-icon class="tip">
      这些信息只保存在你自己的浏览器里，用于投递时自动填充表单。换浏览器时需要重新填写。
    </el-alert>

    <el-form :model="form" label-width="88px" label-position="right" class="form">
      <el-form-item label="姓名" required>
        <el-input v-model="form.name" placeholder="真实姓名" maxlength="20" show-word-limit />
      </el-form-item>
      <el-form-item label="学院/学校">
        <el-input v-model="form.college" placeholder="例如：计算机学院 / 示例大学" />
      </el-form-item>
      <el-form-item label="专业">
        <el-input v-model="form.major" placeholder="例如：软件工程" />
      </el-form-item>
      <el-form-item label="年级">
        <el-select v-model="form.grade" placeholder="请选择" clearable style="width: 100%">
          <el-option v-for="g in GRADES" :key="g" :label="g" :value="g" />
        </el-select>
      </el-form-item>
      <el-form-item label="手机号">
        <el-input v-model="form.phone" placeholder="选填，方便社团联系" maxlength="20" />
      </el-form-item>
      <el-form-item label="邮箱">
        <el-input v-model="form.email" placeholder="选填" maxlength="60" />
      </el-form-item>
      <el-form-item label="技能标签">
        <el-input
          v-model="form.skills"
          placeholder="用逗号分隔，例如：Vue,Node.js,活动策划"
        />
        <div class="hint">技能标签会参与社团端的匹配计算，填得越具体越容易被看到。</div>
      </el-form-item>
      <el-form-item label="特长">
        <el-input v-model="form.talents" placeholder="例如：话剧表演、摄影、篮球" />
      </el-form-item>
      <el-form-item label="经历">
        <el-input v-model="expText" type="textarea" :rows="3" placeholder="每行一条，自动用于模板填充" />
      </el-form-item>
      <el-form-item label="获奖">
        <el-input v-model="awardText" type="textarea" :rows="2" placeholder="每行一条" />
      </el-form-item>
      <el-form-item label="自我介绍">
        <el-input v-model="form.intro" type="textarea" :rows="3" placeholder="为什么想加入社团" />
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="footer">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存到本机</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script setup>
import { computed, reactive, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { profile, loadProfile, saveProfile } from '../store.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const GRADES = ['大一', '大二', '大三', '大四', '研一', '研二', '研三'];

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const form = reactive({
  name: '', college: '', major: '', grade: '',
  phone: '', email: '', skills: '', talents: '', intro: '',
});

const expText = reactive({ value: '' });
const awardText = reactive({ value: '' });

/* 打开时从本地档案回填 */
watch(visible, (open) => {
  if (!open) return;
  loadProfile();
  Object.assign(form, {
    name: profile.name || '',
    college: profile.college || '',
    major: profile.major || '',
    grade: profile.grade || '',
    phone: profile.phone || '',
    email: profile.email || '',
    skills: profile.skills || '',
    talents: profile.talents || '',
    intro: profile.intro || '',
  });
  expText.value = (profile.experiences || []).filter(Boolean).join('\n');
  awardText.value = (profile.awards || []).filter(Boolean).join('\n');
});

function submit() {
  if (!form.name.trim()) {
    ElMessage.warning('请填写姓名');
    return;
  }
  saveProfile({
    ...form,
    experiences: expText.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3),
    awards: awardText.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3),
  });
  ElMessage.success('已保存到本机');
  visible.value = false;
}
</script>

<style scoped>
.tip {
  margin-bottom: 14px;
  line-height: 1.7;
}
.form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.hint {
  font-size: 11.5px;
  color: #909399;
  line-height: 1.6;
  margin-top: 4px;
}
.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
