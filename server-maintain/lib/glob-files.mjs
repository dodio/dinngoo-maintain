import { readdirSync, statSync, existsSync } from "node:fs";
import { dirname, basename, join } from "node:path";

/**
 * 仅支持路径中 **一个** * 通配符，例如 /var/log/caddy/www-access*.json
 * @param {string} pattern
 * @returns {string[]}
 */
export function expandGlob(pattern) {
  if (!pattern || !existsSync(dirname(pattern))) return [];

  const dir = dirname(pattern);
  const fn = basename(pattern);
  if (!fn.includes("*")) {
    try {
      statSync(pattern);
      return [pattern];
    } catch {
      return [];
    }
  }

  const star = fn.indexOf("*");
  const prefix = fn.slice(0, star);
  const suffix = fn.slice(star + 1);
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }

  const files = names
    .filter((n) => n.startsWith(prefix) && n.endsWith(suffix))
    .map((n) => join(dir, n));

  return files.sort();
}
