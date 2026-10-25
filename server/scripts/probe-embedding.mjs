/**
 * 冒烟测试：本地 ONNX 中文嵌入模型能否工作
 * 用法：node scripts/probe-embedding.mjs
 */
import { env, pipeline } from '@xenova/transformers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 国内直连不了 huggingface.co，但 hf-mirror.com 可以
env.remoteHost = 'https://hf-mirror.com';
env.allowRemoteModels = true;
env.useBrowserCache = false;
env.cacheDir = path.resolve(__dirname, '../data/models');

console.log('[1] 加载模型 Xenova/bge-small-zh-v1.5（首次会下载，约 20-30MB）…');
const t0 = Date.now();
const extractor = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5', {
  quantized: true,
});
console.log(`    加载完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const embed = async (texts) => {
  const out = await extractor(texts, { pooling: 'cls', normalize: true });
  return out.tolist();
};

const cosine = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

console.log('\n[2] 编码测试句子…');
const sentences = [
  '精通 Vue 与 Node.js，做过前端项目',
  '熟悉 Vue3 框架，有 Web 开发经验',
  '喜欢摄影，擅长海报设计与排版',
  '会打篮球，参加过校队',
];
const vectors = await embed(sentences);
console.log(`    向量维度: ${vectors[0].length}`);

console.log('\n[3] 语义相似度矩阵（应看到"相近的高、无关的低"）：');
for (let i = 0; i < sentences.length; i += 1) {
  for (let j = i + 1; j < sentences.length; j += 1) {
    const s = cosine(vectors[i], vectors[j]);
    console.log(`    ${s.toFixed(4)}   「${sentences[i].slice(0, 14)}…」 vs 「${sentences[j].slice(0, 14)}…」`);
  }
}

console.log('\n[4] 语义泛化验证（不同词、同一含义）：');
const pairs = [
  ['前端开发', 'Vue 框架与页面实现'],
  ['海报设计', '视觉传达与排版'],
  ['活动策划', '组织线下活动、协调场地'],
];
for (const [a, b] of pairs) {
  const [va, vb] = await embed([a, b]);
  console.log(`    ${cosine(va, vb).toFixed(4)}   ${a}  ~  ${b}`);
}

console.log('\n[5] 性能：单条编码耗时');
const t1 = Date.now();
for (let i = 0; i < 10; i += 1) await embed([sentences[0]]);
console.log(`    10 次单条编码耗时 ${Date.now() - t1}ms（平均 ${((Date.now() - t1) / 10).toFixed(0)}ms/条）`);

console.log('\n✅ 嵌入模型可用');
