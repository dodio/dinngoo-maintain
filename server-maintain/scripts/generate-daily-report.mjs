#!/usr/bin/env node
/**
 * 从 Caddy JSON 访问日志按「行内 ts」过滤自然日，生成静态 HTML 日报。
 * 用法: node scripts/generate-daily-report.mjs [--date YYYY-MM-DD]
 * 默认: 「昨天」——本地时区（建议 cron 设 TZ=Asia/Shanghai，见 cron-daily-report-yesterday.sh）。
 * 报表日区间: 当日 00:00:00.000 ～ 23:59:59.999（与 --date 指定日一致），与脚本在凌晨何时运行无关。
 */

import { createReadStream } from "node:fs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "../lib/load-env.mjs";
import { expandGlob } from "../lib/glob-files.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
loadEnvFile(ROOT);

const PROBE_SUBSTRINGS = [
  "/.env",
  "/.git",
  "/wp-admin",
  "/wp-login",
  "/phpmyadmin",
  "/.well-known/security.txt",
  "/administrator",
  "/xmlrpc.php",
];

function parseArgs(argv) {
  let date = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--date" && argv[i + 1]) {
      date = argv[i + 1];
      i++;
    }
  }
  return { date };
}

function defaultYesterdayYmd() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** @param {string} ymd */
function dayBoundsMs(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const end = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  return { start, end, y, m, d };
}

/** Caddy / zap 常见 ts：秒（浮点）或毫秒 */
function tsToMs(ts) {
  if (ts == null) return null;
  if (typeof ts === "string") {
    const n = Number(ts);
    if (Number.isNaN(n)) return null;
    return tsToMs(n);
  }
  if (typeof ts === "number") {
    if (ts > 1e15) return Math.floor(ts / 1e6);
    if (ts > 1e12) return Math.floor(ts);
    return Math.floor(ts * 1000);
  }
  return null;
}

function getStatus(entry) {
  const s = entry.status ?? entry.response?.status;
  return typeof s === "number" ? s : parseInt(String(s), 10) || 0;
}

function getUri(entry) {
  const r = entry.request;
  if (r && typeof r.uri === "string") return r.uri;
  if (typeof entry.uri === "string") return entry.uri;
  return "";
}

function getClientIp(entry) {
  const r = entry.request;
  if (!r) return "unknown";
  return (
    r.client_ip ||
    r.remote_ip ||
    r.headers?.["X-Forwarded-For"]?.split?.(",")?.[0]?.trim?.() ||
    "unknown"
  );
}

async function readLinesMatchingDay(files, startMs, endMs, onEntry) {
  let linesOk = 0;
  let parseErr = 0;

  for (const file of files) {
    if (!existsSync(file)) continue;

    const stream = createReadStream(file, { encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        parseErr++;
        continue;
      }

      const ms = tsToMs(entry.ts);
      if (ms == null || ms < startMs || ms > endMs) continue;

      linesOk++;
      onEntry(entry);
    }
  }

  return { linesOk, parseErr };
}

function makeCounter() {
  /** @type {Record<string, number>} */
  const o = {};
  return {
    add(k, n = 1) {
      o[k] = (o[k] || 0) + n;
    },
    get entries() {
      return o;
    },
  };
}

function topN(obj, n) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

/**
 * @param {string} line
 * @param {{ y: number, m: number, d: number }} day
 * @param {number} assumeYear
 */
function authLineMatchesDay(line, day, assumeYear) {
  const iso = line.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    const [y, mo, dom] = iso[1].split("-").map(Number);
    return y === day.y && mo === day.m && dom === day.d;
  }

  const monMap = {
    Jan: 1,
    Feb: 2,
    Mar: 3,
    Apr: 4,
    May: 5,
    Jun: 6,
    Jul: 7,
    Aug: 8,
    Sep: 9,
    Oct: 10,
    Nov: 11,
    Dec: 12,
  };
  const m1 = line.match(/^(\w{3})\s+(\d{1,2})\s\d{2}:\d{2}:\d{2}/);
  if (!m1) return false;
  const mon = monMap[m1[1]];
  const dom = Number(m1[2]);
  if (!mon) return false;
  return assumeYear === day.y && mon === day.m && dom === day.d;
}

function scanAuthLog(path, day) {
  if (!path || !existsSync(path)) {
    return {
      ok: false,
      reason: path ? "文件不可读或不存在" : "未配置 AUTH_LOG_PATH",
      failedPassword: 0,
      invalidUser: 0,
      samples: [],
    };
  }

  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {
      ok: false,
      reason: "无权限读取",
      failedPassword: 0,
      invalidUser: 0,
      samples: [],
    };
  }

  const assumeYear =
    Number(process.env.AUTH_LOG_ASSUME_YEAR) ||
    new Date().getFullYear();
  let failedPassword = 0;
  let invalidUser = 0;
  const samples = [];

  for (const line of text.split("\n")) {
    if (!authLineMatchesDay(line, day, assumeYear)) continue;
    if (line.includes("Failed password")) {
      failedPassword++;
      if (samples.length < 15) samples.push(line.slice(0, 240));
    } else if (line.includes("Invalid user")) {
      invalidUser++;
      if (samples.length < 15) samples.push(line.slice(0, 240));
    }
  }

  return {
    ok: true,
    reason: "",
    failedPassword,
    invalidUser,
    samples,
  };
}

function aggregateStream(name) {
  const byStatus = makeCounter();
  const byPath = makeCounter();
  const byIp404 = makeCounter();
  let n = 0;
  let n5 = 0;
  let n4 = 0;
  let probeHits = 0;
  const probeByPath = makeCounter();

  return {
    name,
    feed(entry) {
      const st = getStatus(entry);
      const uri = getUri(entry);
      const ip = getClientIp(entry);
      byStatus.add(String(st));
      n++;
      if (st >= 500) n5++;
      if (st >= 400 && st < 500) n4++;
      const pathOnly = uri.split("?")[0] || uri;
      byPath.add(pathOnly.split("#")[0] || "/");

      if (st === 404) byIp404.add(ip);

      for (const p of PROBE_SUBSTRINGS) {
        if (uri.includes(p) || pathOnly.includes(p)) {
          probeHits++;
          probeByPath.add(p);
        }
      }
    },
    snapshot() {
      return {
        name,
        total: n,
        error5xx: n5,
        error5xxRate: n ? n5 / n : 0,
        client4xx: n4,
        client4xxRate: n ? n4 / n : 0,
        byStatus: byStatus.entries,
        topPaths: Object.fromEntries(topN(byPath.entries, 25)),
        top404Ips: Object.fromEntries(topN(byIp404.entries, 15)),
        probeHits,
        probeByPath: probeByPath.entries,
      };
    },
  };
}

async function main() {
  const { date: dateArg } = parseArgs(process.argv.slice(2));
  const ymd =
    process.env.REPORT_DATE || dateArg || defaultYesterdayYmd();
  const { start, end, y, m, d } = dayBoundsMs(ymd);

  const globWww =
    process.env.CADDY_WWW_ACCESS_GLOB || "/var/log/caddy/www-access*.json";
  const globOp =
    process.env.CADDY_OP_ACCESS_GLOB || "/var/log/caddy/op-access*.json";
  const authPath = process.env.AUTH_LOG_PATH || "/var/log/auth.log";

  const reportDir = process.env.REPORT_DIR;
  if (!reportDir) {
    console.error("请设置 REPORT_DIR");
    process.exit(1);
  }

  const wwwFiles = expandGlob(globWww);
  const opFiles = expandGlob(globOp);

  const merged = aggregateStream("合并（www+op）");
  const wwwOnly = aggregateStream("www 日志文件");
  const opOnly = aggregateStream("op 日志文件");

  const rw = await readLinesMatchingDay(wwwFiles, start, end, (e) => {
    wwwOnly.feed(e);
    merged.feed(e);
  });
  const ro = await readLinesMatchingDay(opFiles, start, end, (e) => {
    opOnly.feed(e);
    merged.feed(e);
  });

  const auth = scanAuthLog(authPath, { y, m, d });

  const data = {
    reportDate: ymd,
    generatedAt: new Date().toISOString(),
    timezoneHint:
      Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
    logFiles: { www: wwwFiles, op: opFiles },
    lineStats: {
      matchedWww: rw.linesOk,
      matchedOp: ro.linesOk,
      parseErrors: rw.parseErr + ro.parseErr,
    },
    www: wwwOnly.snapshot(),
    op: opOnly.snapshot(),
    merged: merged.snapshot(),
    sshAuth: auth,
    notes: [
      "HTTP 统计来自 Caddy JSON；5xx 视为服务端错误，4xx 含客户端与嗅探常见 404。",
      "嗅探路径为 URI 子串启发式规则，模板内 PROBE 与脚本一致。",
    ],
  };

  const tplPath = join(ROOT, "templates", "daily-report.template.html");
  if (!existsSync(tplPath)) {
    console.error("缺少模板", tplPath);
    process.exit(1);
  }

  let html = readFileSync(tplPath, "utf8");
  const payload = JSON.stringify(data);
  html = html.replaceAll("__REPORT_JSON__", () =>
    payload.replace(/</g, "\\u003c"),
  );
  html = html.replaceAll("__REPORT_DATE__", ymd);

  const base = process.env.REPORT_BASENAME || "daily";
  const outName = `${base}-${ymd}.html`;
  const outPath = join(reportDir, outName);
  writeFileSync(outPath, html, "utf8");
  console.log("已写入", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
