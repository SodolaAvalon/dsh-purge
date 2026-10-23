#!/usr/bin/env node
/**
 * 渲染预演：不启动 DSH，直接看"模型到底会收到什么系统提示词"。
 *
 * 用法：
 *   node scripts/render-prompt.mjs                     # 用默认提示词
 *   node scripts/render-prompt.mjs path\to\inject.md   # 用指定提示词
 *   node scripts/render-prompt.mjs --json              # 机器可读
 *
 * 只做组装 + 断言，不改任何文件、不联网。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const fileArg = args.find((a) => !a.startsWith("--"));

function readDefaultInject() {
  for (const rel of ["lib/default-prompt-inject.md", "lib/default-prompt-inject.zh.md"]) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) return { text: fs.readFileSync(p, "utf8"), from: rel };
  }
  throw new Error("找不到默认提示词 lib/default-prompt-inject.zh.md");
}

const inject = fileArg
  ? { text: fs.readFileSync(path.resolve(fileArg), "utf8"), from: path.resolve(fileArg) }
  : readDefaultInject();

const { rewritePromptAssembly } = await import("../lib/identity.js");

/** 造一份和宿主结构一致的假 assembled。故意不放 cwd，验证 0.2.1 兼容补丁。 */
function fakeAssembly(model) {
  return {
    variables: { model },
    sections: [
      {
        name: "harness:identity",
        text: `You are a coding agent powered by the ${model} model, running on the DeepSeek Harness. Your working directory is {{cwd}}.`,
        order: -1000,
      },
      {
        name: "deployment:persona-prefix",
        text: "You are an AI agent powered by DeepSeek Harness.",
        order: -900,
      },
      {
        name: "deployment:persona-suffix",
        text: "Your working directory is {{cwd}}.",
        order: 10200,
      },
      {
        name: "workspace-instructions",
        text: "This complete workspace instruction baseline replaces all earlier workspace instruction baselines.",
        order: -800,
      },
      {
        name: "dsh-purge:rules",
        text: "",
        order: -700,
      },
      {
        name: "tools-brief",
        text: "Host tools are described elsewhere.",
        order: 500,
      },
    ],
    contexts: [{ name: "runtime", text: "runtime context" }],
    tools: [],
  };
}

const model = process.env.PROBE_MODEL || "deepseek-reasoner";
const assembled = fakeAssembly(model);
const out = rewritePromptAssembly(assembled, {
  fallbackInject: inject.text,
  capabilityProtocol: true,
  context: {},
});

const sections = Array.isArray(out?.sections) ? out.sections : [];
const joined = sections.map((s) => String(s?.text || "")).filter(Boolean).join("\n\n");
const hits = sections.filter((s) => String(s?.text || "").includes(inject.text)).map((s) => s.name);
const hasHarnessIdentity = /powered by the .*model, running on the DeepSeek Harness/.test(joined);
const hasOfficialPersona = /You are an AI agent powered by DeepSeek Harness/.test(joined);
const capSection = sections.filter((s) => s.name === "dshpg-capabilities");
const anchorIdx = sections.findIndex((s) => s.name === "dshpg-anchor");
const modelIdx = sections.findIndex((s) => s.name === "dshpg-model");
const last = sections.length - 1;
const cwd = out?.variables?.cwd;

const checks = [
  { id: "注入原文完整出现且仅一段", pass: hits.length === 1, detail: hits.join(",") || "无" },
  { id: "注入在最前（persona-prefix 折叠）", pass: /^deployment:persona-prefix$|^persona-prefix$|^persona$/.test(sections[0]?.name || ""), detail: sections[0]?.name || "" },
  { id: "官方身份句已清除", pass: !hasHarnessIdentity && !hasOfficialPersona, detail: hasHarnessIdentity ? "残留 harness:identity" : hasOfficialPersona ? "残留 persona" : "干净" },
  { id: "capability 段存在", pass: capSection.length === 1, detail: capSection.length === 1 ? `order ${capSection[0].order}` : "缺失" },
  { id: "尾部锚存在且在结构最末", pass: anchorIdx >= 0 && (modelIdx > anchorIdx || anchorIdx === last), detail: anchorIdx >= 0 ? `第 ${anchorIdx + 1}/${sections.length} 段` : "缺失" },
  { id: "尾部锚与注入同语言", pass: (() => { const a = String(sections[anchorIdx]?.text || ""); const zh = /[\u4e00-\u9fff]/.test(a); const zhInject = /[\u4e00-\u9fff]/.test(inject.text); return a ? zh === zhInject : false; })(), detail: anchorIdx >= 0 ? "ok" : "无锚" },
  { id: "variables.cwd 已补（0.2.1 兼容）", pass: typeof cwd === "string" && cwd.length > 0, detail: String(cwd || "") },
  { id: "注入字节数合理（>8KB）", pass: inject.text.length > 8192, detail: `${inject.text.length} chars` },
];

const report = {
  model,
  injectFrom: inject.from,
  injectBytes: inject.text.length,
  sectionCount: sections.length,
  order: sections.map((s) => ({ name: s.name, order: s.order, bytes: String(s?.text || "").length })),
  checks,
  pass: checks.every((c) => c.pass),
  previewHead: String(sections[0]?.text || "").slice(0, 400),
  previewTail: String(sections[sections.length - 1]?.text || "").slice(-400),
};

if (asJson) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  console.log(`模型: ${report.model}`);
  console.log(`提示词来源: ${report.injectFrom}  (${report.injectBytes} bytes)`);
  console.log(`最终段数: ${report.sectionCount}`);
  console.log("\n段顺序:");
  for (const s of report.order) console.log(`  ${String(s.order).padStart(7)}  ${String(s.bytes).padStart(6)}B  ${s.name}`);
  console.log("\n断言:");
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.id}  (${c.detail})`);
  console.log(`\n总判定: ${report.pass ? "PASS" : "FAIL"}`);
}
process.exit(report.pass ? 0 : 1);
