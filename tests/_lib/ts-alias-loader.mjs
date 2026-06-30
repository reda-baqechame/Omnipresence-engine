/**
 * node --test resolver hook for the app's import style.
 *
 * Node's native TS support strips types from `.ts` files, but its ESM resolver
 * does NOT understand the project's `@/*` tsconfig path alias or extensionless
 * relative imports. This hook adds both so feature tests can import REAL app
 * engines (which use `@/...` and extensionless imports internally) without any
 * production-code churn. It only rewrites module specifiers — execution and TS
 * stripping stay with Node.
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(root, "src");

function resolveFile(base) {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}.js`,
    `${base}.json`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // `@/x` → `<repo>/src/x` (with extension probing)
  if (specifier.startsWith("@/")) {
    const target = resolveFile(path.join(SRC, specifier.slice(2)));
    if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
  }

  // Extensionless relative import → probe for the real file.
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !path.extname(specifier)) {
    const parent = context.parentURL ? fileURLToPath(context.parentURL) : path.join(root, "x");
    const target = resolveFile(path.resolve(path.dirname(parent), specifier));
    if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
