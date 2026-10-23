# 这个 fork 的记录

原项目：`YuJunZhiXue/dsh-purge`（作者 叫我小杨同学）
本 fork：`SodolaAvalon/dsh-purge`
基线：**1.1.71** @ `8df4406`（2026-10-19，关仓前最后一个公开版本）

---

## 分支 `fix/0.2.1-compat` — 收回三处本机热修

2026-10-23 当天，本机已部署的插件（`~/.dsh/profiles/desktop/node_modules/dsh-purge`）被打过三个补丁修 0.2.1 的兼容问题。
这些补丁**只存在于本机**，仓库里没有。如果哪天从 GitHub 重装，这些修复会全部丢失、问题复发。
所以先把它们收回仓库。

### 1. `lib/identity.js` — cwd 变量没了

**现象**：0.2.1 的宿主不再注册 `cwd` 变量，但 persona 后缀里还在引用它 → 组装系统提示词时渲染失败。

**改法**：每次 assemble 时自己算一遍，写回 `variables.cwd`：

```js
const variables = { ...(assembled.variables || {}) };
if (!Object.hasOwn(variables, "cwd")) {
  const cwd = opts.context?.agent?.session?.header?.cwd ?? opts.context?.cwd;
  variables.cwd = typeof cwd === "string" && cwd.length > 0 ? cwd : process.cwd();
}
```

按会话现算，切换工作区、子代理会话都能拿到正确的值。

### 2. `lib/core.js` — 补丁 40 在 0.2.1 上少了一条规则

**现象**：0.2.1 的 `system-prompt` 布局变了，运行时上下文被抑制（`runtimeContextSuppressed`）时，原规则把 `contexts` 直接清空，连 `required: true` 的上下文也一起丢了。

**改法**：给补丁 40 的 `replacements` 增加一条新规则，抑制时保留 required 的那几个：

```js
contexts: runtimeContextSuppressed
  ? transformed.contexts.filter((entry) => requiredContexts.has(entry.name))
  : transformed.contexts
```

旧布局仍然走原来那条规则，两条并存。

### 3. CLI 入口修复（`desktop.js` 未改）

`repairOfficialCliAfterUnpack()` 会把官方 `dsh` 命令行入口还原回来，属于运行时动作，不需要改代码。
备份留在 `~/.dsh/dsh-purge/local-fixes/20261023-cli-backup/`。

---

## 验证

三份回归测试全部通过（源码在 `~/.dsh/dsh-purge/local-fixes/*/regression-test.mjs`）：

```text
cwd-variable  PASS  真实宿主渲染器接受 per-session cwd；工作区切换、Unicode/空格/花括号、
                    原生变量优先、回退上下文、输入不可变、用户提示词原文、未知变量校验
host-check    PASS  复现缺标记、打 0.2.1、幂等、4 种 complete/context 组合、required 保留、
                    旧宿主布局仍支持
cli-backup    PASS  连续修复 30 次、备份逐字节一致、幂等、无残留、备份失败处理
```

另：`node --check` 对 `lib/identity.js`、`lib/core.js` 均为 OK，`git diff --stat` 只有 +15 行。

---

## 回滚

```powershell
# 回到基线 1.1.71
git checkout master
# 或整个仓库回到 V1 备份
Copy-Item "$env:USERPROFILE\Downloads\dsh-purge-backup\v1-1.1.71-baseline\*" . -Recurse -Force
```

本机部署的插件如果被改坏：

```powershell
Copy-Item "$env:USERPROFILE\.dsh\dsh-purge\host-backups\*" "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-purge\" -Recurse -Force
```
