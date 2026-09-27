<template>
  <el-dialog
    v-model="visible"
    title="登录社团账号"
    width="440px"
    :close-on-click-modal="false"
    @closed="onClosed"
  >
    <div class="login-body">
      <p class="login-tip">
        登录后即可修改<b>本社团</b>的招新信息录入标准、投递时间，并对候选人做录用 / 调剂 / 候补标注。
      </p>

      <el-radio-group v-model="mode" size="small" class="mode-switch">
        <el-radio-button value="club">按社团登录</el-radio-button>
        <el-radio-button value="user">按账号登录</el-radio-button>
      </el-radio-group>

      <el-form :model="form" label-width="72px" @submit.prevent="submit">
        <el-form-item v-if="mode === 'club'" label="我的社团">
          <el-select v-model="form.clubId" placeholder="选择你的社团" style="width: 100%" filterable>
            <el-option v-for="c in clubs" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-else label="账号">
          <el-input v-model="form.username" placeholder="账号名，或直接填社团名" clearable />
        </el-form-item>

        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            show-password
            @keyup.enter="submit"
          />
        </el-form-item>
      </el-form>

      <el-alert
        v-if="clubs.length && mode === 'club'"
        type="info"
        :closable="false"
        class="login-hint"
      >
        <template #default>
          初始账号由系统在首次启动时自动创建，账密写在
          <code>server/data/initial-accounts.txt</code>。登录后可在「我的社团 → 账号与权限」里修改。
        </template>
      </el-alert>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="loading" @click="submit">登录</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { clubApi } from '../api/index.js';
import { login as doLogin } from '../stores/auth.js';

const visible = defineModel({ type: Boolean, default: false });
const emit = defineEmits(['success']);

const mode = ref('club');
const clubs = ref([]);
const loading = ref(false);
const form = reactive({ clubId: '', username: '', password: '' });

watch(visible, async (v) => {
  if (!v) return;
  form.password = '';
  if (clubs.value.length === 0) {
    try {
      const data = await clubApi.list({ pageSize: 100 });
      clubs.value = data.list || [];
      if (clubs.value.length && !form.clubId) form.clubId = clubs.value[0].id;
    } catch {
      /* 错误提示已由拦截器给出 */
    }
  }
});

async function submit() {
  if (mode.value === 'club' && !form.clubId) return ElMessage.warning('请选择你的社团');
  if (mode.value === 'user' && !form.username) return ElMessage.warning('请输入账号名');
  if (!form.password) return ElMessage.warning('请输入密码');

  loading.value = true;
  try {
    const acc = await doLogin({
      clubId: mode.value === 'club' ? form.clubId : '',
      username: mode.value === 'user' ? form.username : '',
      password: form.password,
    });
    ElMessage.success(`已登录：${acc.clubName} · ${acc.roleLabel}`);
    visible.value = false;
    emit('success', acc);
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false;
  }
}

function onClosed() {
  form.password = '';
}
</script>

<style scoped>
.login-body {
  padding: 0 4px;
}
.login-tip {
  margin: 0 0 14px;
  color: #606266;
  font-size: 13px;
  line-height: 1.6;
}
.login-tip b {
  color: #409eff;
}
.mode-switch {
  margin-bottom: 16px;
}
.login-hint {
  margin-top: 4px;
}
.login-hint code {
  background: rgba(64, 158, 255, 0.1);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
}
</style>
