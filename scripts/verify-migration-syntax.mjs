#!/usr/bin/env node
/**
 * Dry-run syntax checks for supabase/migrations/*.sql (no DB required).
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase", "migrations");

function listSqlFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile());
}

function checkBalancedDelimiters(sql, file) {
  const errors = [];
  let parens = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (c === "'" && next === "'") {
        i++;
        continue;
      }
      if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      continue;
    }

    if (c === "-" && next === "-") {
      inLineComment = true;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      continue;
    }
    if (c === "(") parens++;
    if (c === ")") parens--;
    if (parens < 0) errors.push(`${file}: unbalanced ')' at offset ${i}`);
  }

  if (inSingle) errors.push(`${file}: unclosed single-quoted string`);
  if (inDouble) errors.push(`${file}: unclosed double-quoted identifier`);
  if (parens !== 0) errors.push(`${file}: unbalanced parentheses (${parens > 0 ? "missing )" : "extra )"})`);
  return errors;
}

function checkFile(path) {
  const rel = path.replace(root + "\\", "").replace(root + "/", "");
  const sql = readFileSync(path, "utf8");
  const errors = [];

  if (!sql.trim()) {
    errors.push(`${rel}: empty migration file`);
    return errors;
  }

  if (/\0/.test(sql)) errors.push(`${rel}: contains null bytes`);

  const lower = sql.toLowerCase();
  const hasDdl =
    lower.includes("create ") ||
    lower.includes("alter ") ||
    lower.includes("drop ") ||
    lower.includes("insert ") ||
    lower.includes("update ") ||
    lower.includes("grant ") ||
    lower.includes("policy ");
  if (!hasDdl) errors.push(`${rel}: no recognizable SQL statements`);

  errors.push(...checkBalancedDelimiters(sql, rel));
  return errors;
}

const files = listSqlFiles(migrationsDir);
if (files.length === 0) {
  console.error("verify:migration-syntax — no .sql files in supabase/migrations");
  process.exit(1);
}

let allErrors = [];
for (const file of files) {
  allErrors = allErrors.concat(checkFile(file));
}

if (allErrors.length) {
  console.error("\nverify:migration-syntax — FAIL\n");
  for (const e of allErrors) console.error(`  ✗ ${e}`);
  console.error(`\n${allErrors.length} issue(s) in ${files.length} migration file(s).\n`);
  process.exit(1);
}

console.log(`verify:migration-syntax — OK (${files.length} files)\n`);
