#!/usr/bin/env node
/**
 * 补丁锚点容错自检：不需要宿主文件，直接验"宿主改了缩进，锚点还认不认得"。
 *
 *   node scripts/check-patches.mjs
 *   node scripts/check-patches.mjs --json
 *
 * 做法：拿每条补丁的每个字符串锚点，生成一份"缩进被改过"的假宿主文本
 *      （行首空格 → tab，行首 tab → 4 空格），再丢给 applyReplacementsToText。
 * 判定：
 *   字面命中  —— 原样就能打上
 *   容错命中  —— 只有放宽空白才打上（loose > 0），这正是要保住的那批
 *   打不上    —— 两种都不行，需要人工看锚点
 */
import { ALL_PATCHES, applyReplacementsToText } from "../lib/core.js";

const asJson = process.argv.includes("--json");

/** 把行首缩进换一种写法，模拟宿主升级时格式化变了。 */
function shiftIndent(text) {
  return String(text)
    .split("\n")
    .map((line) => {
      const m = line.match(/^([ \t]+)/);
      if (!m) return line;
      const indent = m[1];
      const rest = line.slice(indent.length);
      if (indent.includes("\t")) return "    ".repeat(Math.max(1, indent.split("\t").length - 1)) + rest;
      const levels = Math.max(1, Math.round(indent.length / 2));
      return "\t".repeat(levels) + rest;
    })
    .join("\n");
}

const results = [];
let literal = 0;
let looseOnly = 0;
let noIndent = 0;
const missed = [];
const literalMiss = [];

for (const patch of ALL_PATCHES) {
  const reps = Array.isArray(patch.replacements) ? patch.replacements : [];
  let index = 0;
  for (const rep of reps) {
    index += 1;
    if (!rep || typeof rep.pattern !== "string") continue;
    // pattern === replace 的是"已打过"探测项，不是真替换；skipIfMarked 的补丁
    // 会因为锚点自带 marker 提前返回，都跳过，这里只验锚点本身认不认得。
    if (String(rep.pattern) === String(rep.replace)) continue;
    const one = { ...patch, replacements: [rep], skipIfMarked: false };

    // 1) 原样必须命中
    const exact = applyReplacementsToText(`// head\n${rep.pattern}\n// tail\n`, one, "fixture.js");
    const exactHit = Boolean(exact.changed && (exact.loose || 0) === 0);
    if (exactHit) literal += 1;
    else literalMiss.push({ id: patch.id, name: patch.name, rep: index, chars: rep.pattern.length });

    // 2) 缩进被改过，必须靠容错命中
    const mutatedBody = shiftIndent(rep.pattern);
    if (mutatedBody === rep.pattern) {
      // 锚点本身没有行首缩进，改缩进无从下手：只验原样，不参与容错统计
      noIndent += 1;
      results.push({ id: patch.id, name: patch.name, rep: index, chars: rep.pattern.length, literal: exactHit, loose: false });
      continue;
    }
    const res = applyReplacementsToText(`// head\n${mutatedBody}\n// tail\n`, one, "fixture.js");
    const hit = res.changed;
    if (hit) looseOnly += 1;
    else missed.push({ id: patch.id, name: patch.name, rep: index, chars: rep.pattern.length, loose: res.loose || 0 });

    results.push({
      id: patch.id,
      name: patch.name,
      rep: index,
      chars: rep.pattern.length,
      literal: exactHit,
      loose: hit,
    });
  }
}

const total = results.length;
const looseHits = results.filter((r) => r.loose).length;
const report = {
  total,
  literal,
  looseHits,
  noIndent,
  literalMiss: literalMiss.length,
  literalMissDetail: literalMiss,
  missed: missed.length,
  missedDetail: missed,
  worst: results
    .filter((r) => r.loose)
    .sort((a, b) => b.chars - a.chars)
    .slice(0, 10),
  pass: missed.length === 0 && literalMiss.length === 0,
};

if (asJson) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  console.log(`锚点总数: ${total}（replacements 形态的字符串锚点）`);
  console.log(`原样命中: ${literal}`);
  console.log(`改缩进后仍命中: ${looseHits}`);
  console.log(`无行首缩进、跳过容错验证: ${noIndent}`);
  console.log(`原样都不命中: ${literalMiss.length}`);
  console.log(`改缩进后打不上: ${missed.length}`);
  if (literalMiss.length) {
    console.log("\n原样不命中的锚点:");
    for (const m of literalMiss.slice(0, 15)) console.log(`  #${m.id} ${m.name} rep${m.rep} (${m.chars} 字符)`);
  }
  if (missed.length) {
    console.log("\n改缩进后打不上的锚点:");
    for (const m of missed.slice(0, 20)) console.log(`  #${m.id} ${m.name} rep${m.rep} (${m.chars} 字符)`);
  }
  console.log(`\n总判定: ${report.pass ? "PASS" : "FAIL"}`);
}
process.exit(report.pass ? 0 : 1);
