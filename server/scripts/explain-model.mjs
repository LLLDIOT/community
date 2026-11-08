/**
 * 讲解用：把嵌入模型的结构参数与实际行为打出来
 *
 * 用法：node scripts/explain-model.mjs
 *
 * 覆盖：配置文件参数、磁盘体积、分词结果、向量维度与范数、
 *       相似度基线、同义泛化、超长截断、编码耗时。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, pipeline, AutoTokenizer } from '@xenova/transformers';

import { MODEL_NAME, EMBEDDING_DIM } from '../src/ml/embeddingService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '../data/models');
const MODEL_DIR = path.join(CACHE_DIR, 'Xenova/bge-small-zh-v1.5');

const line = (c = '─') => console.log(c.repeat(76));
const h = (t) => { console.log(''); line('═'); console.log(t); line('═'); };

/* ── 1. 配置文件 ── */
h('① 模型标识与结构参数');
console.log(`  标识          ${MODEL_NAME}`);
console.log(`  说明          ONNX 格式；bge-small-zh-v1.5 为北京智源（BAAI）发布的 BGE 系列中文小模型`);

const cfgPath = path.join(MODEL_DIR, 'config.json');
if (fs.existsSync(cfgPath)) {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  console.log(`  架构          ${cfg.architectures?.join(', ')}`);
  console.log(`  hidden_size   ${cfg.hidden_size}          （输出向量维度）`);
  console.log(`  层数          ${cfg.num_hidden_layers}`);
  console.log(`  注意力头      ${cfg.num_attention_heads}`);
  console.log(`  词表大小      ${cfg.vocab_size}        （中文按字切的字符级词表）`);
  console.log(`  最长输入      ${cfg.max_position_embeddings} token`);
  console.log(`  中间层维度    ${cfg.intermediate_size}       （前馈网络宽度）`);
}

/* ── 2. 磁盘文件 ── */
h('② 磁盘上的文件');
let total = 0;
if (fs.existsSync(MODEL_DIR)) {
  for (const f of fs.readdirSync(MODEL_DIR, { recursive: true })) {
    const full = path.join(MODEL_DIR, f);
    if (!fs.statSync(full).isFile()) continue;
    const kb = fs.statSync(full).size / 1024;
    total += kb;
    if (kb > 1) console.log(`  ${f.padEnd(34)} ${kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb.toFixed(1) + ' KB'}`);
  }
  console.log(`  ${'合计'.padEnd(34)} ${(total / 1024).toFixed(2)} MB`);
}

/* ── 3. 加载 ── */
h('③ 加载与初始化');
env.remoteHost = process.env.HF_MIRROR || 'https://hf-mirror.com';
env.cacheDir = CACHE_DIR;
env.useBrowserCache = false;

const t0 = Date.now();
const extractor = await pipeline('feature-extraction', MODEL_NAME, { quantized: true });
console.log(`  加载耗时      ${((Date.now() - t0) / 1000).toFixed(2)} s（模型已在本地缓存）`);

/* ── 4. 分词 ── */
h('④ 分词：模型看到的是 token id，不是字符串');
const tokenizer = await AutoTokenizer.from_pretrained(MODEL_NAME);
const samples = [
  '精通 Vue 与 Node.js',
  '我是计算机协会的前端开发干事，负责页面开发',
];
for (const s of samples) {
  const enc = await tokenizer(s);
  const ids = Array.from(enc.input_ids.data);
  console.log('');
  console.log(`  原文：${s}`);
  console.log(`  长度：${ids.length} 个 token（含首尾特殊符）`);
  console.log(`  id  ：[${ids.slice(0, 12).join(', ')}${ids.length > 12 ? ', …' : ''}]`);
  const toks = ids.slice(1, -1).map((id) => tokenizer.decode([id]));
  console.log(`  切分：${toks.slice(0, 14).join(' | ')}${toks.length > 14 ? ' | …' : ''}`);
}

/* ── 5. 向量 ── */
h('⑤ 输出向量');
const [v] = await extractor(['精通 Vue 与 Node.js'], { pooling: 'cls', normalize: true });
const vec = v.tolist();
const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
console.log(`  维度          ${vec.length}（与 config 的 hidden_size 一致）`);
console.log(`  前 6 维       [${vec.slice(0, 6).map((x) => x.toFixed(4)).join(', ')}]`);
console.log(`  范数          ${norm.toFixed(6)}（已归一化，故余弦 = 点积）`);
console.log(`  数据类型      float32（每条向量 512 × 4 = 2048 字节）`);

/* ── 6. 相似度基线 ── */
h('⑥ 相似度基线：无关文本也不低');
async function embedOne(t) {
  const [o] = await extractor([t], { pooling: 'cls', normalize: true });
  return o.tolist();
}
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

const pairs = [
  ['精通 Vue 与 Node.js', '会打篮球，参加过校队', '无关'],
  ['喜欢摄影，擅长海报设计', '会打篮球，参加过校队', '无关'],
  ['精通 Vue 与 Node.js', '熟悉 Vue3 框架', '相关'],
  ['活动策划', '组织线下活动、协调场地', '同义表述'],
  ['文案', '文案写作', '同义表述'],
  ['海报设计', '视觉传达与排版', '同义表述'],
  ['前端开发', 'Vue3 页面实现与组件封装', '相关但措辞不同'],
];
console.log('  余弦      类别            A ~ B');
for (const [a, b, tag] of pairs) {
  const [va, vb] = await Promise.all([embedOne(a), embedOne(b)]);
  console.log(`  ${cos(va, vb).toFixed(4)}    ${tag.padEnd(14)} 「${a}」~「${b}」`);
}

/* ── 7. 截断 ── */
h('⑦ 超长输入会被截断（上限 512 token）');
const long = '这是一个用于测试超长输入的句子。'.repeat(120);
const shorts = long.slice(0, 200);
const longEnc = await tokenizer(long);
console.log(`  长文本 ${long.length} 字 → ${longEnc.input_ids.data.length} 个 token（未截断前）`);
const truncEnc = await tokenizer(long, { truncation: true, max_length: 512 });
console.log(`  截断到 512 → ${truncEnc.input_ids.data.length} 个 token`);
const vLong = await embedOne(long);
const vShort = await embedOne(shorts);
console.log(`  整篇向量与前 200 字向量的余弦：${cos(vLong, vShort).toFixed(4)}`);
console.log('  说明：尾部内容被丢弃，所以重要信息要放在文本前部。');

/* ── 8. 耗时 ── */
h('⑧ 编码耗时');
const texts = Array.from({ length: 20 }, (_, i) => `第 ${i} 条测试文本，包含一些中文内容用于测速`);
let t1 = Date.now();
for (const t of texts) await embedOne(t);
const single = (Date.now() - t1) / texts.length;
t1 = Date.now();
const batch = await extractor(texts, { pooling: 'cls', normalize: true });
const batchMs = Date.now() - t1;
console.log(`  逐条编码      ${single.toFixed(1)} ms/条`);
console.log(`  批量 20 条    ${batchMs} ms（${(batchMs / 20).toFixed(1)} ms/条，批量更快）`);

h('小结');
console.log('  这是一个 4 层、512 维的中文句向量模型，参数量约 2340 万，');
console.log('  int8 量化后 22.9 MB；它对每个 token 输出一个向量，取 [CLS] 位置作为整句表示。');
console.log('  它只能在 512 token 内工作，输出向量已归一化，余弦值域被压缩在 0.46~0.75 附近。');
line('═');
