#!/usr/bin/env node
/**
 * 从 Caddy JSON 访问日志按「行内 ts」过滤自然日，生成日报 JSON。
 * 用法: node scripts/generate-daily-report.mjs [--date YYYY-MM-DD]
 * 默认: 「昨天」——本地时区（建议 cron 设 TZ=Asia/Shanghai，见 cron-daily-report-yesterday.sh）。
 * 报表日区间: 当日 00:00:00.000 ～ 23:59:59.999（与 --date 指定日一致），与脚本在凌晨何时运行无关。
 */

import { execSync } from "node:child_process";
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

function getMethod(entry) {
  const r = entry.request;
  return r && typeof r.method === "string" ? r.method : "";
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

/** Caddy access：`request.host`；归一化小写并去掉末尾 `:port`（含 IPv6 `[addr]:port`） */
function normalizeHost(raw) {
  if (raw == null || typeof raw !== "string") return "";
  let h = raw.trim().toLowerCase();
  if (!h) return "";
  if (h.startsWith("[")) {
    const m = h.match(/^\[([^\]]+)\](?::\d+)?$/);
    return m ? `[${m[1]}]` : h;
  }
  const colon = h.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(h.slice(colon + 1))) {
    return h.slice(0, colon);
  }
  return h;
}

function getHost(entry) {
  const r = entry.request;
  let raw = "";
  if (r && typeof r.host === "string") raw = r.host;
  else if (typeof entry.host === "string") raw = entry.host;
  const h = normalizeHost(raw);
  return h || "(无 Host)";
}

/**
 * 静态资源路径：Top 路径表排除（仅路径段，不含 query）。
 * 含常见扩展名、Next 静态目录、部分固定文件名。
 */
/** Caddy JSON access log：duration / latency，单位一般为秒（浮点） */
function getDurationSec(entry) {
  let v = null;
  if (typeof entry.duration === "number" && !Number.isNaN(entry.duration)) {
    v = entry.duration;
  } else if (typeof entry.latency === "number" && !Number.isNaN(entry.latency)) {
    v = entry.latency;
  }
  if (v == null || v < 0) return null;
  // 极少数非标准日志可能为毫秒
  if (v > 600) v = v / 1000;
  return v;
}

function isStaticAssetPath(path) {
  if (!path || typeof path !== "string") return false;
  const p = path.trim().toLowerCase();
  if (
    p.includes("/_next/static/") ||
    p.includes("/_next/image") ||
    (p.includes("/static/") && /\.(?:js|css|png|jpe?g|gif|webp|svg|ico|woff2?)$/i.test(p))
  ) {
    return true;
  }
  if (
    p === "/favicon.ico" ||
    p === "/robots.txt" ||
    p.endsWith("/favicon.ico")
  ) {
    return true;
  }
  return /\.(?:js|mjs|cjs|css|map|png|jpe?g|gif|webp|svg|ico|bmp|avif|woff2?|ttf|eot|otf|mp4|webm|mp3|wav|ogg|pdf|zip|gz)$/i.test(
    p,
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
  /** @type {Set<string>} */
  const uniqueIps = new Set();
  let n = 0;
  let n5 = 0;
  let n4 = 0;
  let probeHits = 0;
  const probeByPath = makeCounter();
  /** @type {Record<number, ReturnType<typeof makeCounter>>} */
  const abnormalPathByStatus = {};
  /** @type {Array<{ tsMs: number, host: string, method: string, uri: string, status: number, duration: number | null, clientIp: string, msg: string }>} */
  const anomalyBuffer = [];

  const SLOW_THRESHOLD_SEC = Number(process.env.REPORT_SLOW_THRESHOLD_SEC || 3);
  const SLOW_MAX_COLLECT = Number(process.env.REPORT_SLOW_MAX_COLLECT || 8000);
  const SLOW_MAX_ROWS = Number(process.env.REPORT_SLOW_MAX_ROWS || 60);
  const slowByPath = makeCounter();
  /** @type {Array<{ tsMs: number, host: string, method: string, uri: string, status: number, durationSec: number, clientIp: string }>} */
  const slowBuffer = [];
  let durationKnown = 0;
  let durationSumSec = 0;
  let slowCount = 0;
  /** @type {{ lt1: number, s1_3: number, s3_10: number, gte10: number }} */
  const durationBuckets = { lt1: 0, s1_3: 0, s3_10: 0, gte10: 0 };

  const MAX_COLLECT = Number(process.env.REPORT_ANOMALY_MAX_COLLECT || 12000);
  const MAX_OUT = Number(process.env.REPORT_ANOMALY_MAX_ROWS || 350);
  const ABNORMAL_TOP_PATHS = Number(process.env.REPORT_ABNORMAL_TOP_PATHS || 25);

  return {
    name,
    feed(entry) {
      const st = getStatus(entry);
      const uri = getUri(entry);
      const ip = getClientIp(entry);
      const ipKey = String(ip || "unknown").trim() || "unknown";
      uniqueIps.add(ipKey);
      const tsMs = tsToMs(entry.ts) ?? 0;
      byStatus.add(String(st));
      n++;
      if (st >= 500) n5++;
      if (st >= 400 && st < 500) n4++;
      const pathOnly = (uri.split("?")[0] || uri).split("#")[0] || "/";
      if (!isStaticAssetPath(pathOnly)) {
        byPath.add(pathOnly);
      }

      if (st === 404) byIp404.add(ip);

      for (const p of PROBE_SUBSTRINGS) {
        if (uri.includes(p) || pathOnly.includes(p)) {
          probeHits++;
          probeByPath.add(p);
        }
      }

      const durationSec = getDurationSec(entry);
      if (durationSec != null) {
        durationKnown++;
        durationSumSec += durationSec;
        if (durationSec < 1) durationBuckets.lt1++;
        else if (durationSec < 3) durationBuckets.s1_3++;
        else if (durationSec < 10) durationBuckets.s3_10++;
        else durationBuckets.gte10++;

        if (durationSec >= SLOW_THRESHOLD_SEC) {
          slowCount++;
          if (!isStaticAssetPath(pathOnly)) slowByPath.add(pathOnly);
          if (slowBuffer.length < SLOW_MAX_COLLECT) {
            slowBuffer.push({
              tsMs,
              host: getHost(entry),
              method: getMethod(entry),
              uri: uri.slice(0, 2048),
              status: st,
              durationSec,
              clientIp: ip,
            });
          }
        }
      }

      if (
        (st >= 400 || st < 200 || st === 0) &&
        anomalyBuffer.length < MAX_COLLECT
      ) {
        if (!abnormalPathByStatus[st]) abnormalPathByStatus[st] = makeCounter();
        abnormalPathByStatus[st].add(pathOnly);
        const duration = durationSec;
        anomalyBuffer.push({
          tsMs,
          host: getHost(entry),
          method: getMethod(entry),
          uri: uri.slice(0, 2048),
          status: st,
          duration,
          clientIp: ip,
          msg:
            typeof entry.msg === "string"
              ? entry.msg.slice(0, 500)
              : typeof entry.err === "string"
                ? entry.err.slice(0, 500)
                : "",
        });
      }
    },
    snapshot() {
      /** @type {Record<string, Record<string, number>>} */
      const abnormalTopPaths = {};
      for (const [code, ctr] of Object.entries(abnormalPathByStatus)) {
        abnormalTopPaths[code] = Object.fromEntries(
          topN(ctr.entries, ABNORMAL_TOP_PATHS),
        );
      }

      const anomalyRowsSorted = anomalyBuffer
        .slice()
        .sort((a, b) => {
          const pa = a.status >= 500 ? 0 : a.status >= 400 ? 1 : 2;
          const pb = b.status >= 500 ? 0 : b.status >= 400 ? 1 : 2;
          if (pa !== pb) return pa - pb;
          return b.tsMs - a.tsMs;
        })
        .slice(0, MAX_OUT);

      const slowRowsSorted = slowBuffer
        .slice()
        .sort((a, b) => b.durationSec - a.durationSec || b.tsMs - a.tsMs)
        .slice(0, SLOW_MAX_ROWS);

      return {
        name,
        total: n,
        pv: n,
        uv: uniqueIps.size,
        error5xx: n5,
        error5xxRate: n ? n5 / n : 0,
        client4xx: n4,
        client4xxRate: n ? n4 / n : 0,
        byStatus: byStatus.entries,
        topPaths: Object.fromEntries(topN(byPath.entries, 25)),
        top404Ips: Object.fromEntries(topN(byIp404.entries, 15)),
        probeHits,
        probeByPath: probeByPath.entries,
        abnormalTopPaths,
        anomalyRowsSorted,
        slow: {
          thresholdSec: SLOW_THRESHOLD_SEC,
          withDuration: durationKnown,
          withoutDuration: Math.max(0, n - durationKnown),
          slowCount,
          slowRate: durationKnown ? slowCount / durationKnown : 0,
          avgDurationSec: durationKnown ? durationSumSec / durationKnown : null,
          durationBuckets,
          topSlowPaths: Object.fromEntries(topN(slowByPath.entries, 25)),
          slowRowsSorted,
        },
      };
    },
  };
}

/** @param {number} startMs @param {number} endMs */
function collectDockerLogSnippets(startMs, endMs) {
  if (process.env.REPORT_ATTACH_DOCKER_LOGS !== "1") return null;

  const raw = process.env.REPORT_DOCKER_LOG_SERVICES || "";
  const services = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!services.length) return null;

  const since = new Date(startMs).toISOString();
  const until = new Date(endMs + 1).toISOString();
  const kw =
    process.env.REPORT_DOCKER_LOG_GREP ||
    "Error|ERROR|Fatal|Exception|panic|PHP Fatal|PHP Parse|PHP Warning|stack trace|Unhandled|ECONNREFUSED";

  /** @type {Record<string, string>} */
  const snippets = {};
  const timeout = Number(process.env.REPORT_DOCKER_LOG_TIMEOUT_MS || 90000);

  for (let svc of services) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(svc)) {
      snippets[svc] = "[跳过] 容器名含非法字符，请在 REPORT_DOCKER_LOG_SERVICES 中使用安全名称。";
      continue;
    }
    try {
      const text = execSync(
        `docker logs "${svc}" --since "${since}" --until "${until}" 2>&1`,
        {
          encoding: "utf8",
          maxBuffer: 8 * 1024 * 1024,
          timeout,
        },
      );
      const lines = text.split("\n");
      let picked = lines.filter((ln) => new RegExp(kw, "i").test(ln));
      if (!picked.length) picked = lines.slice(-150);
      snippets[svc] = picked.slice(-220).join("\n").slice(-16000);
    } catch (e) {
      snippets[svc] =
        "[读取失败] " +
        String(e?.message || e).slice(0, 900) +
        "\n（若 Docker 不支持 --until，请升级客户端；或暂时关闭 REPORT_ATTACH_DOCKER_LOGS。）";
    }
  }

  return {
    hint:
      "以下为报表日时间窗内 docker logs 摘录，并按关键词筛选；无命中时退化为日志尾部。应用完整堆栈请以服务器上 docker logs / compose logs 为准。",
    since,
    until,
    services: snippets,
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

  /** @type {Map<string, ReturnType<typeof aggregateStream>>} */
  const perHost = new Map();

  function feedAll(entry) {
    merged.feed(entry);
    const h = getHost(entry);
    if (!perHost.has(h)) perHost.set(h, aggregateStream(h));
    perHost.get(h).feed(entry);
  }

  const rw = await readLinesMatchingDay(wwwFiles, start, end, (e) => {
    wwwOnly.feed(e);
    feedAll(e);
  });
  const ro = await readLinesMatchingDay(opFiles, start, end, (e) => {
    opOnly.feed(e);
    feedAll(e);
  });

  const auth = scanAuthLog(authPath, { y, m, d });

  /** @type {Record<string, ReturnType<ReturnType<typeof aggregateStream>["snapshot"]>>} */
  const perHostSnapshots = {};
  const hostOrder = [...perHost.entries()]
    .map(([host, agg]) => [host, agg.snapshot()])
    .sort((a, b) => b[1].total - a[1].total)
    .map(([host, snap]) => {
      perHostSnapshots[host] = snap;
      return host;
    });

  let dockerLogSnippets = null;
  try {
    dockerLogSnippets = collectDockerLogSnippets(start, end);
  } catch (e) {
    dockerLogSnippets = {
      hint: "收集容器日志时异常",
      error: String(e?.message || e),
      services: {},
    };
  }

  const timezoneHint =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "local";

  const data = {
    reportDate: ymd,
    generatedAt: new Date().toISOString(),
    timezoneHint,
    logFiles: { www: wwwFiles, op: opFiles },
    lineStats: {
      matchedWww: rw.linesOk,
      matchedOp: ro.linesOk,
      parseErrors: rw.parseErr + ro.parseErr,
    },
    www: wwwOnly.snapshot(),
    op: opOnly.snapshot(),
    merged: merged.snapshot(),
    perHost: perHostSnapshots,
    hostOrder,
    sshAuth: auth,
    dockerLogSnippets,
    slowThresholdSec: Number(process.env.REPORT_SLOW_THRESHOLD_SEC || 3),
    notes: [
      "HTTP 统计来自 Caddy JSON；顶栏「统计范围」可切换到单个 Host，卡片与图表按该域名过滤。",
      "PV = 访问日志条数（当日该范围内）；UV = 去重客户端 IP（无法识别时为 unknown）。",
      "请求耗时取自 Caddy JSON 的 duration（秒，整请求含反代 upstream）；慢请求阈值见 slowThresholdSec / .env 的 REPORT_SLOW_THRESHOLD_SEC。",
      "Top 路径已排除静态资源（js/css/图片/字体、/_next/static/ 等）；慢请求 Top 路径同样排除静态；非正常状态路径仍含静态以便排查。",
      "非正常状态码路径来自访问日志（≥400 或小于 200）；明细表为抽样行，非全量。",
      "Caddy 访问日志通常不含 PHP/Node 堆栈；需在 .env 开启 REPORT_ATTACH_DOCKER_LOGS=1 并配置 REPORT_DOCKER_LOG_SERVICES 才附录 docker logs 摘录。",
      "嗅探路径为 URI 子串启发式规则，与脚本内 PROBE 列表一致。",
    ],
  };

  const base = process.env.REPORT_BASENAME || "daily";
  const outName = `${base}-${ymd}.json`;
  const outPath = join(reportDir, outName);
  writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log("已写入", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
