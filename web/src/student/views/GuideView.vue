<template>
  <div class="page">
    <el-card shadow="never">
      <template #header><span>投递流程</span></template>
      <el-steps :active="4" align-center finish-status="success" class="steps">
        <el-step title="浏览社团" description="查看在招社团与岗位" />
        <el-step title="填写资料" description="保存学生资料，表单自动填充" />
        <el-step title="提交投递" description="确认简历内容后投递" />
        <el-step title="等待处理" description="在「我的投递」查看进度" />
      </el-steps>
    </el-card>

    <el-card shadow="never">
      <template #header><span>需要注意的几点</span></template>
      <div class="items">
        <div class="item">
          <div class="t">不需要注册账号</div>
          <div class="d">本站在公开网络可直接访问，投递不需要密码或注册。学生资料只保存在你自己的浏览器里。</div>
        </div>
        <div class="item">
          <div class="t">同一个岗位不要重复投递</div>
          <div class="d">同一份简历对同一个岗位只能投一次，重复提交会被服务端拒绝。</div>
        </div>
        <div class="item">
          <div class="t">技能标签会影响匹配</div>
          <div class="d">社团端的匹配度由「简历技能与岗位期望技能的重合度」加「简历正文与岗位要求的语义相似度」共同计算，技能写得越具体越容易被看到。</div>
        </div>
        <div class="item">
          <div class="t">记录只在本机</div>
          <div class="d">投递内容存在服务端，但「我的投递」列表是本机索引。清理浏览器缓存后列表会变空，可用投递编号在「我的投递」页重新查询。</div>
        </div>
        <div class="item">
          <div class="t">进度由社团更新</div>
          <div class="d">状态依次为：已送达 → 筛选中 → 面试中 → 已录取 / 未通过。社团操作后会同步更新。</div>
        </div>
      </div>
    </el-card>

    <el-card shadow="never">
      <template #header><span>隐私说明</span></template>
      <div class="privacy">
        <p>你在本站填写的信息只提交给你所投递的社团，用于招新筛选。学生端不提供任何查看他人资料的接口，也不提供附件下载目录。</p>
        <p>学生资料（姓名、学院、联系方式、技能等）保存在浏览器本地，仅用于自动填充表单，不会随页面加载上传到服务器。</p>
        <p>由于本站不需要注册，目前无法完全防止冒名投递。如果你的信息被他人冒用，请直接联系对应社团说明。</p>
      </div>
    </el-card>

    <div class="foot">
      <el-button type="primary" @click="$router.push('/clubs')">开始浏览社团</el-button>
    </div>
  </div>
</template>

<script setup>
// 纯说明页，无数据请求
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; }
.steps { padding: 8px 0 4px; }
.items { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
.item { border: 1px solid #e6e9ef; border-radius: 8px; padding: 14px 16px; background: #fafbfd; }
.item .t { font-size: 13.5px; font-weight: 600; color: #1f2d3d; margin-bottom: 6px; }
.item .d { font-size: 12.5px; color: #606266; line-height: 1.8; }
.privacy p { margin: 0 0 10px; font-size: 13px; color: #606266; line-height: 1.9; }
.privacy p:last-child { margin-bottom: 0; }
.foot { display: flex; justify-content: center; padding: 6px 0 10px; }
</style>
