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
import { existsSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { transformSync } from "esbuild";

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

// Next.js runtime boundaries that don't exist under `node --test`. We stub only
// the framework edge (never app logic) so engines that transitively import
// `next/headers` (via supabase/server) can load for their PURE exports.
const STUBS = {
  "next/headers": path.join(root, "tests", "_lib", "stubs", "next-headers.mjs"),
};

// Bare package subpaths with no "exports" map (like next's, at least for
// /server) hit a resolution gap once ANY loader hook is registered: Node's
// default resolver normally CJS-style probes ".js"/index files for these,
// but that probing doesn't kick in through a custom `resolve` hook chain,
// so `import("next/server")` fails with ERR_MODULE_NOT_FOUND even though the
// real file exists — Node's own error suggests the fix ("Did you mean to
// import next/server.js?"). Resolve the handful this test suite needs by
// explicit extension so real behavioral tests can `mock.module()` them
// (next/headers instead gets a full request-context-free stub above, since
// its real implementation needs an active Next.js request).
const EXTENSION_PROBE = new Set(["next/server"]);

export async function resolve(specifier, context, nextResolve) {
  if (STUBS[specifier]) {
    return { url: pathToFileURL(STUBS[specifier]).href, shortCircuit: true };
  }

  if (EXTENSION_PROBE.has(specifier)) {
    return nextResolve(`${specifier}.js`, context);
  }

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

/**
 * `.tsx` files are unsupported by Node's native type stripping (JSX is not
 * "erasable" TypeScript syntax) — see https://nodejs.org/api/typescript.html.
 * Golden tests that exercise the real @react-pdf/renderer template
 * (report-pdf.tsx / report-pdf-document.tsx) need it, so transform just
 * those files with esbuild (already a devDependency-free, no-native-addon
 * bundler) instead of pulling in a full test framework. Every other
 * extension keeps Node's default load behavior (native `.ts` stripping).
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith(".tsx")) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    const { code } = transformSync(source, {
      loader: "tsx",
      format: "esm",
      target: "node22",
      sourcefile: url,
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
