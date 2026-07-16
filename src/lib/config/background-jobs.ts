/**
 * When true, Inngest registers only user-initiated event handlers (scans,
 * reports, panels, ops, geo rewrite, attribution sync). All cron schedules and
 * automatic follow-ups (e.g. asset/deployed reprobe) are disabled so paid APIs
 * are only hit when someone clicks a button in the app.
 *
 * Set MANUAL_ONLY_MODE=true on Vercel/Railway to stop idle API spend.
 */
export const MANUAL_ONLY_MODE = process.env.MANUAL_ONLY_MODE === "true";
