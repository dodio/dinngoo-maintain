#!/usr/bin/env node
/**
 * 按自然日筛选 Docker 日志并做关键词命中统计（适合 json-file + docker logs）。
 *
 * 数据来源（可并行）：
 * 1) `docker logs` — DOCKER_LOG_CONTAINERS 或 --containers（逗号分隔容器名）
 * 2) 原始 *-json.log — DOCKER_JSON_LOG_GLOB（路径中一个 *，如 .../abc/*-json.log）
 *
 * 用法:
 *   node scripts/analyze-docker-logs.mjs [--date YYYY-MM-DD] [--containers a,b] [--json-glob '/path/*-json.log'] [--print json]
 */

import { createReadStream } from "node:fs";
import { existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "../lib/load-env.mjs";
import { expandGlob } from "../lib/glob-files.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
loadEnvFile(ROOT);

/** @type {string[]} */
const DEFAULT_KEYWORDS = [
  "error",
  "fatal",
  "exception",
  "panic",
  "php fatal",
  "php warning",
  "php parse",
  "php notice",
  "e_error",
  "uncaught",
  "referenceerror",
  "typeerror",
  "syntaxerror",
  "econnrefused",
  "econnreset",
  "enotfound",
  "listen eaddrinuse",
  "out of memory",
  " oom",
  "stack trace",
  "segmentation fault",
  "errno",
  "traceback",
  "x509",
  "certificate",
];

function parseArgs(argv) {
  let date = null;
  let containers = null;
  let print = "text";
  let jsonGlob = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--date" && argv[i + 1]) date = argv[++i];
    else if (argv[i] === "--containers" && argv[i + 1])
      containers = argv[++i];
    else if (argv[i] === "--json-glob" && argv[i + 1]) jsonGlob = argv[++i];
    else if (argv[i] === "--print" && argv[i + 1]) print = argv[++i];
  }
  return { date, containers, jsonGlob, print };
}

function defaultYesterdayYmd() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function dayBoundsMs(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const end = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  return { start, end };
}

function nextDayMidnightIso(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  const ny = next.getFullYear();
  const nm = String(next.getMonth() + 1).padStart(2, "0");
  const nd = String(next.getDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}T00:00:00`;
}

function buildKeywords() {
  const extra = (process.env.DOCKER_LOG_KEYWORDS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_KEYWORDS, ...extra]));
}

/**
 * @param {string} raw 单行应用日志（无 Docker 外层包裹）
 */
function flattenForSearch(raw) {
  const trimmed = raw.replace(/\r?\n$/, "");
  try {
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const innerObj = JSON.parse(trimmed);
      const parts = [];
      if (innerObj && typeof innerObj === "object" && !Array.isArray(innerObj)) {
        for (const k of [
          "level",
          "severity",
          "statusCode",
          "status",
          "msg",
          "message",
          "err",
          "error",
          "stack",
        ]) {
          if (innerObj[k] != null) parts.push(String(innerObj[k]));
        }
      }
      parts.push(JSON.stringify(innerObj));
      return parts.join(" ").toLowerCase();
    }
  } catch {
    /* 纯文本 */
  }
  return trimmed.toLowerCase();
}

function matchKeywords(textLower, keywords) {
  /** @type {string[]} */
  const hit = [];
  for (const kw of keywords) {
    if (kw && textLower.includes(kw)) hit.push(kw);
  }
  return hit;
}

/**
 * @param {string} container
 * @param {string} sinceIso
 * @param {string} untilIso docker --until 为开区间上界
 */
function collectDockerLogs(container, sinceIso, untilIso) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "docker",
      ["logs", "--since", sinceIso, "--until", untilIso, container],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    proc.stdout.on("data", (c) => {
      out += c.toString("utf8");
    });
    proc.stderr.on("data", (c) => {
      err += c.toString("utf8");
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        const msg = (err + out).trim() || `exit ${code}`;
        reject(new Error(`docker logs ${container}: ${msg.slice(0, 400)}`));
        return;
      }
      /** @type {{source:string, stream:string, raw:string}[]} */
      const lines = [];
      for (const line of out.split("\n")) {
        if (line.length)
          lines.push({ source: container, stream: "stdout", raw: line });
      }
      for (const line of err.split("\n")) {
        if (line.length)
          lines.push({ source: container, stream: "stderr", raw: line });
      }
      resolve(lines);
    });
  });
}

/**
 * @param {string} file
 * @param {string} label
 * @param {number} startMs
 * @param {number} endMs
 */
async function collectJsonFileLog(file, label, startMs, endMs) {
  if (!existsSync(file)) return [];

  const stream = createReadStream(file, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  /** @type {{source:string, stream:string, raw:string}[]} */
  const out = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const timeStr = o.time;
    if (!timeStr) continue;
    const t = new Date(timeStr).getTime();
    if (Number.isNaN(t) || t < startMs || t > endMs) continue;
    const raw = String(o.log || "").replace(/\r?\n$/, "");
    out.push({ source: label, stream: o.stream || "?", raw });
  }
  return out;
}

function aggregate(lines, keywords) {
  let total = 0;
  /** @type {Record<string, number>} */
  const byKeyword = Object.create(null);
  /** @type {Record<string, { lines: number; hits: number; byKeyword: Record<string, number> }>} */
  const bySource = Object.create(null);
  /** @type {{ source: string; stream: string; hits: string[]; preview: string }[]} */
  const samples = [];

  for (const kw of keywords) byKeyword[kw] = 0;

  for (const row of lines) {
    total++;
    const src = row.source || "unknown";
    if (!bySource[src])
      bySource[src] = { lines: 0, hits: 0, byKeyword: Object.create(null) };
    bySource[src].lines++;

    const flat = flattenForSearch(row.raw);
    const hits = matchKeywords(flat, keywords);
    if (!hits.length) continue;

    bySource[src].hits++;
    for (const h of hits) {
      byKeyword[h] = (byKeyword[h] || 0) + 1;
      bySource[src].byKeyword[h] = (bySource[src].byKeyword[h] || 0) + 1;
    }
    if (samples.length < 40) {
      samples.push({
        source: src,
        stream: row.stream,
        hits,
        preview: row.raw.slice(0, 500),
      });
    }
  }

  return { total, byKeyword, bySource, samples };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ymd = process.env.DOCKER_LOG_DATE || args.date || defaultYesterdayYmd();
  const { start, end } = dayBoundsMs(ymd);
  const sinceIso = `${ymd}T00:00:00`;
  const untilIso = nextDayMidnightIso(ymd);

  const contRaw =
    args.containers || process.env.DOCKER_LOG_CONTAINERS || "";
  const containers = contRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const globRaw = args.jsonGlob || process.env.DOCKER_JSON_LOG_GLOB || "";
  const keywords = buildKeywords();

  /** @type {{source:string, stream:string, raw:string}[]} */
  let all = [];

  for (const c of containers) {
    try {
      const chunk = await collectDockerLogs(c, sinceIso, untilIso);
      all = all.concat(chunk);
    } catch (e) {
      console.warn(String((e && e.message) || e));
    }
  }

  if (globRaw) {
    const files = expandGlob(globRaw);
    for (const f of files) {
      const rows = await collectJsonFileLog(f, f, start, end);
      all = all.concat(rows);
    }
  }

  if (!containers.length && !globRaw) {
    console.error(
      "请设置 DOCKER_LOG_CONTAINERS（逗号分隔容器名）或 DOCKER_JSON_LOG_GLOB，或使用参数 --containers / --json-glob",
    );
    console.error(
      "示例: DOCKER_LOG_CONTAINERS=php-server-nginx-1,php-server-php-1 node scripts/analyze-docker-logs.mjs --date 2026-05-07",
    );
    process.exit(1);
  }

  const agg = aggregate(all, keywords);

  const report = {
    date: ymd,
    generatedAt: new Date().toISOString(),
    window: {
      sinceIso,
      untilIso,
      note:
        "docker logs 使用 --since/--until（本地时间串）；json-file 按行内 time 解析为 UTC 后与本地日界比较",
    },
    sources: { containers, jsonGlob: globRaw || null },
    keywordsUsed: keywords,
    totalLines: agg.total,
    hitCountsByKeyword: agg.byKeyword,
    bySource: agg.bySource,
    samples: agg.samples,
  };

  const reportDir = process.env.REPORT_DIR || "";
  if (reportDir && existsSync(reportDir)) {
    const outPath = join(reportDir, `docker-log-scan-${ymd}.json`);
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log("已写入", outPath);
  }

  if (args.print === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`\n=== Docker 日志扫描 ${ymd} ===`);
  console.log(`范围内行数: ${agg.total}`);
  console.log("\n按容器/文件:");
  for (const [src, v] of Object.entries(agg.bySource)) {
    console.log(`  ${src}: ${v.lines} 行, 含关键词行 ${v.hits}`);
  }
  console.log("\n关键词命中次数（同行可多词累计）:");
  const top = Object.entries(agg.byKeyword)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!top.length) console.log("  （无命中）");
  else top.forEach(([k, n]) => console.log(`  ${k}: ${n}`));
  console.log("\n样例（最多 40 条，仅含关键词命中行）:");
  agg.samples.forEach((s, i) => {
    console.log(`\n--- ${i + 1} [${s.source}/${s.stream}] ---`);
    console.log(s.hits.join(", "));
    console.log(s.preview);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
