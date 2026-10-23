# v3：补丁层加固（宿主升级不再静默降级）

## 问题

`lib/core.js` 的补丁是**逐字字符串替换**：锚点里每一个空格、每一个 tab、每一处换行都必须和宿主源码完全一致。
宿主一改格式化，锚点命中数就是 0。

更麻烦的是失败路径：

```text
锚点没命中 → changed:false → 记一行 pattern_not_found
           → 不抛异常
           → 重启门把 pattern_not_found 排除在阻断条件之外
           → 界面显示"应用成功"，实际少打了 N 条
```

再加上部分补丁标了 `optional` / `softSettle`，失败连痕迹都不留。**破甲强度会在无感知的情况下掉一大截。**

这也是 0.2.0 → 0.2.1 需要人工救火的根本原因。

## 改了什么

### 1. 空白容错回退（`lib/core.js`）

新增 `looseWhitespaceRegex(needle)`：把锚点里的每一段空白折成 `[ \t\r\n]+`，其余字符逐个转义。
`applyReplacementsToText` 的顺序变成：

```text
1. 逐字 split/join 命中  → 正常打补丁（行为不变）
2. 逐字没命中           → 用空白容错正则再试一次；命中即 changed=true, loose>0
3. 都不中               → 维持原样，返回 changed=false
```

**只放宽空白，不放宽内容。** 所有非空白字符仍须逐字一致，所以不会误替换到别的位置。
`loose` 计数会写进补丁报告行，能看出哪几条是靠容错打上的。

### 2. 失败不再静默

- `applyPatches` 的报告行新增 `loose` 字段。
- `summarizeApplyReport` 新增 `notFound`（没命中的补丁 id 列表）和 `loose`（容错命中总数）。
- `renderStatus` 在状态末尾单列一段：

```text
✗ 锚点没命中 / anchor miss: N 条 —— 宿主可能改过布局
    #40, #69, #90
    这些补丁没打上。要么宿主升级了，要么锚点需要修：node scripts/check-patches.mjs
```

以前这类补丁混在长列表里显示成 `·`，看起来和应用成功没区别。

### 3. 锚点回归自检（`scripts/check-patches.mjs`）

不需要宿主文件，直接验"宿主改了缩进，还认不认得"：

```bash
node scripts/check-patches.mjs          # 人看的
node scripts/check-patches.mjs --json   # 机器读的
```

做法：对 197 个字符串锚点逐个生成"缩进被改过"的假宿主文本（行首空格 ↔ tab），再走一遍匹配。

当前基线：

```text
锚点总数: 197
原样命中: 197
改缩进后仍命中: 109      ← 容错层真正救回来的
无行首缩进、跳过容错验证: 88
原样都不命中: 0
改缩进后打不上: 0
总判定: PASS
```

跳过项说明：`pattern === replace` 的是"已打过"探测项，不是真替换；`skipIfMarked` 补丁会因锚点自带 marker 提前返回。两类都不参与容错统计。

## 局限（说清楚）

- 容错只覆盖**空白**。宿主改文案、改标识符、调顺序，仍然打不上——那种情况要靠 `check-patches` 报出来，然后改锚点。
- 没有做 AST 级匹配：不能识别"逻辑等价但写法不同"的宿主代码。
- 没做宿主快照 diff：做不到"自动迁移锚点到新布局"。

## 回滚

```powershell
git checkout HEAD~1 -- lib/core.js lib/index.js
Remove-Item scripts/check-patches.mjs
```

容错是**只在逐字失配时才走**的分支，回滚它不影响已打上的补丁，重复 apply 也不会产生副作用（幂等由 marker 判断，没动）。
