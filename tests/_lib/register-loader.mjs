/**
 * Registers the `@/` + extensionless TS resolver hook for `node --test`.
 * Use: node --import ./tests/_lib/register-loader.mjs --test <files...>
 */
import { register } from "node:module";
register("./ts-alias-loader.mjs", import.meta.url);
