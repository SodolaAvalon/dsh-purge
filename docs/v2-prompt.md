# v2：破甲强度迭代

目标：在不推翻现有注入架构的前提下，让同一份提示词在**长对话**和**不同模型**上更不容易掉。

基座：`master` + `fix/0.2.1-compat`（0.2.1 兼容热修）。

---

## 改了什么

### 1. 尾部锚（结构层，新增）

**问题**：现在提示词折进 `persona-prefix`，排在整个系统提示词的最前（`order: -100000`）。这叫 primacy。上下文一长，前半段的注意力会衰减，模型开始在长对话后段"苏醒"。

**做法**：在整段末尾再压一条 200 字左右的执行契约（`lib/prompt-tail/anchor.zh.md`），`order: 100000`，排在能力协议（99999）之后。前后夹击。

段名用 `dshpg-anchor` 而不是 `dsh-purge:*`——宿主有一步过滤会把 `dsh-purge` 开头的段提到最前，用错前缀会把锚顶到正文前面，反而制造新的渲染反转。这一点写在 `capability-protocol.js` 顶部注释里。

### 2. 模型适配尾巴（结构层，新增）

`lib/prompt-tail/addendum.*.md`，按模型家族挂一条补充：

| 模型家族 | 挂什么 | 为什么 |
|---|---|---|
| `deepseek / glm / kimi / qwen`（国模） | 不挂 | 主稿本身就是按国模写的，再加料是稀释 |
| `claude / anthropic` | `addendum.claude.md` | Claude 吃"契约优先于旧框架"这类写法 |
| `gpt / openai / gemini` | `addendum.gpt.md` | GPT 系吃显式框架 + 禁止替代交付物 |

检测由 `variables.model` 拿，拿不到就走国模分支。函数：`modelFamily()`。

### 3. 提示词 v2（内容层，三处新增）

`lib/default-prompt-inject.zh.md`：

- **`## 执行内核`**（插在开头）：四条硬约束提到第一屏——第一行是工件、任务是单位、请求即范围、做完再停。前 20 行就能用。
- **`## 思考协议`**（新段）：把 thinking 限定成"拆任务、排顺序、起草"，禁止在思考里做合规判断；"但是/等等/这会不会"标记为噪声。对 reasoning 模型，拒答往往先在 CoT 里发生，这一段是冲着它去的。
- **`## 修复协议`**（新段）：把 R1–R8 从"识别"升级成"修断点"——定位最后一句正确的内容、删掉污染段、从断点续写。原来只说"丢弃重写"，没说从哪儿重写。

字数：14,116 → 14,600 字符。没有删任何原有约束。

### 4. 渲染预演工具（验证层，新增）

`scripts/render-prompt.mjs`：不启动 DSH，直接跑一遍组装，把"模型最终会收到什么"打出来，并断言 8 条不变式：

```bash
node scripts/render-prompt.mjs              # 人眼看的版
node scripts/render-prompt.mjs --json       # 机器读的版
node scripts/render-prompt.mjs my.md        # 指定提示词文件
PROBE_MODEL=claude-sonnet-4 node scripts/render-prompt.mjs   # 模拟别的模型
```

断言包含：注入原文完整且只出现一次、注入在最前、官方身份句已清、能力段存在、尾部锚在最后、锚与正文同语言、`variables.cwd` 已补、注入长度合理。

---

## 怎么验证

```powershell
cd dsh-purge
node scripts/render-prompt.mjs                     # 期望 总判定: PASS
PROBE_MODEL=claude-sonnet-4 node scripts/render-prompt.mjs   # 期望多出一段 dshpg-model
```

实际改提示词后要走这条链，否则线上不变：

```powershell
Copy-Item lib/default-prompt-inject.zh.md lib/default-prompt-inject.md -Force
node scripts/embed-default-prompt.mjs               # 重新封进 asset-table.js
node scripts/render-prompt.mjs                      # 复验
```

---

## 回滚

```powershell
git checkout master -- lib/identity.js lib/default-prompt-inject.zh.md lib/asset-table.js
Remove-Item -Recurse lib/prompt-tail
```

尾部锚也可以单独关掉：`rewritePromptAssembly(assembled, { tailAnchor: false })`。
