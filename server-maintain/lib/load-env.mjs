import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @param {string} [fromDir] 解析相对路径的基准目录
 */
export function loadEnvFile(fromDir = process.cwd()) {
  const envPath = process.env.SERVER_MAINTAIN_ENV;
  const candidates = [
    envPath && resolve(fromDir, envPath),
    resolve(fromDir, ".env"),
  ].filter(Boolean);

  for (const p of candidates) {
    if (!p || !existsSync(p)) continue;
    const raw = readFileSync(p, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
    break;
  }
}
