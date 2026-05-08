#!/usr/bin/env node
import {
  writeFileSync,
  renameSync,
  existsSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { execFileSync } from "node:child_process";

import { loadEnvFile } from "../lib/load-env.mjs";
import { expandGlob } from "../lib/glob-files.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
loadEnvFile(ROOT);

function dfInfo() {
  try {
    const out = execFileSync("df", ["-P", "-B1"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseDfP(out, 1);
  } catch {
    try {
      const out = execFileSync("df", ["-Pk"], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      return parseDfP(out, 1024);
    } catch {
      return null;
    }
  }
}

/**
 * @param {string} out `df -P` style
 * @param {number} unitMul multiply block columns (1 for -B1, 1024 for -k)
 */
function parseDfP(out, unitMul) {
  const lines = out.trim().split("\n").slice(1);
  return lines
    .map((line) => {
      const parts = line.split(/\s+/);
      if (parts.length < 6) return null;
      const filesystem = parts[0];
      const sizeB = Number(parts[1]) * unitMul;
      const usedB = Number(parts[2]) * unitMul;
      const availB = Number(parts[3]) * unitMul;
      const pctStr = parts[4].replace("%", "");
      const mounted = parts.slice(5).join(" ");
      const usePercent = Number(pctStr) || 0;
      return {
        filesystem,
        mounted,
        sizeBytes: sizeB,
        usedBytes: usedB,
        availBytes: availB,
        usePercent,
      };
    })
    .filter(Boolean);
}

function tryDockerStats() {
  try {
    const out = execFileSync(
      "docker",
      ["stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"],
      { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 8000 },
    );
    const rows = out
      .trim()
      .split("\n")
      .map((line) => {
        const [name, cpuPerc, memUsage] = line.split("\t");
        if (!name) return null;
        return { name, cpuPerc: cpuPerc || "", memUsage: memUsage || "" };
      })
      .filter(Boolean);
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}

/** @param {string} dir @param {string} globPat e.g. *.sql.gz */
function latestBackup(dir, globPat) {
  if (!dir || !existsSync(dir)) {
    return {
      dbBackup: null,
      dbBackupError: dir ? "BACKUP_DIR 不存在或不可访问" : "未设置 BACKUP_DIR",
    };
  }

  const pattern = join(dir, globPat || "*.sql.gz");
  const files = expandGlob(pattern);
  if (!files.length) {
    return { dbBackup: null, dbBackupError: "目录内无匹配备份文件" };
  }

  let best = null;
  let bestM = 0;
  for (const f of files) {
    try {
      const st = statSync(f);
      if (st.mtimeMs >= bestM) {
        bestM = st.mtimeMs;
        best = { path: f, st };
      }
    } catch {
      /* continue */
    }
  }

  if (!best) {
    return { dbBackup: null, dbBackupError: "无法 stat 备份文件" };
  }

  return {
    dbBackup: {
      path: best.path,
      fileName: best.path.split("/").pop() || best.path,
      mtimeMs: best.st.mtimeMs,
      mtimeIso: best.st.mtime.toISOString(),
      sizeBytes: best.st.size,
    },
    dbBackupError: null,
  };
}

function main() {
  const reportDir = process.env.REPORT_DIR || "";
  const metricsPath =
    process.env.METRICS_JSON_PATH ||
    (reportDir ? join(reportDir, "metrics.json") : "");

  if (!metricsPath) {
    console.error("请设置 METRICS_JSON_PATH 或 REPORT_DIR");
    process.exit(1);
  }

  const backupDir = process.env.BACKUP_DIR || "";
  const backupGlob = process.env.BACKUP_GLOB || "*.sql.gz";
  const { dbBackup, dbBackupError } = latestBackup(backupDir, backupGlob);

  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  const payload = {
    ts: Date.now(),
    tsIso: new Date().toISOString(),
    hostname: os.hostname(),
    platform: os.platform(),
    loadavg: os.loadavg(),
    cpuCount: os.cpus().length,
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: totalMem - freeMem,
      usePercent: totalMem ? (totalMem - freeMem) / totalMem : 0,
    },
    disks: dfInfo(),
    docker: tryDockerStats(),
    dbBackup,
    dbBackupError,
  };

  const tmp = `${metricsPath}.${process.pid}.${Date.now()}.tmp`;
  const json = `${JSON.stringify(payload, null, 0)}\n`;
  writeFileSync(tmp, json, "utf8");
  renameSync(tmp, metricsPath);
  console.log("metrics ->", metricsPath);
}

main();
