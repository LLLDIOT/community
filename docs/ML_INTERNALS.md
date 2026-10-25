# 机器学习层深度讲解 —— 每一步的运行逻辑与背后的知识点

> 这份文档只讲 ML 部分，但是**逐步骤拆到能复现的程度**：
> 每一步在算什么、为什么这么算、参数从哪来、我踩过哪些坑。
>
> 与另外两份文档的分工：
> - `RUNTIME.md`：整个系统怎么跑（认证、状态机、部署）
> - `ML_PERSPECTIVE.md`：为什么当初该用规则、后来为什么换成语义
> - **本文**：ML 层内部每一步的机制与知识点

---

## 目录

- [第 0 章 全局：ML 层在系统的什么位置](#ch0)
- [第 1 章 把文字变成向量（嵌入）](#ch1)
- [第 2 章 喂什么给模型（文本组装）](#ch2)
- [第 3 章 编码与缓存](#ch3)
- [第 4 章 算相似度（余弦）](#ch4)
- [第 5 章 校准 —— 本项目最关键的一环](#ch5)
- [第 6 章 混合打分与排序](#ch6)
- [第 7 章 技能自动抽取（双路径）](#ch7)
- [第 8 章 无监督聚类](#ch8)
- [第 9 章 降级与可观测性](#ch9)
- [第 10 章 边界：这套 ML 做不到什么](#ch10)
- [第 11 章 三条请求的完整走查](#ch11)
- [附录 参数速查 / 文件地图 / 复现命令](#appendix)

---

<a id="ch0"></a>
## 第 0 章 全局：ML 层在系统的什么位置

### 0.1 为什么只有"匹配"这一层需要 ML

系统里有 6 个模块，ML 只对其中 3 个有意义：

| 模块 | 需要 ML 吗 | 原因 |
|---|---|---|
| 认证 / 权限 | ❌ | 规则明确，模型只会带来不确定性和攻击面 |
| 状态机 / 决策流 | ❌ | 业务规则，必须确定性可审计 |
| CRUD / 数据看板 | ❌ | 确定性查询 |
| **简历↔岗位匹配** | ✅ | 语义相似度，规则写不全 |
| **技能抽取** | ✅ | 自然语言理解 |
| **候选人分组** | ✅ | 无标签下的模式发现 |

**判断标准**：这件事的规则能不能被人**完整写出来**？能 → 用代码；不能 → 才考虑 ML。

### 0.2 三个能力的输入输出

| 能力 | 输入 | 输出 | 有无监督 |
|---|---|---|---|
| 语义匹配 | 简历文本 + 岗位文本 | 0~100 综合分 + 余弦 + 子分 | 无（预训练推理） |
| 技能抽取 | 简历文本 | `[{term, source, score}]` | 无（词表 + 相似度） |
| 候选人聚类 | N 份简历向量 | k 个簇 + 每簇画像 | **无监督** |

### 0.3 数据流

```
                    ┌──────────────────────────────────────────┐
   简历/岗位文本 ────▶│ ① 文本组装 buildResumeText/PositionText  │
                    └──────────────────┬───────────────────────┘
                                       ▼
                    ┌──────────────────────────────────────────┐
                    │ ② 编码 embedOwners                       │
                    │   内存缓存 → SQLite 缓存 → ONNX 推理      │
                    └──────────────────┬───────────────────────┘
                                       ▼  512 维向量
                    ┌──────────────────────────────────────────┐
                    │ ③ 余弦相似度 cosine()                     │
                    └──────────────────┬───────────────────────┘
                                       ▼  原始余弦（0.4~0.75）
                    ┌──────────────────────────────────────────┐
                    │ ④ 校准 calibrate()  → 0~100              │
                    └──────────────────┬───────────────────────┘
                                       ▼
                    ┌──────────────────────────────────────────┐
                    │ ⑤ 混合 scorePair() 语义60% + 标签40%      │
                    └──────────────────┬───────────────────────┘
                                       ▼
                    ┌──────────────────────────────────────────┐
                    │ ⑥ 排序 分数 → 招新中优先 → 招满率         │
                    └──────────────────────────────────────────┘
```

**五个步骤各自都可能出错**，而且错误会逐级放大。所以每一步都有独立验证手段。

---

<a id="ch1"></a>
## 第 1 章 把文字变成向量（嵌入）

### 1.1 为什么原来的字符串匹配不够

原来的算法：

```js
score = 命中技能数 / 岗位期望技能数      // 字符串完全相同才算命中
```

三个硬伤：

| 硬伤 | 例子 | 后果 |
|---|---|---|
| **同义词失效** | `Vue` vs `vue3` vs `前端框架` | 明明会，算不会 |
| **无权重** | `沟通` 和 `PyTorch` 等价 | 稀有技能不突出 |
| **可被堆砌** | 把所有技能都填上 | 分数虚高而无需付代价 |

### 1.2 知识点：嵌入（embedding）是什么

把一段文字映射成**高维空间里的一个点**：

```
"精通 Vue 与 Node.js"   →  [ 0.12, -0.34, 0.88, ... ]   512 个数
```

**核心假设**：意思相近的文本，点在空间里的**方向**也相近。

```
                  "精通Vue"
                · "熟悉Vue3框架"          ← 挤在一起（语义相近）
              ·

     "文案写作" ·
                              · "会打篮球"   ← 离得很远
   ─────────────────────────────────────▶
```

**为什么这就解决了同义词问题**：模型不需要见过"Vue3"这个词和"Vue"的映射表——它在训练时学到的是"这两个词出现的语境相似"，所以向量自然靠近。

**这是"泛化"的来源**：规则只能处理写死的等价关系，嵌入能处理**没见过的**等价关系。

### 1.3 这个模型到底是什么（真实参数）

模型：`Xenova/bge-small-zh-v1.5`（BAAI 出品，Xenova 转成 ONNX 格式）

实际读 `config.json` 得到的参数：

| 参数 | 值 | 含义 |
|---|---|---|
| `hidden_size` | **512** | 输出向量维度 |
| `max_position_embeddings` | **512** | 最多吃 512 个 token |
| `num_hidden_layers` | **4** | 4 层 Transformer |
| `num_attention_heads` | **8** | 每层 8 个注意力头 |
| `vocab_size` | **21128** | 词表大小（中文 BERT 的字符级词表） |

实际下载的文件：

| 文件 | 大小 |
|---|---|
| `onnx/model_quantized.onnx` | **22.9 MB** |
| `tokenizer.json` | 0.42 MB |
| 合计 | **23.3 MB** |

**参数量估算**（理解它为什么是"small"）：

```
词嵌入层     21128 × 512          ≈ 1080 万
4 层 Transformer，每层约：
  注意力   4 × 512²               ≈ 105 万
  前馈     2 × 512 × 2048         ≈ 210 万
  小计                            ≈ 315 万 × 4 层 ≈ 1260 万
────────────────────────────────────────────────
合计                               ≈ 2340 万参数
```

> 对比：GPT-3 是 1750 亿参数，是它的 **7500 倍**。
> 但做"中文短文本相似度"这件事，2340 万足够——**任务难度决定模型规模，不是越大越好**。

### 1.4 知识点：量化（quantization）

**现象**：fp32 的模型约 90MB，量化后只有 22.9MB。

**做法**：把权重从 32 位浮点压成 8 位整数。

```
原始：0.7234516  →  4 字节
量化： 0.72      →  1 字节（乘一个缩放因子还原）
```

**代价**：精度损失。**收益**：体积 4 倍小、内存带宽 4 倍省、CPU 推理更快。

**对本项目的意义**：23MB 意味着
- 首次下载在中国网络下几分钟内能完成
- 能放进 Docker 镜像而不臃肿
- 内存占用约 50MB，2GB 小机器也扛得住

> **知识点：量化几乎是端侧推理的默认选择。**
> 对分类/检索这类容错任务，int8 的精度损失通常 <1%，而速度收益 2~4 倍。

### 1.5 知识点：分词与子词

模型不是直接读字符串，而是先切成 **token**：

```
"精通 Vue 与 Node.js"
  → ["精", "通", "Vue", "与", "Node", ".js"]   （简化示意）
  → [3210, 4512, 8821, 1092, 6633, 4471]      （token id）
```

**中文为什么用字符级词表（21128）**：中文字词组合近乎无限，字符级是最稳的（约 2 万常用汉字+符号就够）。英文用子词（WordPiece/BPE），因为英文词有形态变化（`run/running/ran`），子词能共享词根。

**关键约束：最长 512 token。**

超过会被**截断**——后面的内容模型根本看不到。这是下面第 2 章截断策略的由来。

> **知识点**：这是 BERT 类模型的硬限制（位置编码长度）。
> 长文档要么截断，要么切片后取平均，要么换长上下文模型。

### 1.6 知识点：池化（pooling）—— 512 个 token 怎么变成 1 个向量

模型对每个 token 都输出一个向量，但我们只要**一个**代表整句的向量。怎么合并？

| 方式 | 做法 | 特点 |
|---|---|---|
| **CLS pooling** | 取第一个特殊 token（`[CLS]`）的输出 | BGE / Sentence-BERT 的标准做法 |
| **Mean pooling** | 所有 token 向量求平均 | 通用，但对长文本会被无关词稀释 |
| **Max pooling** | 逐维取最大值 | 少见 |

本项目用 **CLS**：

```js
const out = await extractor(batch, { pooling: 'cls', normalize: true });
```

**为什么用 CLS**：BGE 系列在训练时就是拿 `[CLS]` 位置的输出做对比学习的。用别的池化方式等于用错位置的特征——效果会明显下降。

> **知识点**：**池化方式必须跟模型的训练方式匹配**。
> 这是很多人"换了模型效果反而变差"的真实原因：不是模型不行，是取错了层/取错了位置。

### 1.7 知识点：归一化（normalize）让余弦退化为点积

```js
{ normalize: true }
```

归一化 = 把向量长度缩成 1。之后：

```
cos(A, B) = (A·B) / (‖A‖ · ‖B‖)
          = (A·B) / (1 × 1)
          = A·B            ← 只需点积，省掉两次开方和一次除法
```

**为什么要这样**：余弦相似度每次要算 4 次乘加 + 2 次开方 + 1 次除法。归一化后只要 1 次点积（512 次乘加）。在"1 份简历 × N 个岗位"的场景下，这个优化是实打实的。

> 本项目的 `cosine()` 仍写成通用版本（带归一化除法），因为要能处理未归一化的输入；
> 但实际传入的都是归一化向量，所以除法部分等于除以 1，开销可忽略。

### 1.8 知识点：BGE 为什么"懂"相似

BGE（BAAI General Embedding）是通过**对比学习（contrastive learning）**训练的：

```
训练样本：(查询, 正例, 负例)
目标    ：让 query 与正例的向量靠近，与负例的向量远离
```

它用了大规模的中文对（问答、检索、相似句）来训练。所以它学到的**不是"词频共现"，而是"这两个句子在语义上是不是同一件事"**。

**这就是为什么它能判断「文案」≈「文案写作」**——不是靠词典，是靠训练时见过大量类似的对。

### 1.9 为什么必须走 hf-mirror

实测网络情况：

```
huggingface.co          直连不可达
cdn-lfs.huggingface.co  直连不可达     ← 模型文件在这个域名
hf-mirror.com           直连可达 ✅    ← 国内镜像
```

所以代码里：

```js
const REMOTE_HOST = process.env.HF_MIRROR || 'https://hf-mirror.com';
env.remoteHost = REMOTE_HOST;
env.cacheDir = CACHE_DIR;   // server/data/models
```

**知识点：这是"国内可用性"问题，不是技术选择。**
> 如果直接写死 `huggingface.co`，整个 ML 层在中国网络下**首次启动就永远失败**。
> 这个坑很隐蔽：模型已缓存时一切正常，换台机器部署就挂。

### 1.10 实测性能

```
10 次单条编码耗时 15ms  →  平均 2ms/条
```

**2ms 是怎么来的**：
- 4 层小模型，512 维
- 输入是短文本（十几个 token）
- CPU 单线程推理
- int8 量化

**这个量级意味着什么**：1 份简历 vs 100 个岗位 = 100 次点积 ≈ 0.2ms（向量已缓存时）。**匹配不会被 ML 拖慢**。

---

<a id="ch2"></a>
## 第 2 章 喂什么给模型（文本组装）

### 2.1 这一步比选模型更重要

**反直觉的事实**：把同样的模型喂不同的文本，效果差异可能**比换模型还大**。

原因：模型只能理解它看到的东西。如果只喂 `Vue,Node.js`，它就不知道这是"技能"还是"爱好"；如果喂完整的"技能标签：Vue,Node.js"，它知道这是技能列表。

### 2.2 简历侧：`buildResumeText`

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

**三个设计决定**：

**① 加字段名（`技能标签：`、`专业：`）**

```
不加：Vue,Node.js 软件工程 大二
加  ：技能标签：Vue,Node.js
      专业：软件工程
      年级：大二
```

加字段名相当于给模型**语义提示**——告诉它"接下来这段是技能"。这类似大模型里的"指令化"思路，对 BERT 类模型也有效。

**② 用换行分隔而不是逗号**

换行让模型（通过位置编码）更容易区分不同字段的边界。

**③ 正文截断到 1200 字**

为什么是 1200 而不是 512（token 上限）？
- 中文字符 ≈ 1~2 token，1200 字约 1200~2400 token，**仍会超**，模型会自己截断
- 但先截到 1200 是为了**控制编码耗时**（长文本编码变慢）并减少无意义计算
- **技能放在正文之前**，所以即使正文被截，技能标签仍被完整看到 ← 这是关键

> **顺序即优先级**：模型对超长文本会截掉尾部，所以要**把最重要的信息放前面**。

### 2.3 岗位侧：`buildPositionText`

```js
if (position.title)            parts.push(`岗位名称：${position.title}`);
if (position.required_skills)  parts.push(`期望技能：${position.required_skills}`);
if (position.requirement)      parts.push(`岗位要求：${String(position.requirement).slice(0, 1200)}`);
```

与简历侧对称。**对称性很重要**：两侧文本结构相似，向量才可比。如果一边是"标题+技能+长文"，另一边只有"三个词"，余弦会系统性偏低。

### 2.4 缺字段的处理

```js
if (resume.major) parts.push(...)     // 空值不拼进去
```

不拼空字段（而不是拼 `专业：无`）。因为空串会引入噪声 token，稀释有效信息。

### 2.5 一个反例：只喂技能标签会丢什么

| 方案 | 拿到什么 | 丢掉什么 |
|---|---|---|
| 只喂 `skills` | 技能命中 | 正文里的项目经历、程度描述（"熟练"vs"了解"） |
| 只喂 `content` | 项目经历 | 结构化标签（学生可能只在 skills 里写了关键技能） |
| **两者拼起来** | 全部 | 无（代价是长度） |

---

<a id="ch3"></a>
## 第 3 章 编码与缓存

### 3.1 为什么要缓存

**不缓存的开销**：一次 `/match-top` 要编码 1 份简历 + N 个岗位。如果 N=50，每次请求 51 次推理 ≈ 100ms。看起来还好，但：
- 同一份简历会被反复查询（反复点"重新匹配"）
- 岗位文本**几乎不变**，每次都重算纯属浪费

### 3.2 两级缓存

```
① 内存 Map（进程内）        ← 最快，但重启丢失
② embedding_cache 表（SQLite）← 重启后仍有效
```

```js
function readCache(ownerType, ownerId, hash) {
  const key = `${ownerType}:${ownerId}:${hash}`;
  if (memCache.has(key)) return memCache.get(key);       // ① 内存
  const row = db.prepare(`SELECT vector, text_hash FROM embedding_cache ...`).get(...);
  if (row && row.text_hash === hash) {                    // ② 数据库
    memCache.set(key, vec);
    return textToVector(row.vector);
  }
  return null;                                            // ③ 未命中
}
```

**内存缓存的上限**：

```js
const MEM_CACHE_MAX = 500;
if (memCache.size >= MEM_CACHE_MAX) memCache.clear();   // 简单粗暴地整体清空
```

> **知识点**：这是"全清"而不是 LRU。
> 对一个最多几百条记录的系统，全清的开销（下次重新查 SQLite）远小于维护 LRU 链表的复杂度。
> **规模决定策略**——不要为了用上"标准做法"而引入不必要的复杂度。

### 3.3 知识点：为什么用内容哈希做缓存键

```js
const hash = sha1(text);           // 文本内容 → 64 位十六进制

// 命中条件：文本哈希一致
if (row && row.text_hash === hash) { 用缓存 }
```

**为什么不用 `updated_at` 时间戳**：

| 键 | 问题 |
|---|---|
| `updated_at` | 一次"改了什么又改回来"的 update 会让缓存白白失效；而且时间精度可能撞车 |
| **内容哈希** | **精确描述内容**。内容真变了才失效 |

**这是缓存设计的核心原则**：缓存键必须**完全由影响结果的输入决定**。

### 3.4 批量编码：`embedOwners` 的合并逻辑

```js
export async function embedOwners(items) {
  const results = [];
  const toEncode = [];
  for (const it of items) {
    const cached = readCache(it.ownerType, it.ownerId, sha1(it.text));
    if (cached) results.push({ ...it, vector: cached });   // 命中，直接用
    else { const p = { ...it, vector: null }; results.push(p); toEncode.push(p); }
  }
  if (toEncode.length > 0) {
    const vectors = await embedTexts(toEncode.map(x => x.text));  // ← 只编码未命中的
    toEncode.forEach((item, i) => { item.vector = vectors[i]; writeCache(...); });
  }
  return results;
}
```

**关键点**：**只把未命中的送去编码，而且一次批量送**。

批量比逐条快，因为：
- 模型调用有固定开销（张量准备、调度）
- 批量能利用矩阵乘法的并行性

**实测**：第二次调用 `/match-top` 走全缓存路径，耗时 **0ms**。

### 3.5 知识点：向量怎么存进 SQLite

```js
// 存：Float32 数组 → Buffer → base64 字符串
function vectorToText(vec) {
  return Buffer.from(new Float32Array(vec).buffer).toString('base64');
}
// 读：base64 → Buffer → Float32Array
function textToVector(text) {
  const buf = Buffer.from(text, 'base64');
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
}
```

**为什么是这个方案**：

| 方案 | 体积（512 维） | 问题 |
|---|---|---|
| JSON 数组 `[0.12,-0.34,...]` | ≈ 6~8 KB | 体积大、解析慢（浮点转字符串丢精度） |
| **Float32 + base64** | **2.7 KB** | 无精度损失、解析快 |

`512 × 4 字节 = 2048 字节`，base64 膨胀 1/3 → **约 2.7KB**。

> **知识点**：SQLite 没有原生数组/向量类型。
> 存二进制要么用 BLOB，要么编码成文本。base64 文本的好处是**能被 SQL 工具直接查看**，便于排查。

### 3.6 缓存表结构

```sql
CREATE TABLE embedding_cache (
  owner_type TEXT NOT NULL,   -- 'resume' | 'position' | 'vocab' | 'resume_text'
  owner_id   TEXT NOT NULL,
  model      TEXT NOT NULL,   -- 模型标识：换模型后旧向量自动不匹配
  dim        INTEGER NOT NULL,
  vector     TEXT NOT NULL,   -- base64
  text_hash  TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_type, owner_id, model)
);
```

**`model` 也是主键的一部分**：这是为了**模型升级时的正确性**。

```
现在：bge-small-zh-v1.5 的向量存在 (resume, res_x, 'bge-small-zh-v1.5')
将来：换成别的模型 → 查 (resume, res_x, '新模型') → 查不到 → 重新编码
```

如果没有 `model` 维度，换模型后会**直接用旧模型算的向量去算新模型的相似度**——这是最隐蔽的一类 bug，因为代码不报错，只是结果悄悄变差。

> **知识点：缓存必须包含"产生它的版本"。**
> 模型版本、代码版本、配置版本，任何影响输出的因素都该进缓存键。

---

<a id="ch4"></a>
## 第 4 章 算相似度（余弦）

### 4.1 公式与几何意义

```
               A · B          Σᵢ aᵢbᵢ
cos(A,B) = ───────────── = ─────────────────
             ‖A‖ · ‖B‖     √(Σaᵢ²) · √(Σbᵢ²)
```

**几何意义**：两个向量**夹角的余弦**。

```
        B
       ╱
      ╱ θ          θ 越小 → cos 越接近 1 → 越相似
     ╱            θ = 90° → cos = 0 → 无关
    ●──── A       θ = 180° → cos = -1 → 相反
```

### 4.2 为什么用夹角，不用欧氏距离

**关键洞察：文本长度会污染向量长度。**

```
"Vue"                          → 向量长度 ≈ 1（归一化前）
"Vue,Node.js,React,TypeScript" → 向量长度更大（归一化前）
```

如果用欧氏距离 `‖A-B‖`：
- 短文本与短文本 → 距离小
- 长文本与短文本 → 距离大（即使语义相近）

**距离把"内容多少"和"语义远近"混在一起了。**

用夹角的余弦只关心**方向**，而方向才代表语义：

> **知识点**：这也是为什么归一化之后，余弦等价于点积——
> 归一化把所有向量投到单位球面上，此时"方向差异"就是球面上的角度差异。

### 4.3 本项目的代码

```js
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;      // 零向量保护
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
```

**两个细节**：
- 长度不等直接返回 0（防御性：防止两个不同模型/不同维度混算）
- 零向量保护（防止除零得到 NaN，NaN 会污染整个排序）

### 4.4 值域与"高基线"问题

数学上余弦属于 `[-1, 1]`。但**实测中文短文本**：

```
「精通Vue」    vs 「会打篮球」      → 0.5020     ← 无关，却有 0.5！
「喜欢摄影」   vs 「会打篮球」      → 0.4691     ← 无关
「精通Vue」    vs 「熟悉Vue3」      → 0.7479     ← 相关
```

**几乎没有任何一对中文短文本的余弦低于 0.45。** 这直接引出第 5 章——必须校准。

---

<a id="ch5"></a>
## 第 5 章 校准 —— 本项目最关键的一环

### 5.1 现象：为什么无关文本也有 0.5

如果把原始余弦直接乘 100：

| 关系 | 余弦 | 直接×100 |
|---|---|---|
| 完全无关（Vue vs 篮球） | 0.5020 | **50 分** |
| 弱相关 | 0.6209 | 62 分 |
| 相关 | 0.6908 | 69 分 |
| 强相关 | 0.7479 | 75 分 |

**结果**：所有分数挤在 50~75 之间。

界面上 50 分和 75 分看起来差别不大，但实际上一个是"完全无关"、一个是"高度匹配"。**区分度彻底崩塌**。

### 5.2 知识点：各向异性（anisotropy）—— 高基线的成因

**这是现代上下文嵌入模型的一个已知特性**（Ethayarajh, 2019）。

原因：Transformer 的输出向量并不是均匀散布在整个 512 维空间里，而是**挤在一个狭窄的锥形区域内**。

```
理想情况（各向同性）：           实际情况（各向异性）：
                                
   ·  ·                             ╲  ╲ ╲
 ·      ·  ·                          ╲ ╲  ╲
   ·  ·        ← 铺满              ╲ ╲ ╲ ╲   ← 都挤在一个锥里
 ·    ·  ·                             ╲ ╲ ╲
```

**后果**：任意两个向量都共享这个"公共方向"，所以余弦天然偏高。基线被抬高到 0.5 左右。

**为什么会有这个现象**：
- 训练目标只要求"正例比负例更近"，不要求"负例之间足够远"
- 高频词/句法结构在向量中形成共同成分

> **知识点**：这不是模型"坏了"，是这类模型的固有性质。
> 所以**任何拿余弦当绝对分数的用法都必须先校准**——这是工程上极常见的疏漏。

### 5.3 解法：线性重标定

把实测的 `[最小值, 最大值]` 映射到 `[0, 100]`：

```js
export function calibrate(cos) {
  const span = CALIB_MAX - CALIB_MIN;
  const v = (cos - CALIB_MIN) / span;
  return Math.round(Math.max(0, Math.min(1, v)) * 100);   // 截断到 [0,1] 再乘 100
}
```

参数（**实测确定，不是猜的**）：

```js
const CALIB_MIN = Number(process.env.ML_CALIB_MIN || 0.46);
const CALIB_MAX = Number(process.env.ML_CALIB_MAX || 0.75);
```

**标定依据表**（`node scripts/verify-calibration.mjs` 的真实输出，12 对全部列出）：

| 简历 | 岗位 | 余弦 | 校准分（纯语义） | 命中 | 标签分 | 综合分 |
|---|---|---|---|---|---|---|
| 孙小美 | 宣传部干事 | 0.7166 | **88** | 2/3 | 67 | 79 |
| 王小明 | 前端开发干事 | 0.6908 | **80** | 1/4 | 25 | 58 |
| 赵小红 | 活动策划干事 | 0.6934 | **80** | 3/3 | 100 | 88 |
| 王小明 | 活动策划干事 | 0.6209 | 55 | 0/3 | 0 | 33 |
| 钱多多 | 前端开发干事 | 0.6002 | 48 | 0/4 | 0 | 29 |
| 孙小美 | 活动策划干事 | 0.5814 | 42 | 0/3 | 0 | 25 |
| 孙小美 | 前端开发干事 | 0.5780 | 41 | 0/4 | 0 | 25 |
| 赵小红 | 宣传部干事 | 0.5739 | 39 | 0/3 | 0 | 23 |
| 赵小红 | 前端开发干事 | 0.5468 | 30 | 0/4 | 0 | 18 |
| 钱多多 | 活动策划干事 | 0.5459 | 30 | 0/3 | 0 | 18 |
| 王小明 | 宣传部干事 | 0.5263 | 23 | 0/3 | 0 | 14 |
| 钱多多 | 宣传部干事 | 0.4848 | **9** | 0/3 | 0 | 5 |

**分布诊断**：校准分 9 ~ 88，跨度 79 —— 区分度正常。

**注意两个反直觉的结果**：

- **赵小红 × 活动策划**（标签 3/3 全中）：校准分 80，但综合分 **88**——标签把它顶上去了
- **王小明 × 活动策划**（标签 0/3 全不中）：校准分却有 **55**——因为他的正文"看起来像一份学生简历"，语义上并非毫无关系

第二条正是"不能全用语义"的原因（见第 6 章）。

### 5.4 我踩的坑：上限设成 0.82

**第一次的设定**：`CALIB_MIN = 0.48, CALIB_MAX = 0.82`

看起来合理（留点余量），但实测**最高只到 0.7479**——`0.82` 这个上限**永远达不到**。

后果：

```
0.7479（最强相关） → (0.7479 - 0.48) / (0.82 - 0.48) = 0.79 → 79 分
0.4848（无关）     → (0.4848 - 0.48) / 0.34        = 0.01 →  1 分
```

表面上还能用，但**所有"好匹配"都被压到 50~79**，没有一个能上 80。用户看到"我明明很合适，怎么才 70 多分"。

改成 `[0.46, 0.75]` 后，同一批数据变成 8 ~ 99，区分度正常了。

> **教训：校准参数必须由实测分布决定，不能凭感觉留"安全余量"。**
> 这类错误**不会报错**，只会让结果"看起来还行但就是不对"——最难发现的一类 bug。

### 5.5 为什么换模型必须重新标定

不同模型的余弦分布**完全不同**：

| 模型 | 无关基线 | 强相关上限 |
|---|---|---|
| bge-small-zh-v1.5 | ≈ 0.48 | ≈ 0.75 |
| 另一个模型 | 可能 0.3 | 可能 0.95 |

用旧的 `[0.46, 0.75]` 去标定新模型，结果会全挤在 0 或全挤在 100。

所以参数做成了环境变量，并在 `getStatus()` 里返回，方便排查：

```js
calibration: { min: Number(process.env.ML_CALIB_MIN || 0.46), max: ... }
```

> **实务建议**：换模型时跑一遍 `npm run ml:verify`，看输出分布的 max/min，重新设这两个值。

### 5.6 校准不是"美化数字"，是必要工序

有人会说"这是不是在调分数让它好看"。

**不是。** 校准做的是**单调线性变换**，它：

- **不改变排序**（`a > b` 变换后仍然 `a > b`）
- 只改变**可读性**和**阈值语义**

为什么必须做：因为下游有**阈值判断**。

```js
if (m.score >= minScore) { 推荐这个岗位 }     // 默认 minScore=50
```

如果直接乘 100，无关文本也有 50 分 → **全部都过阈值** → "推荐"变成"全列出来"，功能等于失效。

校准后，无关 = 8 分，被阈值正确拦掉。

> **知识点：绝对分数只有在分布被标定之后才有语义。**
> 排序可以只看相对大小，但**设阈值必须知道绝对尺度的含义**。

---

<a id="ch6"></a>
## 第 6 章 混合打分与排序

### 6.1 公式

```js
const score =
  requiredSkills.length > 0
    ? Math.round(semantic * 0.6 + tagScore * 100 * 0.4)   // 有技能要求：混合
    : semantic;                                            // 无技能要求：纯语义
```

其中：
- `semantic` = 校准后的语义分（0~100）
- `tagScore` = 命中技能数 / 期望技能数（0~1）

### 6.2 为什么不全用语义（三个理由）

**① 可解释性**

招新场景必须能回答"为什么推荐他"。

| 信号 | 能说什么 |
|---|---|
| 语义分 | "语义上比较接近"（说不清具体原因） |
| 技能命中 | "命中 vue，缺 html/css"（具体、可核对） |

真实的解释性来自标签路径。所以 `hitSkills` / `missingSkills` 始终随结果返回，界面上也拆开显示。

**② 域内相似性污染**

所有简历都是"学生写的简历"，天生高度相似。纯语义分会让**所有候选人看起来都差不多**（都是 55~75）。标签命中率提供了**正交的、离散的**信号，能把人拉开。

**③ 人工标签的精度最高**

学生亲自填的技能，比模型从正文猜的要准。**人工确认过的信号不该被模型淹没**。

### 6.3 权重的选择

`0.6 / 0.4` 是经验值。

**为什么语义略高**：因为标签经常填不全（学生只填两三个），语义能补上标签没覆盖的信息。

**理想做法**：用数据调权重。但本项目标注样本 = 0，无法调参，所以取了一个保守的中间值，并做成环境变量：

```js
const W_SEMANTIC = Number(process.env.ML_W_SEMANTIC || 0.6);
const W_TAG      = Number(process.env.ML_W_TAG || 0.4);
```

> **知识点：没有数据时的参数选择原则——取保守中间值 + 可配置 + 明确记录未调优。**
> 不要把"拍脑袋的值"说成"调优后的值"。

### 6.4 排序与 tie-breaker

```js
.sort((a, b) =>
  b.score - a.score ||                                           // ① 主键：综合分
  (b.status === 'open') - (a.status === 'open') ||                // ② 招新中的优先
  a.filledCount / Math.max(1, a.headcount)                        // ③ 招满率低的优先
       - b.filledCount / Math.max(1, b.headcount)
)
```

**为什么需要 tie-breaker**：分数是整数，大量并列（比如两个岗位都是 25 分）。没有稳定的次级排序，结果会随数据库返回顺序漂移，用户看到"每次刷新顺序都不一样"。

**知识点：稳定排序与全序**
> 排序函数必须是**全序**（任意两个元素都能比出先后），否则结果不确定。
> `Math.max(1, headcount)` 是防除零——`headcount` 可能是 0（未设名额）。

---

<a id="ch7"></a>
## 第 7 章 技能自动抽取（双路径）

### 7.1 要解决的问题

`resume.skills` 完全靠人填。现实中：
- 学生只填两三个（懒/不会填）
- 或者干脆不填

而**所有匹配都建立在这些标签上**。标签稀薄 → 匹配失真。

### 7.2 受控词表的作用

```js
export const SKILL_VOCAB = [
  'JavaScript', 'TypeScript', 'Vue', 'React', 'HTML', 'CSS', ...
  'Photoshop', 'Illustrator', 'Figma', '海报设计', 'UI设计', '排版', '配色', ...
  '文案写作', '公众号运营', '新媒体运营', '活动策划', '活动组织', ...
  '机器学习', 'PyTorch', '数据分析', '数学建模', 'ACM', ...
  // 实测共 92 项（`node -e "import('./src/ml/skillExtractor.js').then(m=>console.log(m.SKILL_VOCAB.length))"`）
];
```

**这不是模型，是"统一命名口径"**。

没有词表的问题：

```
学生A写：JS        学生B写：javascript    学生C写：JavaScript
→ 库里三份不同的值，无法统计、无法匹配
```

有了词表：不管学生怎么写，抽出来都归一到 `JavaScript`。

> **知识点：受控词表（controlled vocabulary）是把非结构化文本变成结构化数据的第一道工序。**
> 它同时也是抽取的**上限**——词表里没有的技能，抽取不出来。

### 7.3 路径一：词典精确匹配（precision 优先）

```js
export function extractExact(text) {
  const src = String(text || '').toLowerCase();
  for (const { term, lower } of VOCAB_LOWER) {
    if (src.includes(lower)) hits.push({ term, source: 'exact', score: 1 });
  }
}
```

**特点**：
- **精确率极高**（出现了就是出现了，不会错）
- **召回率低**（换个说法就漏：写"公众号推文"抓不到"文案写作"）
- **极快**（纯字符串查找）

### 7.4 路径二：语义近邻（recall 优先）

```js
const vocab = await getVocabVectors();                    // 100 个词编码一次
const textVec = await embedOwner('resume_text', `${id}:fulltext`, text);

const scored = vocab
  .map(v => ({ term: v.term, score: cosine(textVec, v.vector) }))
  .filter(x => x.score >= SEMANTIC_THRESHOLD)              // 默认 0.62
  .sort((a, b) => b.score - a.score)
  .slice(0, SEMANTIC_TOP_K);                               // 默认前 6 个
```

**特点**：
- **召回率高**（同义表述能抓到）
- **精确率低**（可能误标）
- **需要一次模型编码**（但词表向量只需编码一次，之后走缓存）

**阈值 0.62 怎么来的**：从实测分布取的一个保守值——高于无关基线（0.48）较多，避免误标。宁可漏，不可错。

### 7.5 合并策略

```js
// exact 优先；语义路径只补 exact 没覆盖到的
const byTerm = new Map();
for (const h of exact) byTerm.set(h.term.toLowerCase(), h);
for (const h of semantic) {
  if (!byTerm.has(h.term.toLowerCase())) byTerm.set(h.term.toLowerCase(), h);
}
```

**为什么 exact 优先**：如果同一个词两条路径都命中，保留 `source='exact'`（更可信）。

### 7.6 为什么不覆盖人工标签

```js
db.prepare('UPDATE resume SET skills_auto = ?, ...').run(...);
//                  ↑ 只写 skills_auto
// 人工的 resume.skills 完全不动
```

**理由**：
1. 人工标签是**学生自己声明的**，有主观意图（他可能故意不写不擅长的）
2. 模型抽取会出错，覆盖了就**不可恢复**
3. 两者并存才能**对比、校正**

界面上也并排展示：人工（暖色）/ 自动（实心=词表命中，空心=语义推断）。

### 7.7 知识点：precision 与 recall 的权衡

```
                实际相关
              是        否
         ┌─────────┬─────────┐
  预测 是 │  TP ✅  │  FP ❌  │  ← FP 多 = 精确率低（误报）
         ├─────────┼─────────┤
      否 │  FN ❌  │  TN ✅  │  ← FN 多 = 召回率低（漏报）
         └─────────┴─────────┘

精确率 Precision = TP / (TP + FP)     "标出来的有多少是对的"
召回率 Recall    = TP / (TP + FN)     "该标的标出了多少"
```

**本项目为什么偏向精确率**：

> 在招新筛选场景，**误标比漏标更糟**。
> 漏标 → 少一个参考维度，问题不大（还有人工标签）
> 误标 → 筛选依据失真，可能把不合适的人推上去

所以：exact 高精度兜底 + semantic 保守阈值补充 + 来源可辨 + **界面提示"语义标签可能有误，请人工核对"**。

### 7.8 实测案例

```
人工标签：文案,活动组织,沟通
自动抽取：活动组织、活动策划、文案写作
          ↑exact      ↑semantic   ↑semantic（「文案」→「文案写作」）

人工标签：设计,海报,审美
自动抽取：海报设计、排版、UI设计、UX设计
          ↑exact          ↑semantic ×3

人工标签：Vue,Node.js,项目协作
自动抽取：Vue、Node.js
          ↑exact ×2（「项目协作」不在词表里，两条路径都没抽到）
```

**三个观察**：
1. 语义路径确实做了泛化（`文案` → `文案写作`，`设计/海报` → `排版/UI/UX`）
2. 词表外的东西抽不到（`项目协作`）——这是词表决定的上限
3. **自动抽取不一定比人工全**——所以绝不能覆盖人工标签

---

<a id="ch8"></a>
## 第 8 章 无监督聚类

### 8.1 为什么必须用无监督

**核心约束：标注样本 = 0。**

监督学习需要 `(输入, 正确标签)` 对。本系统里：
- 谁该被分到哪一组？**没有这个标签**
- 而且这类"分组"本身就没有唯一答案

**无监督的价值**：不需要知道"正确答案"，只在数据里找**结构**。

> 这不是"退而求其次"，而是**问题本身的性质**：
> "这 40 个人大致能分成几类" 是一个**探索性**问题，本来就没有标准答案。

### 8.2 K-means 三步循环

```
① 选中心：初始化 k 个中心点
② 分配  ：每个点归到最近的中心 → 形成 k 个簇
③ 更新  ：每个簇的中心移到簇内所有点的平均位置
   ↑
   重复 ②③ 直到中心不再移动（或达到最大迭代 100 次）
```

**为什么能收敛**：每一轮 ②③ 都会让"簇内平方和"（inertia）单调不增。它是个有下界的量，所以一定会稳定下来。

### 8.3 知识点：这里为什么用欧氏距离而不是余弦

**看似矛盾**：匹配用余弦，聚类用欧氏距离。

```js
function euclideanSq(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) { const d = a[i] - b[i]; s += d * d; }
  return s;
}
```

**为什么这样是对的**：

向量**已经归一化**（长度都是 1）。对单位向量：

```
‖A - B‖² = ‖A‖² + ‖B‖² - 2(A·B) = 1 + 1 - 2cos = 2 - 2cos
```

所以 **`‖A-B‖²` 与 `cos` 是严格单调反比关系**——距离越小，余弦越大。

**结论**：在归一化向量上，欧氏距离和余弦**给出完全相同的排序和分组**。

那为什么还用欧氏？
- K-means 的"中心点求平均"在欧氏空间里才有明确意义（质心）
- 用余弦的话，"平均方向"要重新归一化，且 K-means 的目标函数（inertia）就不再是凸的
- **K-means 的标准形式就是基于欧氏距离的**

> **知识点**：混合使用不同度量不是错，关键是**理解它们在这种数据上是否等价**。
> 这里能等价的前提是"向量已归一化"——这个前提一旦被破坏，结论就不成立。

（顺带说明：`clustering.js` 里对质心求平均后**没有再归一化**，所以质心长度 < 1。此时 `2 - 2cos` 的等价性对"点到质心"不完全严格成立。这是 K-means 的常规做法——目标是最小化簇内平方误差，质心就该是算术平均，不需要归一化。两种做法在实践中差别很小，但严格说这是两个不同的目标函数。）

### 8.4 知识点：K-means++ 初始化

**纯随机初始化的风险**：如果两个初始中心恰好落得很近，最后会有一个簇**永远是空的**（退化）。

**K-means++ 的做法**：

```
① 第一个中心：随机选一个点
② 之后每个中心：按「到已有中心的距离平方」加权随机抽取
   —— 距离越远，越容易被选中
```

效果：初始中心天然分散，几乎不会出现空簇。

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
    // 按距离平方的概率抽取
    let r = rnd() * total, idx = 0;
    for (let i = 0; i < dists.length; i += 1) { r -= dists[i]; if (r <= 0) { idx = i; break; } }
    centers.push(vectors[idx]);
  }
  return centers;
}
```

### 8.5 知识点：可复现性 —— 固定随机种子

```js
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = mulberry32(seed);    // seed = 42
```

**为什么必须固定种子**：

K-means 是**随机算法**（初始中心随机）。不固定种子的话：
- 同一批数据，每次刷新分组都不一样
- 用户会看到"人怎么在组之间乱跳"
- 测试无法断言结果

**知识点：确定性（determinism）**
> 生产系统里，随机性要么被消除，要么被显式记录种子。
> 否则"同样的输入不同输出"会让所有排查和测试失效。

### 8.6 知识点：轮廓系数（silhouette）怎么读

对每个点 i：

```
a(i) = i 到「同簇其它点」的平均距离      ← 内聚度，越小越好
b(i) = i 到「最近的其他簇」的平均距离    ← 分离度，越大越好

s(i) = (b - a) / max(a, b)              ← -1 ~ 1
```

全局取平均。

**读数表**：

| s 值 | 含义 |
|---|---|
| 0.71 ~ 1.00 | 结构很强 |
| 0.51 ~ 0.70 | 结构合理 |
| 0.26 ~ 0.50 | 结构较弱 |
| **< 0.25** | **基本没有结构**（这批人本身同质） |
| < 0 | 分错了（点更接近别的簇） |

**本项目的界面直接把这个含义翻译成人话**：

```js
if (s >= 0.5) return '分组清晰';
if (s >= 0.25) return '勉强可分';
if (s >= 0) return '较同质';
return '基本分不开';
```

**关键认知**：

> **轮廓系数低不是 bug，是结论。**
> "这批候选人分不出明显类别" 本身也是有价值的信息——说明招新岗位要求太泛，或者投递者高度同质。

### 8.7 自动选 k

```js
const maxK = Math.max(2, Math.min(4, Math.floor(rows.length / 2)));
const candidates = autoK
  ? Array.from({ length: Math.max(1, maxK - 1) }, (_, i) => i + 2)   // 2..maxK
  : [Math.min(k || 3, maxK)];

for (const kk of candidates) {
  const res = kmeans(vectors, kk, { seed: 42 });
  const score = silhouette(vectors, res.assign, res.centers);
  if (!best || score > best.score) best = { k: kk, ...res, score };
}
```

**为什么上限是 4 而不是更多**：社团招新的分组是给人看的，超过 4~5 组就失去"快速筛选"的意义。

### 8.8 知识点：小样本下 K-means 会"假好"

**这是我在实现时实际遇到并修掉的 bug。**

**现象**：`k` 接近 `n` 时，几乎每个点自成一簇：

```
n = 4, k = 6（或 k = n-1）
→ 大部分簇只有 1 个点
→ 单点的 a(i) 无定义（簇里没有别的点）→ 被跳过
→ 剩下能算的点，因为其他簇都很远，b(i) 很大
→ 轮廓系数飙升到 1.0
```

**`silhouette = 1.0` 在这里是假象**：它不是"分得完美"，而是"根本没在分"。

**实测对比**：

| 版本 | 结果 |
|---|---|
| 保护前 | `k=6, silhouette=1` ← 假的 |
| 加 `n<6` 保护后 | 直接返回"人数太少，聚类没有统计意义" |
| 加 `k ≤ n/2` 后（n=4） | `k=2, silhouette=0.2227` ← 合理 |

**保护代码**：

```js
const MIN_N = 6;
if (rows.length < MIN_N) {
  return { clubId, available: true, clusters: [], k: 0,
    reason: `候选人数 ${rows.length}（<${MIN_N}）太少，聚类没有统计意义；建议直接人工筛选` };
}
const maxK = Math.max(2, Math.min(4, Math.floor(rows.length / 2)));
```

> **知识点：算法在小样本上会退化成"教科书没写的形态"。**
> 论文里的 K-means 假设 n 足够大、k << n。
> 工程实现必须显式处理边界，否则它会给你一个**看起来很好、实则无意义**的数字。
>
> 这是"跑通了"和"结论可信"之间的差别。

### 8.9 簇画像

```js
function profileSkills(members, topN = 5) {
  const counter = new Map();
  for (const m of members) {
    for (const s of String(m.skills || '').split(/[,，、;；]/).map(x => x.trim()).filter(Boolean)) {
      counter.set(s, (counter.get(s) || 0) + 1);
    }
  }
  return [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)
    .map(([skill, count]) => ({ skill, count }));
}
```

**为什么需要画像**：

聚类只给出"谁和谁一组"，但不解释"为什么这一组在一起"。簇画像（该组高频出现的技能）就是**给簇命名**的依据。

界面上的呈现：

```
第 2 组（3 人）
共同特征：Vue ×2  设计 ×2  海报 ×1
```

**知识点：无监督结果必须"可解释化"才能用。**
> 纯编号的簇（簇 0 / 簇 1）对使用者毫无意义。
> 用高频特征给它贴标签，人才能判断"这是设计型候选人"还是"技术型候选人"。

---

<a id="ch9"></a>
## 第 9 章 降级与可观测性

### 9.1 fail-open：模型挂了系统照样能用

```js
if (!ML_ENABLED || !isReady()) {
  return ruleBasedResult();      // 退回字符串匹配
}
```

**判断标准**：这个能力失败时，"继续"和"停止"哪个后果更严重？

| 模块 | 失败时应该 | 为什么 |
|---|---|---|
| **匹配** | **继续**（降级到规则） | 它只是建议，不参与写操作。分数不准 ≠ 系统不可用 |
| 鉴权 | **停止**（拒绝请求） | 放行 = 开门，后果不可接受 |

这个区分在安全设计里叫 **fail-open / fail-closed**。

### 9.2 预热不阻塞启动

```js
// index.js
warmupML();              // 不 await
clubApp.listen(clubPort); // 立刻监听
```

**为什么不阻塞**：模型首次要下载 23MB。在中国网络下可能几十秒。

如果 `await`：
- 端口晚几十秒才通
- Docker 健康检查失败 → 容器被反复重启
- 云平台探活判死

**代价**：需要一个"还没准备好"的中间状态。这个状态通过 `isReady()` 暴露给调用方，各自降级。

### 9.3 动态 import 隔离依赖

```js
const { env, pipeline } = await import('@xenova/transformers');
```

**为什么用动态 import**：
- 如果依赖缺失（比如精简部署没装），静态 import 会让**整个服务启动失败**
- 动态 import 只在需要时加载，抛错被 catch，服务照常起

**知识点：可选依赖要用动态导入 + 兜底。**
> 静态 import 的失败是**致命**的；动态 import 的失败是**可捕获**的。

### 9.4 状态可观测

```js
export function getStatus() {
  return { enabled, ready, model, dim, remoteHost, cacheDir, error, memoryCacheSize };
}
```

前端侧边栏有徽标：

- 🟢 语义匹配已启用
- 🟡 规则模式（模型未就绪）  
- ⚪ ML 已关闭

点击能看到 `error` 字段——**模型下载失败的具体原因**。

> **知识点：降级必须是"可见"的降级。**
> 静默降级最可怕：用户以为在用语义匹配，实际在用字符串匹配，而分数看起来"差不多"，没人发现。

---

<a id="ch10"></a>
## 第 10 章 边界：这套 ML 做不到什么

### 10.1 能做 / 不能做

| 能力 | 状态 | 原因 |
|---|---|---|
| 语义相似度 | ✅ 已实现 | 预训练模型自带语言理解，无需标注 |
| 技能抽取 | ✅ 已实现 | 词表 + 相似度 |
| 候选人分组 | ✅ 已实现 | 无监督 |
| **录取概率预测** | ❌ **做不了** | 标注样本 = 0；做了就是造假 |
| **学习排序（LTR）** | ❌ **做不了** | 同上，且标签受名额约束影响，不是真实偏好 |
| **模型微调** | ❌ 不该做 | 4 份简历上微调 = 记住这 4 个人 |

### 10.2 为什么不能做 LTR（三个硬障碍）

**① 样本量**

一个社团一季几十份投递，有明确结论的可能 10~30 条。而 LTR 通常要 10³ 以上。

**② 标签不是"真实偏好"**

岗位只要 2 人，第 3 名优秀的候选人也会被标"淘汰"。

```
y = reject  不代表"不合适"
            可能代表"排第 3"
```

用它训二分类模型，学到的是"谁排进了前 N"，**不是"谁优秀"**——跟业务目标不对齐。正确处理要用 **listwise LTR**（对同一岗位的人整体排序），工程量远超本项目。

**③ 选择偏差**

只有"被看到并被决策"的候选人产生标签。简历筛选粗糙的那部分就是噪声。

> **这三个障碍在 `ML_PERSPECTIVE.md` 里有更详细的论述。**

### 10.3 分数不是概率

```
88 分  ≠  88% 会被录取
88 分  =  简历文本与岗位要求在语义上相似度较高
```

这是**相似度**，不是**概率**。概率需要历史数据校准（`P(录取 | 特征)`），本项目没有数据。

界面上要避免暗示概率——所以文案写"综合匹配度"而不是"录取可能性"。

### 10.4 短文本效果明显弱于长文本

实测：

| 输入 | 余弦 | 校准后 |
|---|---|---|
| 「前端开发」~「Vue3 页面实现与组件封装」 | 0.5134 | 18 |
| 「海报设计」~「视觉传达、排版与配色」 | 0.5752 | 40 |
| 「活动策划」~「组织线下活动，协调场地与人员」 | 0.6058 | 50 |
| 「文案写作」~「公众号推文撰写」 | 0.6509 | 66 |

**为什么短文本差**：模型靠上下文判断语义。只有两个词时，上下文太少，向量接近"通用语义"而非"具体所指"。

**本项目的应对**：文本组装时把字段拼成较长的段落（第 2 章），而不是只喂几个词。

### 10.5 词表决定抽取上限

技能抽取只能抽出**词表里有的**。`项目协作` 这个词不在 `SKILL_VOCAB` 里 → 两条路径都抽不到（实测确认）。

**改进方向**：词表可运营（从实际投递里统计高频词，定期补进去）。但要注意：**词表越大，命名口径越难统一**。

### 10.6 各向异性导致绝对分不跨场景可比

`[0.46, 0.75]` 这组参数是**在这份数据、这个模型**上标定的。

换数据（比如换成技术岗为主 vs 文艺岗为主），分布会变，参数就该重标。

> **所以 `calibration` 参数通过接口暴露出来**，方便发现问题。

---

<a id="ch11"></a>
## 第 11 章 三条请求的完整走查

### 11.1 `GET /api/v1/resumes/:id/match-top`（缓存未命中 → 命中）

```
① 前端 MatchView 选中一份简历 → 请求
② 认证：Basic Auth → X-Club-Token → requireOwnClubVia('resume')
③ matchService.recommendPositionsForResume(resumeId, {...})   ← 分发层
④ semanticMatchService:
     ├─ SELECT * FROM resume WHERE id = ?            → 简历
     ├─ loadPositions(clubId)                        → 岗位列表
     ├─ ML 就绪？
     │    ├─ 否 → scorePairRuleOnly() 逐对算 → 返回 method='tags-only'
     │    └─ 是 ↓
     ├─ 组装文本
     │    buildResumeText(resume)        → "姓名：…\n专业：…\n技能标签：…\n简历正文：…"
     │    buildPositionText(pos) for each → "岗位名称：…\n期望技能：…\n岗位要求：…"
     ├─ embedOwners([简历, ...岗位])
     │    ├─ sha1(text) 逐个算哈希
     │    ├─ 内存缓存命中？ → 直接用
     │    ├─ embedding_cache 命中且 hash 一致？ → 用 + 回填内存
     │    └─ 剩余批量 embedTexts() → 写两级缓存
     ├─ scorePair(简历向量, 岗位向量, 简历skills, 岗位required_skills)
     │    ├─ cosine() → 原始余弦（本例 0.6908）
     │    ├─ calibrate() → 语义分（80）
     │    ├─ tagScore = 1/4 → 25
     │    └─ score = round(80×0.6 + 25×0.4) = round(48 + 10) = 58
     ├─ 排序 + minScore 过滤 + limit
     └─ 返回 { resume, recommendations, total, method:'semantic+tags' }
⑤ 路由 asyncHandler 包裹 → 异常也能进错误中间件
⑥ ok(res, data) → { code:0, data }
⑦ 前端渲染：圆环显示 58，下方拆解"● 语义 80  ● 技能 25（1/4 命中）"
```

**第二次请求同样的简历**：④ 里所有 `sha1` 都命中缓存 → 耗时 0~1ms。

### 11.2 `POST /api/v1/ml/resumes/:id/auto-skills`

```
① 前端抽屉点"自动抽取技能"
② 认证 → requireOwnClubVia('resume', 'id')
③ skillExtractor.extractResumeSkills(resumeId, { persist: true })
     ├─ SELECT * FROM resume
     ├─ text = [skills, content].join('\n')
     ├─ extractExact(text)                    ← 纯字符串，无需模型
     │    → [{term:'文案', source:'exact', score:1}, ...]
     ├─ isReady()？ 否 → 跳过语义路径
     │    是 → extractSemantic(resumeId, text)
     │           ├─ getVocabVectors()         ← 100 个词编码一次，之后全局复用
     │           ├─ embedOwner('resume_text', `${id}:fulltext`, text)
     │           └─ 每个词算余弦 → 过滤 ≥0.62 → 排序 → 取前 6
     ├─ 合并：exact 优先，semantic 补缺
     ├─ UPDATE resume SET skills_auto = ?, updated_at = ?
     └─ 返回 { skills, details, humanSkills, method }
④ 前端展示：人工标签（暖色）/ 自动标签（实心=exact，空心=semantic）
```

### 11.3 `GET /api/v1/ml/clubs/:clubId/clusters`

```
① 前端候选人分组页
② 认证 → requireOwnClub('clubId')
③ clustering.clusterCandidates(clubId, { k, autoK })
     ├─ SELECT 该社团所有投递（含 resume 文本）
     ├─ isReady()？ 否 → { available:false, reason:'嵌入模型未就绪' }
     ├─ rows.length < 6？ 是 → { clusters:[], reason:'人数太少…' }   ← 小样本保护
     ├─ embedOwners(所有简历)                    ← 走缓存
     ├─ maxK = min(4, floor(n/2))
     ├─ for k in 2..maxK:
     │     res = kmeans(vectors, k, {seed:42})
     │          ├─ kmeansPlusPlus() 初始化
     │          └─ 循环「分配 → 更新中心」直到收敛（≤100 轮）
     │     score = silhouette(vectors, res.assign, res.centers)
     │     保留 score 最大的
     ├─ 按 assign 分组 → 每组算 profileSkills（高频技能）
     ├─ 算质心两两余弦（看类别分得开不开）
     └─ 返回 { k, silhouette, inertia, centroidSimilarity, clusters }
④ 前端渲染：每组一张卡（共同特征 + 成员）+ 顶部轮廓系数带解读
```

---

<a id="appendix"></a>
## 附录

### A. 全部可调参数（环境变量）

| 变量 | 默认值 | 作用 | 什么时候要改 |
|---|---|---|---|
| `ML_ENABLED` | `1` | 设为 `0` 完全关闭 ML，纯规则模式 | 排查问题 / 极简部署 |
| `HF_MIRROR` | `https://hf-mirror.com` | 模型下载源 | 换镜像 |
| `MODEL_CACHE_DIR` | `server/data/models` | 模型缓存目录 | 自定义存储位置 |
| `ML_CALIB_MIN` | `0.46` | 校准下界 | **换模型必须重标** |
| `ML_CALIB_MAX` | `0.75` | 校准上界 | **换模型必须重标** |
| `ML_W_SEMANTIC` | `0.6` | 语义分权重 | 有数据后可调优 |
| `ML_W_TAG` | `0.4` | 标签分权重 | 同上 |
| `ML_SKILL_THRESHOLD` | `0.62` | 技能语义抽取阈值 | 误标多 → 提高；漏标多 → 降低 |
| `ML_SKILL_TOP_K` | `6` | 语义抽取最多补几个 | 想抽更全 → 提高 |

### B. 常量（代码内，改需重新验证）

| 常量 | 值 | 位置 |
|---|---|---|
| `MODEL_NAME` | `Xenova/bge-small-zh-v1.5` | `embeddingService.js` |
| `EMBEDDING_DIM` | `512` | 同上 |
| `MEM_CACHE_MAX` | `500` | 同上 |
| `MIN_N`（聚类最小样本） | `6` | `clustering.js` |
| 聚类 `maxK` | `min(4, floor(n/2))` | 同上 |
| K-means 最大迭代 | `100` | 同上 |
| K-means 随机种子 | `42` | 同上 |
| 正文字段截断 | `1200` 字 | `semanticMatchService.js` |

### C. 文件地图

| 想知道什么 | 看哪个文件 |
|---|---|
| 模型加载 / 缓存 / 相似度 | `server/src/ml/embeddingService.js` |
| 文本组装 / 校准 / 混合打分 / 排序 | `server/src/ml/semanticMatchService.js` |
| 词表 / 精确匹配 / 语义抽取 | `server/src/ml/skillExtractor.js` |
| K-means / 轮廓系数 / 簇画像 | `server/src/ml/clustering.js` |
| 纯规则工具（降级用） | `server/src/ml/skillTags.js` |
| 分发层（规则 or 语义） | `server/src/services/matchService.js` |
| HTTP 接口 | `server/src/routes/mlRoutes.js` |
| 向量缓存表 | `server/db/migrations/005-ml-embeddings.sql` |

### D. 复现与验证命令

```bash
cd server

# ① 离线全量验证：schema、模型、规则vs语义逐对对比、语义泛化、缓存效果
node scripts/verify-ml.mjs

# ② 接口层验证：登录、/ml/status、聚类、技能抽取
node scripts/verify-ml-http.mjs

# ③ 模型能力冒烟（相似度矩阵 + 性能）
node scripts/probe-embedding.mjs

# ④ 历史对照：三种相似度（精确 / IDF / 余弦）在真实数据上的差异
node scripts/analyze-matching.mjs

# ⑤ 端到端回归（166 项，含 ML 章节）
npm run smoke
```

### E. 一页速记

> **嵌入** = 把文字变成向量，让语义近的向量方向也近。
> **量化** = int8 压缩模型，90MB → 23MB，精度损失可忽略。
> **CLS 池化** = 取 `[CLS]` 位置的输出当整句代表（必须与模型训练方式匹配）。
> **余弦** = 看夹角不看长度，归一化后退化为点积。
> **校准** = 把实测分布映射到 0~100，因为语言模型有 0.5 的高基线。
> **混合** = 语义 60% + 标签 40%，因为标签可解释、精度高。
> **双路径抽取** = 词典保精确率，语义保召回率，来源可辨。
> **K-means++** = 按距离平方概率选初始中心，避免空簇。
> **轮廓系数** = 内聚与分离的综合，< 0.25 说明"这批人分不出类别"。
> **小样本保护** = n<6 不聚类，k ≤ n/2，否则 silhouette 会假高到 1.0。
> **fail-open** = 匹配挂了降级到规则；鉴权挂了必须拒绝。
>
> **最重要的一句**：这是**预训练模型的推理**，不是"在你的数据上训练"。
> 对外不能说"训练了一个匹配模型"。
