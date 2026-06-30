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

/**
 * Bundlers (Next/webpack) import JSON without attributes, but Node's native ESM
 * loader requires `with { type: "json" }`. When we resolve to a `.json` file we
 * inject the attribute so app modules that `import x from "@/.../foo.json"` work
 * unmodified under `node --test`.
 */
function resolved(target, context) {
  const out = { url: pathToFileURL(target).href, shortCircuit: true };
  if (target.endsWith(".json")) {
    out.importAttributes = { ...(context.importAttributes || {}), type: "json" };
  }
  return out;
}

export async function resolve(specifier, context, nextResolve) {
  // `@/x` → `<repo>/src/x` (with extension probing)
  if (specifier.startsWith("@/")) {
    const target = resolveFile(path.join(SRC, specifier.slice(2)));
    if (target) return resolved(target, context);
  }

  // Extensionless relative import → probe for the real file.
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !path.extname(specifier)) {
    const parent = context.parentURL ? fileURLToPath(context.parentURL) : path.join(root, "x");
    const target = resolveFile(path.resolve(path.dirname(parent), specifier));
    if (target) return resolved(target, context);
  }

  // Direct .json specifier (relative or alias-less) → ensure the attribute too.
  if (specifier.endsWith(".json")) {
    if (specifier.startsWith("@/")) {
      const target = path.join(SRC, specifier.slice(2));
      if (existsSync(target)) return resolved(target, context);
    }
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const parent = context.parentURL ? fileURLToPath(context.parentURL) : path.join(root, "x");
      const target = path.resolve(path.dirname(parent), specifier);
      if (existsSync(target)) return resolved(target, context);
    }
  }

  return nextResolve(specifier, context);
}
