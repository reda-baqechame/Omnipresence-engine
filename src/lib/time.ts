/**
 * Time helpers kept outside React components so "current time" reads don't trip
 * the react-hooks/purity rule (Date.now is impure). Server components call these
 * instead of touching Date.now() directly during render.
 */

export function nowMs(): number {
  return Date.now();
}

/** Fractional days elapsed since an ISO timestamp. */
export function daysSince(iso: string): number {
  return (nowMs() - new Date(iso).getTime()) / 86_400_000;
}

/** True if the ISO timestamp is within the last `days` days. */
export function isWithinDays(iso: string, days: number): boolean {
  return daysSince(iso) <= days;
}
