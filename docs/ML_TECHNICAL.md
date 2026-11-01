# 机器学习层技术说明

| 项目 | 内容 |
|---|---|
| 文档对象 | 社团招新系统机器学习层（`server/src/ml/`、`server/src/routes/mlRoutes.js`） |
| 文档性质 | 技术说明，描述实现机制、参数取值依据、实测数据与能力边界 |
| 版本基线 | 迁移 `005-ml-embeddings.sql`、提交 `8b1e84e` |
| 相关文档 | `ML_PERSPECTIVE.md`（方案论证）、`ML_INTERNALS.md`（含类比的通俗讲解）、`RUNTIME.md`（系统整体运行） |

---

## 目录

1. [范围与术语](#s1)
2. [系统组成与设计约束](#s2)
3. [嵌入模型](#s3)
4. [文本表示构造](#s4)
5. [向量缓存](#s5)
6. [相似度计算与分数标定](#s6)
7. [综合评分](#s7)
8. [技能标签自动抽取](#s8)
9. [候选人聚类](#s9)
10. [运行控制与容错](#s10)
11. [能力边界](#s11)
12. [接口与执行流程](#s12)
13. [参数汇总](#s13)
14. [验证方法](#s14)

---

<a id="s1"></a>
## 1. 范围与术语

### 1.1 文档范围

本文档描述系统内三个机器学习组件：

1. 简历与岗位的语义相似度计算（含综合评分）
2. 简历文本的技能标签自动抽取
3. 候选人的无监督聚类

不包含：认证、权限、状态机、数据持久化、部署与网络配置，相关内容见 `RUNTIME.md`。

### 1.2 术语定义

| 术语 | 定义 |
|---|---|
| **嵌入（embedding）** | 将变长文本映射为固定维度实数向量的过程；本文实现中维度为 512 |
| **向量（vector）** | 嵌入的输出，512 个实数构成的有序数组 |
| **余弦相似度** | 两个向量夹角余弦值，取值 [-1, 1]，计算式为 $(\mathbf{a}\cdot\mathbf{b})/(\|\mathbf{a}\|\|\mathbf{b}\|)$ |
| **归一化（normalization）** | 将向量缩放至欧几里得范数为 1 的运算 |
| **池化（pooling）** | 将多个 token 位置的向量合并为单个句向量的运算 |
| **标定（calibration）** | 将原始相似度按线性映射转换为 0~100 区间的整数的过程 |
| **标注样本** | 带有确定结论标签的历史记录，用于监督学习训练 |
| **推理（inference）** | 使用已确定的模型参数计算输出，不修改参数 |
| **降级（degradation）** | 模型不可用时切换至规则算法的运行状态 |
| **轮廓系数（silhouette）** | 衡量聚类结果质量的指标，取值 [-1, 1] |

### 1.3 数值约定

- 相似度与评分均以小数或 0~100 整数表示，具体在章节内注明。
- 所有实测数据来自 `server/scripts/` 下的验证脚本输出，可复现。
- 时间单位为毫秒，体积单位为兆字节（MB，1 MB = 1024 × 1024 字节）。

---

<a id="s2"></a>
## 2. 系统组成与设计约束

### 2.1 组件构成

| 组件 | 文件 | 职责 |
|---|---|---|
| 嵌入服务 | `server/src/ml/embeddingService.js` | 模型加载、文本编码、向量缓存、相似度计算 |
| 语义匹配服务 | `server/src/ml/semanticMatchService.js` | 文本构造、分数标定、综合评分、排序 |
| 技能抽取 | `server/src/ml/skillExtractor.js` | 受控词表、精确匹配、语义匹配、结果合并 |
| 聚类 | `server/src/ml/clustering.js` | K-means、初始中心选择、轮廓系数、簇特征描述 |
| 规则工具 | `server/src/ml/skillTags.js` | 字符串分割、集合求交（降级路径） |
| 分发层 | `server/src/services/matchService.js` | 在语义实现与规则实现之间选择 |
| 路由层 | `server/src/routes/mlRoutes.js` | HTTP 接口定义与权限中间件挂载 |

### 2.2 设计约束

约束一：**标注样本数量为零。**

数据库 `application` 表的 `decision` 字段用于记录面试结论（录用/候补/调剂/淘汰），当前有效标注数量为 0。因此：

- 不实施任何需要训练的分类或排序模型；
- 不实施模型微调；
- 仅使用预训练模型执行推理。

约束二：**运行环境无外网直连能力。**

实测 `huggingface.co` 与 `cdn-lfs.huggingface.co` 直连不可达，`hf-mirror.com` 可达。模型获取地址因此可配置，默认使用镜像。

约束三：**部署环境为普通 CPU，无 GPU。**

模型规模与量化方式需适配 CPU 单线程推理。

约束四：**系统为单进程部署，数据库为 SQLite。**

模型不得在启动阶段阻塞端口监听，否则会延迟健康检查通过时间。

### 2.3 实施原则

1. 模型不可用时自动切换至规则算法，主业务功能不受影响。
2. 所有需要在你的数据上训练的能力不实施，避免以合成数据或不当标签构造训练集。
3. 机器计算结果作为建议输出，不自动执行录入、录用、删除等写操作。
4. 计算结果中保留可供人工核对的中间量（命中技能、缺失技能、原始余弦值、各子分）。

---

<a id="s3"></a>
## 3. 嵌入模型

### 3.1 模型标识与结构参数

模型标识：`Xenova/bge-small-zh-v1.5`。

该标识由两部分构成：`Xenova` 为 ONNX 格式转换方，`bge-small-zh-v1.5` 为原始模型名（北京智源人工智能研究院发布的 BGE 系列中文小模型）。

从模型配置文件 `config.json` 读取的结构参数：

| 参数名 | 取值 | 说明 |
|---|---|---|
| `hidden_size` | 512 | 输出向量维度 |
| `num_hidden_layers` | 4 | Transformer 编码层数 |
| `num_attention_heads` | 8 | 每层注意力头数 |
| `vocab_size` | 21128 | 词表条目数 |
| `max_position_embeddings` | 512 | 最大输入 token 数 |

参数量估算：

```
词嵌入矩阵        21128 × 512                 ≈ 10.82 M
每层 Transformer  4 × 512² + 2 × 512 × 2048   ≈  3.15 M
4 层合计                                       ≈ 12.60 M
──────────────────────────────────────────────────────
总计                                           ≈ 23.4 M
```

### 3.2 文本预处理：分词

模型输入为整数 token 序列，不直接接受字符串。分词由 `tokenizer.json` 定义的词表完成。

词表规模 21128 对应中文 BERT 系列的字符级词表：中文按字切分，英文与数字按子词（WordPiece）切分。字符级词表的原因是中文词语组合数量近似无限，字符级覆盖更稳定。

输入长度上限为 512 个 token。超长部分被截断，截断后的内容不参与计算。该限制由位置编码的最大长度决定。

### 3.3 前向计算与池化

模型对每个 token 位置输出一个 512 维向量。将序列级向量合并为单个向量的运算称为池化。可用的池化方式包括：

| 方式 | 运算 | 适用条件 |
|---|---|---|
| CLS 池化 | 取首个特殊 token（`[CLS]`）位置的输出 | 模型训练时使用 CLS 表示作为句向量 |
| 均值池化 | 对所有 token 位置向量逐维求平均 | 通用，长文本时有效信息会被无关 token 稀释 |

本实现采用 CLS 池化：

```js
const out = await extractor(batch, { pooling: 'cls', normalize: true });
```

选择依据：BGE 系列模型在训练阶段以 `[CLS]` 位置输出作为句向量参与对比学习目标，使用其他池化方式将偏离训练时的特征提取位置。

### 3.4 归一化

`normalize: true` 使输出向量欧几里得范数为 1。归一化后余弦相似度计算简化为点积：

$$
\cos(\mathbf{a},\mathbf{b}) = \frac{\mathbf{a}\cdot\mathbf{b}}{\|\mathbf{a}\|\,\|\mathbf{b}\|} = \frac{\mathbf{a}\cdot\mathbf{b}}{1 \times 1} = \mathbf{a}\cdot\mathbf{b}
$$

该变换省去两次平方根运算与一次除法。在"1 份简历与 N 个岗位"的批处理中，该项优化具有实际意义。

### 3.5 量化

模型权重以 8 位整数存储（量化），量化文件为 `onnx/model_quantized.onnx`，体积 22.9 MB。未量化（32 位浮点）版本约 90 MB。

量化的运算过程为：将浮点权重乘以缩放因子后取整存储，计算时再按缩放因子还原。量化引入数值精度损失，同时减少约 75% 的存储占用并降低推理时的内存带宽需求。

对本任务（文本相似度）而言，精度损失的影响小于检索速度与部署体积的收益。

### 3.6 获取与本地缓存

模型文件获取与缓存由以下配置控制：

```js
env.remoteHost = process.env.HF_MIRROR || 'https://hf-mirror.com';
env.cacheDir   = process.env.MODEL_CACHE_DIR || server/data/models;
env.allowRemoteModels = true;
env.useBrowserCache = false;
```

首次调用时下载并写入 `server/data/models/Xenova/bge-small-zh-v1.5/`。后续启动直接读取本地文件。

实测文件构成：

| 文件 | 体积 |
|---|---|
| `onnx/model_quantized.onnx` | 22.9 MB |
| `tokenizer.json` | 0.42 MB |
| 其他配置与词表文件 | < 0.1 MB |
| 合计 | 23.3 MB |

### 3.7 推理性能实测

单条短文本（10~20 个 token）编码耗时：

```
连续 10 次编码总耗时 15 ms，平均 2 ms/条
```

该数值在 4 层模型、CPU 单线程、int8 量化的条件下取得。含义：当向量已缓存时，1 份简历与 100 个岗位的相似度计算（100 次 512 维点积）耗时在 1 ms 量级，机器学习组件不构成接口性能瓶颈。

首次加载（含模型文件下载）实测耗时 56.7 s；模型已在本地时加载耗时 0.1~0.2 s。

---

<a id="s4"></a>
## 4. 文本表示构造

### 4.1 构造原则

模型输出质量对输入文本构造方式敏感。同一模型在不同文本构造下的结果差异可以超过更换模型的差异。构造需满足以下条件：

1. 输入中应包含判断所需的信息项，不要仅提供标签字段。
2. 各信息项前加中文标识词，使模型能够区分字段语义。
3. 信息项之间以换行符分隔，使位置编码能够识别边界。
4. 重要信息置于输入前部，因为超长输入由尾部开始截断。

### 4.2 简历侧构造规则

```js
export function buildResumeText(resume) {
  const parts = [];
  if (resume.student_name) parts.push(`姓名：${resume.student_name}`);
  if (resume.school)       parts.push(`学校：${resume.school}`);
  if (resume.major)        parts.push(`专业：${resume.major}`);
  if (resume.grade)        parts.push(`年级：${resume.grade}`);
  if (resume.skills)       parts.push(`技能标签：${resume.skills}`);
  if (resume.content)      parts.push(`简历正文：${String(resume.content).slice(0, 1200)}`);
  return parts.join('\n');
}
```

字段取舍依据：

| 字段 | 是否纳入 | 依据 |
|---|---|---|
| `skills` | 是 | 结构化技能声明，信息密度最高 |
| `content` | 是 | 包含项目经历与能力程度的自由描述 |
| `major` / `grade` | 是 | 与岗位匹配度存在相关性 |
| `school` / `student_name` | 是 | 影响较小，仅在检测同质样本时起作用 |
| `phone` / `email` | 否 | 与匹配无关，且为个人信息，不应进入模型输入 |

字段缺失时该行不写入，不写占位文本。占位文本会引入与语义无关的 token，降低有效信息在向量中的比重。

### 4.3 岗位侧构造规则

```js
export function buildPositionText(position) {
  const parts = [];
  if (position.title)            parts.push(`岗位名称：${position.title}`);
  if (position.required_skills)  parts.push(`期望技能：${position.required_skills}`);
  if (position.requirement)      parts.push(`岗位要求：${String(position.requirement).slice(0, 1200)}`);
  return parts.join('\n');
}
```

两侧构造方式保持对称（均为"字段标识 + 值、换行分隔、正文截断"）。非对称构造会使一侧的向量系统性偏移，导致余弦值整体偏低。

### 4.4 截断策略

正文部分截断为 1200 个字符。

计算依据：中文文本平均 1 个汉字对应 1~2 个 token，1200 字符对应 1200~2400 token，仍可能超过 512 token 上限，由模型进一步截断。前置截断的作用是限制编码耗时，因为编码耗时随 token 数增长。

截断位置为尾部。因此字段顺序即信息优先级：`技能标签` 位于 `简历正文` 之前，即使正文被截断，技能信息仍完整保留。

---

<a id="s5"></a>
## 5. 向量缓存

### 5.1 缓存的必要性

计算一次 `/api/v1/resumes/:id/match-top` 需要编码 1 份简历与 N 个岗位。若 N = 50 且无缓存，每次请求执行 51 次推理。同一份简历会被重复查询，岗位文本在两次编辑之间保持不变。无缓存的重复计算不产生新信息。

### 5.2 两级缓存结构

| 层级 | 存储位置 | 生效范围 | 容量上限 |
|---|---|---|---|
| 一级 | 进程内 `Map` | 进程生命周期 | 500 条，超限后整体清空 |
| 二级 | SQLite 表 `embedding_cache` | 跨进程重启 | 无上限（受数据库规模限制） |

一级缓存超限时执行整体清空，不实施 LRU 淘汰。依据：本系统向量条目总数在数百量级，清空后重新查询 SQLite 的开销低于维护访问顺序数据结构的开销。

### 5.3 缓存键与失效条件

缓存键由三元组构成：

```
(owner_type, owner_id, model)
```

命中条件附加第四项：`text_hash` 与当前文本的 SHA-1 摘要一致。

```js
const hash = sha1(text);
if (row && row.text_hash === hash) { /* 使用缓存 */ }
```

选择内容摘要而非时间戳作为失效条件的理由：

| 候选条件 | 缺陷 |
|---|---|
| `updated_at` 时间戳 | 内容未变但记录被更新的情形会导致缓存无谓失效；时间戳精度可能不足 |
| **内容摘要** | 内容变化才失效，与计算结果的实际依赖一致 |

`model` 作为键的一部分的作用：模型更换后，旧模型产生的向量在新模型下不可复用。若键中不含模型标识，新旧向量会被混用，计算不报错但结果错误。

### 5.4 批量编码流程

```js
export async function embedOwners(items) {
  const results = [];
  const toEncode = [];
  for (const it of items) {
    const cached = readCache(it.ownerType, it.ownerId, sha1(it.text));
    if (cached) results.push({ ...it, vector: cached });
    else { const placeholder = { ...it, vector: null }; results.push(placeholder); toEncode.push(placeholder); }
  }
  if (toEncode.length > 0) {
    const vectors = await embedTexts(toEncode.map((x) => x.text));
    toEncode.forEach((item, i) => { item.vector = vectors[i]; writeCache(..., vectors[i]); });
  }
  return results;
}
```

流程分三步：

1. 逐项计算文本摘要并查询缓存，命中项直接取用。
2. 未命中项集中为批次，一次调用模型完成编码。批量编码优于逐条编码的原因在于模型调用存在固定开销，且批量可提高矩阵运算的并行度。
3. 编码结果写回两级缓存。

实测：对同一简历连续两次调用推荐接口，第一次耗时 1 ms（部分或全部命中），第二次耗时 0 ms（全部命中）。

### 5.5 向量存储编码

SQLite 不具备原生数组类型。本实现将 512 个 32 位浮点数按内存布局转换为字节序列，再以 base64 文本存储：

```js
function vectorToText(vec) {
  return Buffer.from(new Float32Array(vec).buffer).toString('base64');
}
function textToVector(text) {
  const buf = Buffer.from(text, 'base64');
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
}
```

体积计算：512 × 4 字节 = 2048 字节，base64 编码后膨胀至约 2731 字节（2.7 KB）。

与 JSON 数组表示的对比：

| 表示方式 | 单条体积 | 精度 |
|---|---|---|
| JSON 数组 `[0.12,-0.34,…]` | 6~8 KB | 浮点转字符串存在精度损失 |
| Float32 + base64 | 2.7 KB | 无损失 |

### 5.6 表结构

```sql
CREATE TABLE embedding_cache (
  owner_type TEXT NOT NULL,   -- 'resume' | 'position' | 'vocab' | 'resume_text'
  owner_id   TEXT NOT NULL,
  model      TEXT NOT NULL,
  dim        INTEGER NOT NULL,
  vector     TEXT NOT NULL,   -- Float32 数组的 base64
  text_hash  TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_type, owner_id, model)
);
```

---

<a id="s6"></a>
## 6. 相似度计算与分数标定

### 6.1 余弦相似度定义

$$
\cos(\mathbf{a},\mathbf{b}) = \frac{\sum_{i=1}^{n} a_i b_i}{\sqrt{\sum_{i=1}^{n} a_i^2}\sqrt{\sum_{i=1}^{n} b_i^2}}
$$

实现：

```js
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
```

两处防御性判断：

- 长度不等时返回 0：防止不同维度或不同模型的向量参与计算。
- 任一向量范数为 0 时返回 0：防止除零产生 `NaN`，`NaN` 参与排序会使整个结果不可用。

### 6.2 度量选择依据

选择余弦相似度而非欧几里得距离的原因：文本长度影响向量在归一化前的模长。以欧几里得距离度量时，"内容多的文本"与"内容少的文本"之间的距离会因模长差异而增大，该差异与语义无关。

余弦相似度只使用向量方向，不使用模长，因此不受文本长度影响。

### 6.3 原始余弦的分布特征

对中文短文本，原始余弦值的分布区间明显窄于理论区间 [-1, 1]。实测样本：

| 文本对 | 语义关系 | 余弦 |
|---|---|---|
| 「精通 Vue 与 Node.js」~「会打篮球，参加过校队」 | 无关 | 0.5020 |
| 「喜欢摄影，擅长海报设计与排版」~「会打篮球，参加过校队」 | 无关 | 0.4691 |
| 「精通 Vue 与 Node.js」~「熟悉 Vue3 框架」 | 相关 | 0.7479 |

无关文本对的余弦下界约 0.46，相关文本对的余弦上界约 0.75。

成因：Transformer 输出的上下文向量在空间中分布不均，各向量存在共同方向分量，使任意两向量的余弦值系统性偏高。该现象在文献中称为表示的各向异性（anisotropy），为上下文嵌入模型的固有性质。

### 6.4 线性标定方法

将原始余弦值按线性映射转换为 0~100 整数：

```js
const CALIB_MIN = Number(process.env.ML_CALIB_MIN || 0.46);
const CALIB_MAX = Number(process.env.ML_CALIB_MAX || 0.75);

export function calibrate(cos) {
  const span = CALIB_MAX - CALIB_MIN;
  if (span <= 0) return 0;
  const v = (cos - CALIB_MIN) / span;
  return Math.round(Math.max(0, Math.min(1, v)) * 100);
}
```

计算式：

$$
\text{score} = \mathrm{clamp}\left(\frac{\cos - 0.46}{0.75 - 0.46},\; 0,\; 1\right) \times 100
$$

### 6.5 标定参数的确定过程

参数取值由实测分布确定，非估计值。验证脚本 `server/scripts/verify-calibration.mjs` 输出的完整对照：

| 简历 | 岗位 | 余弦 | 标定分 | 技能命中 | 标签分 | 综合分 |
|---|---|---|---|---|---|---|
| 孙小美 | 宣传部干事 | 0.7166 | 88 | 2/3 | 67 | 79 |
| 王小明 | 前端开发干事 | 0.6908 | 80 | 1/4 | 25 | 58 |
| 赵小红 | 活动策划干事 | 0.6934 | 80 | 3/3 | 100 | 88 |
| 王小明 | 活动策划干事 | 0.6209 | 55 | 0/3 | 0 | 33 |
| 钱多多 | 前端开发干事 | 0.6002 | 48 | 0/4 | 0 | 29 |
| 孙小美 | 活动策划干事 | 0.5814 | 42 | 0/3 | 0 | 25 |
| 孙小美 | 前端开发干事 | 0.5780 | 41 | 0/4 | 0 | 25 |
| 赵小红 | 宣传部干事 | 0.5739 | 39 | 0/3 | 0 | 23 |
| 赵小红 | 前端开发干事 | 0.5468 | 30 | 0/4 | 0 | 18 |
| 钱多多 | 活动策划干事 | 0.5459 | 30 | 0/3 | 0 | 18 |
| 王小明 | 宣传部干事 | 0.5263 | 23 | 0/3 | 0 | 14 |
| 钱多多 | 宣传部干事 | 0.4848 | 9 | 0/3 | 0 | 5 |

标定分分布区间 9 ~ 88，跨度 79。

### 6.6 参数确定过程中的一次错误取值

初期取 `CALIB_MIN = 0.48`、`CALIB_MAX = 0.82`。该取值未被实测数据支持：当前模型与数据下的最大余弦为 0.7479，低于上限 0.82，该上限不会被达到。

后果：所有标定分被压缩在低区间。按 `[0.48, 0.82]` 计算，最强相关对的标定分为 79，无关对为 1，最高分无法超过 80。

修正：按实测分布调整为 `[0.46, 0.75]`，同一批数据的标定分区间变为 9 ~ 99。

该错误的性质：程序不报错，输出形式正确，仅数值区间不合理。此类问题只能通过输出分布的统计检查发现。为此 `verify-calibration.mjs` 增加分布诊断：

```
if (maxCal < 80) 提示 CALIB_MAX 可能设置过高
if (maxCal > 99 && minCal > 30) 提示 CALIB_MIN 可能设置过低
```

### 6.7 标定对阈值判定的影响

标定的作用是使绝对分值具有可解释的量纲。系统存在基于绝对值的判定：

```js
if (m.score >= minScore) { /* 该岗位进入推荐列表 */ }
```

`minScore` 默认值为 50（社团侧调剂建议）或 0（简历侧推荐列表）。

若不执行标定而直接以 `cos × 100` 作为分值，无关文本对有 47~50 分，在 `minScore = 50` 时接近阈值，推荐结果会包含大量无关岗位，筛选功能失效。标定后无关文本对得分为 5~9，能被阈值正确排除。

标定为单调线性变换，不改变任意两项的相对大小，即不改变排序结果。

### 6.8 更换模型时的重新标定要求

不同模型的余弦分布区间不同。沿用旧参数会导致新模型的输出集中于 0~10 或 90~100 两个极端。

参数已设为环境变量（`ML_CALIB_MIN`、`ML_CALIB_MAX`），并通过 `GET /api/v1/ml/status` 的 `calibration` 字段对外返回当前生效值。

更换模型后的操作顺序：

1. 执行 `npm run ml:calibration`；
2. 读取输出的余弦最小值与最大值；
3. 将两个环境变量设为该区间（可留 0.01~0.02 余量）；
4. 重新执行脚本，确认标定分分布跨度合理。

---

<a id="s7"></a>
## 7. 综合评分

### 7.1 评分公式

```js
const resumeSkills = parseSkills(resumeSkillsRaw);
const requiredSkills = parseSkills(requiredRaw);
const hitSkills = requiredSkills.filter((s) => new Set(resumeSkills).has(s));
const tagScore = requiredSkills.length > 0 ? hitSkills.length / requiredSkills.length : 0;

const cos = cosine(resumeVec, posVec);
const semantic = calibrate(cos);

const score =
  requiredSkills.length > 0
    ? Math.round(semantic * W_SEMANTIC + tagScore * 100 * W_TAG)
    : semantic;
```

即：

$$
\text{score} =
\begin{cases}
0.6 \times \text{semantic} + 0.4 \times 100 \times \dfrac{|\text{hit}|}{|\text{required}|}, & |\text{required}| > 0 \\[6pt]
\text{semantic}, & |\text{required}| = 0
\end{cases}
$$

权重取值：`ML_W_SEMANTIC = 0.6`，`ML_W_TAG = 0.4`。

### 7.2 语义分与标签分组合的依据

依据一：**可解释性要求。**

招新场景需要对录用结果给出可核对的理由。语义分为模型输出，无法分解到具体依据。技能命中与缺失为离散事实，可直接核对。

因此计算结果中始终保留 `hitSkills`、`missingSkills`、`semantics.cosine`、`semantics.calibrated`、`tags.score` 五个中间量，供接口调用方与界面展示。

依据二：**同域样本的相似度差异不足。**

所有简历文本的体裁相同（学生撰写的简历），语义向量之间存在系统性相似成分。实测显示，12 对组合中有 9 对的余弦落在 0.52~0.62 区间，即使人工判断为明显不匹配。仅使用语义分时，不同候选人的分值差异不足以支持排序。技能命中率为离散且取值域较宽的独立信号，可提供额外区分度。

依据三：**人工标注标签的准确性高于模型推断。**

`resume.skills` 由学生本人填写，属于人工声明。技能抽取组件从正文推断的结果存在误报。将人工声明与模型推断等同对待会降低结果准确性。

### 7.3 权重取值的依据与局限

`0.6 / 0.4` 为经验取值，非经数据调优的结果。

确定依据：语义分覆盖正文中标签未包含的信息，因此权重略高；技能命中率准确但覆盖不全（学生常只填写 2~3 项），因此权重略低。

局限：标注样本为 0，无法通过数据确定最优权重。该取值通过环境变量对外暴露，未记录为已调优参数。

### 7.4 排序规则

```js
.sort((a, b) =>
  b.score - a.score ||
  (b.status === 'open') - (a.status === 'open') ||
  a.filledCount / Math.max(1, a.headcount) - b.filledCount / Math.max(1, b.headcount)
)
```

三级排序键：

| 级别 | 键 | 方向 |
|---|---|---|
| 1 | `score` | 降序 |
| 2 | 招新状态是否为 `open` | `open` 优先 |
| 3 | 招满率 `filledCount / headcount` | 升序 |

设置后两级键的原因：`score` 为整数，大量记录并列。缺少次级键时排序结果取决于数据库返回顺序，同一查询在不同时刻可能产生不同顺序。

`Math.max(1, headcount)` 用于避免 `headcount` 为 0 时的除零。

---

<a id="s8"></a>
## 8. 技能标签自动抽取

### 8.1 输入输出定义

输入：一份简历的 `skills` 字段与 `content` 字段拼接文本。

输出：

```json
{
  "resumeId": "res_xxx",
  "skills": ["活动组织", "活动策划", "文案写作"],
  "details": [
    { "term": "活动组织", "source": "exact", "score": 1 },
    { "term": "活动策划", "source": "semantic", "score": 0.6712 }
  ],
  "humanSkills": "文案,活动组织,沟通",
  "method": "dictionary+semantic"
}
```

`skills` 为去重后的标签名称数组，`details` 保留每项的来源与分值。

### 8.2 受控词表

```js
export const SKILL_VOCAB = [
  'JavaScript', 'TypeScript', 'Vue', 'React', 'HTML', 'CSS', ...,
  'Photoshop', 'Illustrator', 'Figma', '海报设计', 'UI设计', '排版', '配色', ...,
  '文案写作', '公众号运营', '新媒体运营', '活动策划', '活动组织', ...,
  '机器学习', 'PyTorch', '数据分析', '数学建模', 'ACM', ...
];
```

规模：92 项（实测）。

作用：统一标签的命名形式。无词表时，`JS`、`javascript`、`JavaScript` 会作为三个不同标签存入数据库，导致统计与匹配失效。有词表时，不同书写形式归一到同一标签。

该词表同时构成抽取能力的上限：词表未收录的技能无法被任一路径抽取。

### 8.3 精确匹配路径

```js
export function extractExact(text) {
  const src = String(text || '').toLowerCase();
  const hits = [];
  for (const { term, lower } of VOCAB_LOWER) {
    if (src.includes(lower)) hits.push({ term, source: 'exact', score: 1 });
  }
  return hits;
}
```

运算为字符串包含判断，不涉及模型。

特征：精确率高（子串出现即判定命中，不产生误报）；召回率低（仅识别词表原词，同义表述无法识别）；耗时与词表规模成正比，无模型调用开销。

### 8.4 语义匹配路径

```js
const vocab = await getVocabVectors();
const textVec = await embedOwner('resume_text', `${resumeId}:fulltext`, text);

const scored = vocab
  .map((v) => ({ term: v.term, score: cosine(textVec, v.vector) }))
  .filter((x) => x.score >= SEMANTIC_THRESHOLD)
  .sort((a, b) => b.score - a.score)
  .slice(0, SEMANTIC_TOP_K);
```

计算过程：

1. 对 92 项词表文本执行一次批量编码，结果在进程生命周期内复用。
2. 对简历全文编码，得到单向量。
3. 计算该向量与每个词表向量的余弦值。
4. 保留余弦不低于阈值（`ML_SKILL_THRESHOLD`，默认 0.62）的项。
5. 按余弦降序取前 `ML_SKILL_TOP_K`（默认 6）项。

阈值取值依据：无关文本对的余弦基线约 0.46~0.52。阈值 0.62 相对基线留有余量，取偏保守值以降低误报。

特征：召回率高（可识别词表未直接出现但语义相近的表述）；精确率低于精确匹配路径；需要一次模型编码（词表向量已缓存，简历全文每次编码一次）。

### 8.5 结果合并规则

```js
const byTerm = new Map();
for (const h of exact) byTerm.set(h.term.toLowerCase(), h);
for (const h of semantic) {
  const k = h.term.toLowerCase();
  if (!byTerm.has(k)) byTerm.set(k, h);
}
```

同一标签被两条路径同时命中时，保留 `source = 'exact'` 的记录。依据：精确匹配的判定不含推断成分。

### 8.6 与人工标签的关系

抽取结果仅写入 `resume.skills_auto`，不修改 `resume.skills`。

```sql
ALTER TABLE resume ADD COLUMN skills_auto TEXT;   -- 迁移 005
```

保持两个字段独立的依据：

1. `skills` 为学生本人在提交时声明，属于其主观陈述；模型推断结果不具备同等效力。
2. 模型抽取存在误报，覆盖后无法恢复原始声明。
3. 两字段并存可用于评估抽取准确率，为后续调整词表与阈值提供依据。

界面同时展示两个字段，并通过标签样式区分来源：精确匹配与语义推断分别使用不同视觉样式，语义推断项悬浮显示余弦值。

### 8.7 评价指标定义

对二分类判定（某技能是否属于该简历）：

| 情形 | 定义 |
|---|---|
| 真阳性 TP | 应抽取且已抽取 |
| 假阳性 FP | 不应抽取但已抽取（误报） |
| 假阴性 FN | 应抽取但未抽取（漏报） |

$$
\text{精确率} = \frac{TP}{TP + FP}, \qquad
\text{召回率} = \frac{TP}{TP + FN}
$$

本系统的取舍：优先保证精确率。

依据：漏报的后果是缺少一项参考信息，人工标签仍可提供依据；误报的后果是筛选依据本身失真，可能导致不合适的候选人被推荐。因此采用高精度路径优先、语义路径保守阈值、来源可区分、界面提示人工核对四项措施。

### 8.8 实测结果

输入为数据库中现有简历：

| 简历 | 人工标签 | 抽取结果 | 来源构成 |
|---|---|---|---|
| 赵小红 | 文案,活动组织,沟通 | 活动组织、活动策划、文案写作 | 精确 1、语义 2 |
| 孙小美 | 设计,海报,审美 | 海报设计、排版、UI设计、UX设计 | 精确 2、语义 2 |
| 王小明 | Vue,Node.js,项目协作 | Vue、Node.js | 精确 2、语义 0 |

三项观察：

1. 语义路径产生了预期内的扩展：`文案` → `文案写作`，`设计`/`海报` → `排版`/`UI设计`/`UX设计`。
2. 词表外的标签无法抽取：`项目协作` 未收录于 `SKILL_VOCAB`，两条路径均未命中，尽管人工标签包含该项。
3. 抽取结果不必然覆盖人工标签的全部内容。这是不覆盖 `skills` 字段的直接依据。

### 8.9 局限性

1. 召回上限由词表规模决定。词表外技能无法抽取。
2. 语义路径的阈值与 top-k 为固定值，不随文本长度或领域变化。
3. 单条简历的抽取需一次全文编码；批量处理耗时与简历数成正比（实测 3 份简历处理耗时低于 1 s）。
4. 抽取结果不含置信区间，仅输出原始余弦值。

---

<a id="s9"></a>
## 9. 候选人聚类

### 9.1 方法选择依据

可选方案与排除理由：

| 方案 | 排除理由 |
|---|---|
| 监督分类 | 无标注样本；且"候选人分为几类"本身无唯一正确答案 |
| 层次聚类 | 复杂度 O(n³)，结果对噪声敏感，且当前规模无需该复杂度 |
| DBSCAN | 需指定邻域半径与最小点数，当前数据量无法确定合理取值 |
| **K-means** | 复杂度 O(n·k·d·iterations)，参数少，结果可复现 |

选择 K-means 的原因：参数仅有簇数 k，k 可由轮廓系数自动选择；运算过程确定（固定随机种子后），结果可复现；在 n < 100 的规模下运算时间可忽略。

### 9.2 算法描述

输入：n 个 512 维向量，簇数 k。

过程：

```
1. 初始化 k 个中心点
2. 重复以下步骤直至中心点不再变化或达到最大迭代次数：
   2.1 对每个向量，计算到各中心点的距离，归入最近的簇
   2.2 对每个簇，将中心点更新为该簇全部向量的算术平均
3. 输出簇归属与中心点
```

最大迭代次数 `maxIter = 100`。

收敛性：步骤 2.2 使簇内平方和（下述 inertia）单调不增。该量有下界 0，故迭代必然终止。

### 9.3 距离度量

采用欧几里得距离的平方：

```js
function euclideanSq(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) { const d = a[i] - b[i]; s += d * d; }
  return s;
}
```

与第 6 节使用余弦相似度的关系：输入向量已归一化（范数为 1），此时

$$
\|\mathbf{a}-\mathbf{b}\|^2 = \|\mathbf{a}\|^2 + \|\mathbf{b}\|^2 - 2\,\mathbf{a}\cdot\mathbf{b} = 2 - 2\cos(\mathbf{a},\mathbf{b})
$$

即在单位向量上，欧几里得距离平方与余弦相似度严格单调负相关。因此在该输入条件下，两种度量产生相同的簇归属。

选择欧几里得距离的原因：K-means 的目标函数为簇内平方和最小化，该目标在欧几里得距离下有明确定义，中心点取算术平均即为最优解。

补充说明：本实现对中心点求算术平均后未重新归一化，因此后续迭代中"向量到中心点"的距离不再满足上述严格关系。这是 K-means 的标准形式（目标为最小化簇内平方误差，中心点取算术平均），与"归一化后的质心"属于不同的目标函数。在本系统的数据规模下两者差异不显著。

### 9.4 初始中心点选择

采用 K-means++ 方法：

```
1. 随机选取第一个中心点
2. 重复至选出 k 个中心点：
   计算每个向量到已有中心点的最小距离平方
   按该值的大小作为概率权重，随机抽取下一个中心点
```

实现：

```js
function kmeansPlusPlus(vectors, k, rnd) {
  const centers = [vectors[Math.floor(rnd() * vectors.length)]];
  while (centers.length < k) {
    const dists = vectors.map((v) => {
      let best = Infinity;
      for (const c of centers) best = Math.min(best, euclideanSq(v, c));
      return best;
    });
    const total = dists.reduce((a, b) => a + b, 0);
    if (total === 0) { centers.push(vectors[Math.floor(rnd() * vectors.length)]); continue; }
    let r = rnd() * total;
    let idx = 0;
    for (let i = 0; i < dists.length; i += 1) { r -= dists[i]; if (r <= 0) { idx = i; break; } }
    centers.push(vectors[idx]);
  }
  return centers;
}
```

选用该方法的原因：随机初始化的中心点可能集中分布，导致部分簇在迭代中不获得任何向量（空簇）。K-means++ 使初始中心点分散，可降低该情形出现的概率。

### 9.5 随机性控制

K-means 的初始中心点选择包含随机过程。若不控制，同一输入在不同次调用中会产生不同分组。

本实现使用固定种子的伪随机数发生器：

```js
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(seed);   // seed 固定为 42
```

作用：同一输入产生相同分组结果。该性质为界面稳定性与自动化测试的前提条件。

### 9.6 簇数选择

簇数上限：

```js
const maxK = Math.max(2, Math.min(4, Math.floor(rows.length / 2)));
```

上限取 4 的原因：聚类结果供人工快速筛选使用，簇数超过 4~5 个时，逐组筛选的效率低于直接逐份查看。

自动选择流程：在区间 [2, maxK] 内遍历取值，对每个 k 执行一次 K-means，计算轮廓系数，取轮廓系数最大的 k。

### 9.7 聚类质量评估

对每个样本 i：

$$
a(i) = \text{样本 } i \text{ 到同簇其他样本的平均距离}
$$

$$
b(i) = \text{样本 } i \text{ 到最近其他簇中全部样本的平均距离}
$$

$$
s(i) = \frac{b(i) - a(i)}{\max\{a(i), b(i)\}}
$$

全局轮廓系数为各样本 $s(i)$ 的平均值。

单样本同簇样本数不大于 1 时 $a(i)$ 无定义，该样本不参与平均。

取值解释：

| 区间 | 含义 | 界面显示 |
|---|---|---|
| 0.71 ~ 1.00 | 结构强 | — |
| 0.51 ~ 0.70 | 结构合理 | 分组清晰 |
| 0.26 ~ 0.50 | 结构弱 | 勉强可分 |
| 0.00 ~ 0.25 | 近似无结构 | 较同质 |
| < 0 | 分组不当 | 基本分不开 |

轮廓系数偏低不作为故障处理。该结果表明当前候选人集合内的向量分布不支持清晰的簇划分，属于对数据的有效描述。

### 9.8 小样本条件下的退化与保护

当 k 接近 n 时，多数簇仅含 1 个样本。此时：

- 单样本簇的 $a(i)$ 无定义，不参与计算；
- 剩余样本与其最近的簇距离较大，$b(i)$ 显著大于 $a(i)$；
- 轮廓系数上升至接近 1.0。

该数值不反映分组质量，仅反映聚类已退化为近似逐样本分配。

实测对比：

| 保护措施 | n = 4 时的输出 |
|---|---|
| 无保护 | k = 6，轮廓系数 = 1.0 |
| 仅限制 k ≤ n/2 | k = 2，轮廓系数 = 0.2227 |
| 限制 n ≥ 6 与 k ≤ n/2 | 返回"候选人数不足，不执行聚类" |

保护措施实现：

```js
const MIN_N = 6;
if (rows.length < MIN_N) {
  return { clubId, available: true, clusters: [], k: 0,
    reason: `候选人数 ${rows.length}（<${MIN_N}）太少，聚类没有统计意义；建议直接人工筛选` };
}
const maxK = Math.max(2, Math.min(4, Math.floor(rows.length / 2)));
```

参数依据：

- `MIN_N = 6`：k 至少为 2，且每簇平均样本数不少于 3。低于该规模时轮廓系数不具备判别力。
- `k ≤ floor(n/2)`：保证平均每簇不少于 2 个样本，避免单样本簇。

### 9.9 簇特征描述

聚类输出仅包含样本归属与中心点坐标。为提供可读的簇描述，对每个簇统计成员技能标签的出现频次并取前 5 项：

```js
function profileSkills(members, topN = 5) {
  const counter = new Map();
  for (const m of members) {
    for (const s of String(m.skills || '').split(/[,，、;；]/).map((x) => x.trim()).filter(Boolean)) {
      counter.set(s, (counter.get(s) || 0) + 1);
    }
  }
  return [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)
    .map(([skill, count]) => ({ skill, count }));
}
```

输出示例：

```
第 2 组（3 人）
共同特征：Vue ×2  设计 ×2  海报 ×1
```

必要性：簇编号（第 1 组、第 2 组）本身不携带信息。使用者需要根据成员的共同属性判断该组的构成，才能决定是否按组处理。

### 9.10 实测结果与接口输出

接口返回结构：

```json
{
  "clubId": "club_xxx",
  "available": true,
  "k": 2,
  "silhouette": 0.2227,
  "inertia": 0.25,
  "note": "轮廓系数越接近 1 表示分组越清晰……",
  "centroidSimilarity": [{ "a": 0, "b": 1, "cosine": 0.8123 }],
  "clusters": [
    { "index": 0, "size": 1, "profile": [...], "members": [...] }
  ]
}
```

`inertia` 为各样本到所属簇中心点的距离平方和。`centroidSimilarity` 为中心点两两之间的余弦值，用于判断不同簇在向量空间中是否充分分离。

---

<a id="s10"></a>
## 10. 运行控制与容错

### 10.1 可用性判定与降级

调用方在进入机器学习路径前检查可用性：

```js
if (!ML_ENABLED || !isReady()) {
  return ruleBasedResult();   // 使用字符串集合求交
}
```

降级判定依据：该组件的失败后果与业务影响。

| 组件 | 失败时行为 | 依据 |
|---|---|---|
| 匹配与聚类 | 降级至规则算法，继续提供服务 | 输出为建议值，不写数据库；分值不准确不导致数据错误 |
| 鉴权与权限 | 拒绝请求 | 放行将使未授权方获得数据访问与写入能力 |

该区分在安全设计中对应 fail-open 与 fail-closed 两类策略。

降级输出中的 `method` 字段值为 `tags-only`，与正常状态的 `semantic+tags` 区分，供调用方判断当前结果来源。

### 10.2 启动阶段的异步加载

```js
// src/index.js
warmupML();                    // 不 await
clubApp.listen(clubPort);      // 立即监听
```

不同步等待模型加载的原因：首次运行需下载 23.3 MB 模型文件，在网络条件下可能耗时数十秒。若阻塞启动，端口监听延迟会导致容器健康检查失败、平台存活探测判定失败。

代价是系统存在"模型已加载"与"模型未加载"两种运行状态。该状态通过 `isReady()` 对外暴露，由调用方按 10.1 的规则处理。

### 10.3 可选依赖的处理

```js
const { env, pipeline } = await import('@xenova/transformers');
```

使用动态导入而非静态导入的原因：静态导入在模块解析阶段执行，依赖缺失时整个服务无法启动；动态导入的失败可被 `try/catch` 捕获，降级为规则模式。

模型加载的整体异常处理：

```js
try {
  extractor = await pipeline('feature-extraction', MODEL_NAME, { quantized: true });
  ready = true;
} catch (e) {
  loadError = e;
  ready = false;
  console.warn('[ml] 嵌入模型不可用，将回退到规则匹配：', e.message);
}
```

### 10.4 状态查询接口

`GET /api/v1/ml/status`：

```json
{
  "enabled": true,
  "ready": true,
  "model": "Xenova/bge-small-zh-v1.5",
  "dim": 512,
  "remoteHost": "https://hf-mirror.com",
  "cacheDir": ".../server/data/models",
  "error": null,
  "memoryCacheSize": 7,
  "matchMode": "semantic",
  "note": "语义匹配已启用……",
  "calibration": { "min": 0.46, "max": 0.75 }
}
```

界面在侧边栏固定位置显示该状态的三类取值：语义模式、规则模式（模型未就绪）、已关闭（`ML_ENABLED=0`）。点击可查看 `error` 字段的具体内容。

设置该显示的原因：降级若不可见，使用者会在不知情的情况下使用规则算法的结果。

---

<a id="s11"></a>
## 11. 能力边界

### 11.1 已实现能力

| 能力 | 方法 | 是否需标注 |
|---|---|---|
| 语义相似度计算 | 预训练模型推理 | 否 |
| 技能标签抽取 | 受控词表精确匹配 + 语义近邻 | 否 |
| 候选人聚类 | K-means | 否（无监督） |

### 11.2 未实现能力及原因

| 能力 | 未实现原因 |
|---|---|
| 录用概率预测 | 标注样本数量为 0，无法训练；以合成数据构造训练集会产生无实际意义的结果 |
| 学习排序（LTR） | 同上；此外现有标签受名额约束影响，不反映真实偏好 |
| 模型微调 | 4 份样本上微调会导致模型记忆该 4 份样本，泛化能力下降 |
| 基于点击的推荐模型 | 系统未记录曝光与点击行为，无训练数据 |

学习排序不可行的具体分析：

依据一：样本规模。单个社团一季度的有效标注为 10~30 条。排序模型的常用样本规模为 10³ 以上。

依据二：标签语义。岗位需求人数有限（常见为 1~3 人），排名第 3 的优秀候选人同样被标注为淘汰。该标签描述的是"是否进入前 N 名"，不描述"是否适合该岗位"。以该标签训练二分类模型，学习目标与业务目标不一致。正确处理需使用 listwise 排序方法，其实现复杂度显著高于当前系统规模。

依据三：选择偏差。仅"被审阅并作出结论"的候选人产生标签。未经审阅的候选人无标签；未投递的岗位无数据。

### 11.3 输出数值的解释

综合分为 0~100 的整数，表示文本语义相似度与技能命中率的加权结果。

该数值不表示概率。88 分表示"该简历文本与该岗位要求在语义上接近"，不表示"该候选人有 88% 的录用可能"。

概率解释要求以历史数据估计条件概率 $P(\text{录用} \mid \text{特征})$，本系统无此数据。

界面文案使用"综合匹配度"，不使用"录用可能性"。

### 11.4 输入长度敏感性

对短输入，相似度计算结果的区分能力下降。实测：

| 输入对 | 余弦 | 标定分 |
|---|---|---|
| 「前端开发」~「Vue3 页面实现与组件封装」 | 0.5134 | 18 |
| 「海报设计」~「视觉传达、排版与配色」 | 0.5752 | 40 |
| 「活动策划」~「组织线下活动，协调场地与人员」 | 0.6058 | 50 |
| 「文案写作」~「公众号推文撰写」 | 0.6509 | 66 |

上表中语义明确相关的文本对得分偏低。原因是模型依赖上下文确定语义，输入仅含少量词语时，向量主要反映该词的通用语义，缺少具体指代的上下文。

系统的处理方式：文本构造阶段将多个字段拼接为段落（第 4 节），避免仅以少数词语作为输入。

### 11.5 词表规模对抽取能力的限制

技能抽取的两个路径均以 `SKILL_VOCAB` 为取值范围。词表未收录的技能无法被抽取，与文本中是否出现无关。

实测例证：人工标签含 `项目协作`，该词未收录于词表，精确匹配与语义匹配均未命中。

改进方向：从实际投递数据中统计高频标签，定期扩充词表。约束：词表规模扩大会增加命名归一化的难度，需要同步维护同义词映射。

### 11.6 标定参数的适用范围

`[0.46, 0.75]` 基于当前模型与当前数据（技术类与文艺类社团混合、4 份简历、3 个岗位）确定。

数据构成变化（例如全部为技术类岗位）会导致余弦分布改变，参数需要重新确定。

参数通过接口对外返回，便于在使用中发现问题。

---

<a id="s12"></a>
## 12. 接口与执行流程

### 12.1 匹配接口

`GET /api/v1/resumes/:id/match-top?clubId=&limit=&minScore=`

执行流程：

```
1. 认证：HTTP Basic Auth → X-Club-Token → requireOwnClubVia('resume','id')
2. 分发层 matchService.recommendPositionsForResume() 转调语义实现
3. 读取简历记录与岗位列表
4. 判定 ML 可用性
   4a. 不可用：逐对执行字符串集合求交，method = 'tags-only'
   4b. 可用：继续
5. 构造简历与各岗位的文本表示
6. 调用 embedOwners() 取得向量（缓存优先，未命中者批量编码）
7. 逐对执行 scorePair()：余弦 → 标定 → 与标签分加权
8. 按三级排序键排序，按 minScore 过滤，按 limit 截断
9. 返回 { resume, recommendations, total, method }
```

`scorePair()` 的完整输出：

```json
{
  "score": 58,
  "semantics": { "cosine": 0.6908, "calibrated": 80, "weight": 0.6 },
  "tags": { "score": 25, "weight": 0.4 },
  "hitSkills": ["vue"],
  "missingSkills": ["html", "css", "javascript"],
  "resumeSkills": ["vue", "node.js"],
  "requiredSkills": ["html", "css", "javascript", "vue"],
  "method": "semantic+tags"
}
```

### 12.2 技能抽取接口

`POST /api/v1/ml/resumes/:id/auto-skills`

执行流程：

```
1. 认证：Basic Auth → X-Club-Token → requireOwnClubVia('resume','id')
2. 读取简历记录
3. 拼接 text = [skills, content].join('\n')
4. 执行 extractExact(text)：字符串包含判断，不调用模型
5. 判定 ML 可用性
   5a. 可用：执行 extractSemantic()
       - getVocabVectors()：词表向量（进程内首次调用时编码）
       - embedOwner('resume_text', `${id}:fulltext`, text)
       - 逐项计算余弦，按阈值与 top-k 过滤
   5b. 不可用：跳过语义路径
6. 合并结果：精确匹配优先，语义结果补充未覆盖项
7. UPDATE resume SET skills_auto = ?, updated_at = ?
8. 返回 { resumeId, skills, details, humanSkills, method }
```

批量接口 `POST /api/v1/ml/clubs/:clubId/auto-skills` 对指定社团的全部简历逐一执行上述流程，返回逐条结果数组。

### 12.3 聚类接口

`GET /api/v1/ml/clubs/:clubId/clusters?k=`

执行流程：

```
1. 认证：Basic Auth → X-Club-Token → requireOwnClub('clubId')
2. 查询该社团全部投递记录（含关联简历的文本字段）
3. 判定 ML 可用性：不可用则返回 available=false
4. 判定样本规模：n < 6 则返回空结果与说明，不执行聚类
5. 调用 embedOwners() 取得全部简历向量
6. 计算 maxK = max(2, min(4, floor(n/2)))
7. 对 k = 2 .. maxK 依次执行：
   7a. kmeans(vectors, k, { seed: 42 })
   7b. silhouette(vectors, assign, centers)
   7c. 保留轮廓系数最大的结果
8. 按簇归属分组，对每簇计算 profileSkills()
9. 计算中心点两两余弦
10. 返回 { clubId, available, k, silhouette, inertia, centroidSimilarity, clusters }
```

`k` 参数省略时执行自动选择，指定时使用指定值（受 maxK 限制）。

### 12.4 异常处理

所有机器学习接口的处理函数均以 `asyncHandler` 包装：

```js
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
```

必要性：Express 4 不捕获异步处理函数返回的 Promise 拒绝。未包装时，异步异常不会进入错误中间件，请求会保持挂起状态直至客户端超时，同时在进程上产生未处理拒绝告警。

---

<a id="s13"></a>
## 13. 参数汇总

### 13.1 环境变量

| 变量 | 默认值 | 作用 | 调整条件 |
|---|---|---|---|
| `ML_ENABLED` | `1` | `0` 时完全停用机器学习组件 | 排查故障、极简部署 |
| `HF_MIRROR` | `https://hf-mirror.com` | 模型文件获取地址 | 更换镜像源 |
| `MODEL_CACHE_DIR` | `server/data/models` | 模型文件本地存储目录 | 调整存储位置 |
| `ML_CALIB_MIN` | `0.46` | 标定下界 | 更换模型或数据构成变化时重新确定 |
| `ML_CALIB_MAX` | `0.75` | 标定上界 | 同上 |
| `ML_W_SEMANTIC` | `0.6` | 语义分权重 | 有标注数据后可调整 |
| `ML_W_TAG` | `0.4` | 标签分权重 | 同上 |
| `ML_SKILL_THRESHOLD` | `0.62` | 技能语义抽取的余弦阈值 | 误报多则提高，漏报多则降低 |
| `ML_SKILL_TOP_K` | `6` | 技能语义抽取的最大补充数量 | 需要更完整抽取时提高 |

### 13.2 代码内常量

| 常量 | 取值 | 位置 |
|---|---|---|
| `MODEL_NAME` | `Xenova/bge-small-zh-v1.5` | `embeddingService.js` |
| `EMBEDDING_DIM` | `512` | `embeddingService.js` |
| `MEM_CACHE_MAX` | `500` | `embeddingService.js` |
| 文本截断长度 | `1200` 字符 | `semanticMatchService.js` |
| `SKILL_VOCAB` 规模 | `92` 项 | `skillExtractor.js` |
| `MIN_N` | `6` | `clustering.js` |
| 簇数上限 | `min(4, floor(n/2))` | `clustering.js` |
| K-means 最大迭代 | `100` | `clustering.js` |
| K-means 随机种子 | `42` | `clustering.js` |
| 簇特征保留数量 | `5` | `clustering.js` |

---

<a id="s14"></a>
## 14. 验证方法

### 14.1 验证脚本与覆盖范围

| 命令 | 输出内容 |
|---|---|
| `npm run ml:calibration` | 12 对组合的余弦、标定分、标签分、综合分全表；标定分分布诊断 |
| `npm run ml:verify` | 数据库结构与迁移版本检查、模型加载状态、规则分与语义分逐对对比、语义泛化抽样、缓存效果 |
| `npm run ml:verify:http` | 通过 HTTP 验证 `/ml/status`、聚类接口、技能抽取接口；校验自动抽取不覆盖人工标签 |
| `npm run ml:probe` | 模型能力抽样（相似度矩阵）与单条编码耗时 |
| `npm run smoke` | 端到端回归，含 18 个机器学习检查点（其中 4 个按模型状态与数据量条件执行，模型就绪且数据充足时实际执行 17 个） |

### 14.2 端到端检查项（机器学习部分）

| 检查项 | 判定条件 | 执行条件 |
|---|---|---|
| `/ml/status` 可读 | HTTP 200 | 始终 |
| 模型信息完整 | `model` 非空且 `dim > 0` | 始终 |
| 语义匹配接口可用 | HTTP 200 | 始终 |
| 匹配接口返回方法标识 | `method` 为字符串 | 始终 |
| 语义模式标识正确 | 就绪时 `method === 'semantic+tags'` | 模型就绪 |
| 未就绪时降级正确 | 未就绪时 `method === 'tags-only'` | 模型未就绪 |
| 语义明细存在 | 每项含 `semantics.cosine` | 模型就绪 |
| 余弦值域合法 | `-1 ≤ cosine ≤ 1` | 模型就绪 |
| 保留可解释信息 | `hitSkills` 与 `missingSkills` 均为数组 | 始终 |
| 单组合解释接口可用 | HTTP 200 | 存在可匹配岗位 |
| 技能抽取接口可用 | HTTP 200 | 始终 |
| 抽取结果含列表 | `skills` 为数组 | 始终 |
| 来源标注合法 | 每项 `source ∈ {exact, semantic}` | 始终 |
| 不覆盖人工标签 | 抽取后 `skills` 与抽取前一致 | 始终 |
| 聚类接口可用 | HTTP 200 | 始终 |
| 聚类返回可用性标识 | `available` 为布尔值 | 始终 |
| 聚类覆盖全部候选人 | 各簇 `size` 之和大于 0 | 聚类产生结果时 |
| 每簇含特征描述 | `profile` 为数组 | 聚类产生结果时 |

### 14.3 复现方式

```bash
cd server

# 标定数据全表与分布诊断
node scripts/verify-calibration.mjs

# 规则与语义的逐对对比
node scripts/verify-ml.mjs

# 接口层验证（需服务运行）
node scripts/verify-ml-http.mjs

# 模型能力抽样
node scripts/probe-embedding.mjs

# 端到端回归
node scripts/smoke-club-console.mjs
```

### 14.4 已知的验证局限

1. 验证数据集规模为 4 份简历与 3 个岗位，样本量不足以评估语义匹配在真实投递规模下的表现。
2. 无标注数据，无法计算准确率、召回率等指标在业务意义上的取值。
3. 技能抽取的正确性依赖人工判断，验证脚本仅检查结构合法性（来源标注、不覆盖人工标签），不检查抽取内容是否合理。
4. 聚类的正确性无客观标准，"分组是否合理"需人工审阅。
