#!/usr/bin/env node
/**
 * OP 与 MAINT 的 *_GATE_TOKEN 须为**不同随机值**，勿复用同一段字符串。
 * 用法:
 *   node scripts/rotate-gate-tokens.mjs [--dry-run] [--write] [--maint-only] [--op-only]
 * 环境变量 CADDY_ENV_FILE=/etc/caddy/caddy.env
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import { loadEnvFile } from "../lib/load-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
loadEnvFile(ROOT);

function parseArgs(argv) {
  let dryRun = false;
  let write = false;
  let maintOnly = false;
  let opOnly = false;
  let envFile = process.env.CADDY_ENV_FILE || "";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--write") write = true;
    else if (a === "--maint-only") maintOnly = true;
    else if (a === "--op-only") opOnly = true;
    else if (a === "--env-file" && argv[i + 1]) {
      envFile = argv[++i];
    }
  }

  if (maintOnly && opOnly) {
    maintOnly = false;
    opOnly = false;
  }

  return { dryRun, write, maintOnly, opOnly, envFile: envFile.trim() };
}

function randomToken() {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * @param {string} content
 * @param {Record<string, string>} updates
 */
function patchEnvLines(content, updates) {
  const keys = new Set(Object.keys(updates));
  const lines = content.split("\n");
  const used = new Set();
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return line;
    const key = trimmed.slice(0, eq).trim();
    if (!keys.has(key)) return line;
    used.add(key);
    const indent = line.match(/^\s*/)?.[0] ?? "";
    const val = updates[key];
    const safe =
      /[\s#"']/.test(val) ? `"${val.replace(/"/g, '\\"')}"` : val;
    return `${indent}${key}=${safe}`;
  });

  for (const key of keys) {
    if (used.has(key)) continue;
    const val = updates[key];
    const safe =
      /[\s#"']/.test(val) ? `"${val.replace(/"/g, '\\"')}"` : val;
    out.push(`${key}=${safe}`);
  }

  return out.join("\n");
}

function readEnvMap(path) {
  if (!path || !existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  /** @type {Record<string, string>} */
  const map = {};
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    map[k] = v;
  }
  return map;
}

function main() {
  const { dryRun, write, maintOnly, opOnly, envFile } = parseArgs(
    process.argv.slice(2),
  );

  const filePath = envFile ? resolve(envFile) : "";
  const existing = filePath ? readEnvMap(filePath) : {};

  const updates = {};
  const meta = [];

  const doMaint = !opOnly;
  const doOp = !maintOnly;

  if (doMaint) {
    const cur = existing.MAINT_GATE_TOKEN || "";
    const neu = randomToken();
    updates.MAINT_GATE_TOKEN_OLD = cur
      ? cur
      : existing.MAINT_GATE_TOKEN_OLD || "";
    updates.MAINT_GATE_TOKEN = neu;
    meta.push({
      label: "MAINT",
      previous: cur || "(空)",
      newPrimary: neu,
      oldSlot: updates.MAINT_GATE_TOKEN_OLD,
    });
  }

  if (doOp) {
    const cur = existing.OP_GATE_TOKEN || "";
    const neu = randomToken();
    updates.OP_GATE_TOKEN_OLD = cur
      ? cur
      : existing.OP_GATE_TOKEN_OLD || "";
    updates.OP_GATE_TOKEN = neu;
    meta.push({
      label: "OP",
      previous: cur || "(空)",
      newPrimary: neu,
      oldSlot: updates.OP_GATE_TOKEN_OLD,
    });
  }

  /** OP_GATE_TOKEN 与 MAINT_GATE_TOKEN 必须不同（独立书签、降低单点泄露影响面）。 */
  const peerMaint = (doMaint ? updates.MAINT_GATE_TOKEN : existing.MAINT_GATE_TOKEN) || "";
  const peerOp = (doOp ? updates.OP_GATE_TOKEN : existing.OP_GATE_TOKEN) || "";
  if (peerMaint && peerOp && peerMaint === peerOp) {
    console.warn(
      "[warn] OP_GATE_TOKEN 与 MAINT_GATE_TOKEN 当前相同，正在重新生成其一以满足「必须不同」约束。",
    );
    if (doMaint && doOp) {
      do {
        updates.OP_GATE_TOKEN = randomToken();
      } while (updates.OP_GATE_TOKEN === updates.MAINT_GATE_TOKEN);
      const opM = meta.find((x) => x.label === "OP");
      if (opM) opM.newPrimary = updates.OP_GATE_TOKEN;
    } else if (doMaint) {
      do {
        updates.MAINT_GATE_TOKEN = randomToken();
      } while (updates.MAINT_GATE_TOKEN === peerOp);
      const mM = meta.find((x) => x.label === "MAINT");
      if (mM) mM.newPrimary = updates.MAINT_GATE_TOKEN;
    } else {
      do {
        updates.OP_GATE_TOKEN = randomToken();
      } while (updates.OP_GATE_TOKEN === peerMaint);
      const om = meta.find((x) => x.label === "OP");
      if (om) om.newPrimary = updates.OP_GATE_TOKEN;
    }
  }

  console.log(JSON.stringify({ dryRun, write, filePath, meta }, null, 2));

  if (dryRun) {
    console.log("\n[dry-run] 未写文件。去掉 --dry-run 并加 --write 以写回 CADDY_ENV_FILE。");
    console.log(
      "轮换后请: sudo systemctl reload caddy（或你的 reload 命令），并通知运营更新带 entry_token 的入口链接。",
    );
    return;
  }

  if (!write) {
    console.log("\n仅预览。要对文件写回请追加 --write（并建议先备份 CADDY_ENV_FILE）。");
    for (const m of meta) {
      console.log(`\n${m.label}_GATE_TOKEN=${m.newPrimary}`);
      if (m.oldSlot) console.log(`${m.label}_GATE_TOKEN_OLD=${m.oldSlot}`);
    }
    console.log(
      "\n轮换后请: sudo systemctl reload caddy，并通知运营更新书签。",
    );
    return;
  }

  if (!filePath || !existsSync(filePath)) {
    console.error("未找到 CADDY_ENV_FILE 或文件不存在:", filePath);
    process.exit(1);
  }

  const before = readFileSync(filePath, "utf8");
  const after = patchEnvLines(before, updates);
  writeFileSync(filePath, after, "utf8");
  console.log("已更新", filePath);
  console.log("请执行: sudo systemctl reload caddy");
}

main();
