/**
 * When true (default), all features are unlocked with no project or API credit limits.
 * Set FREE_ACCESS_MODE=false in env to re-enable plan gating later.
 */
export const FREE_ACCESS_MODE = process.env.FREE_ACCESS_MODE !== "false";

export const UNLIMITED_API_CREDITS = 9_999_999;
export const DEFAULT_PROMPT_GENERATION_LIMIT = 500;
export const DEFAULT_VISIBILITY_SCAN_LIMIT = 150;
