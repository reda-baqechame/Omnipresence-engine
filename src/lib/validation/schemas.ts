import { z } from "zod";

/**
 * Input-validation schemas for hot authenticated API routes (production
 * hardening). Kept dependency-free (only `zod`) so they can be unit-tested
 * directly with `node --test`. Route handlers call `parseOrError` and return a
 * clean 400 instead of letting malformed input reach the engines/DB.
 */

/** Pure parse helper: returns either the typed data or a flat error message. */
export function parseOrError<T>(
  schema: z.ZodType<T>,
  data: unknown
): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  const first = result.error.issues[0];
  const path = first?.path?.length ? `${first.path.join(".")}: ` : "";
  return { ok: false, error: `${path}${first?.message || "invalid input"}` };
}

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1);

/** Known SLA risk levels for queued ops. */
export const RISK_LEVELS = ["low", "medium", "high"] as const;

/** Mutable ops-queue statuses a client is allowed to set via PATCH. */
export const OPS_PATCH_STATUSES = ["approved", "rejected", "pending", "cancelled"] as const;

export const OpsCreateSchema = z.object({
  projectId: uuid,
  organizationId: uuid,
  // actionType is dispatched by the executor (unknown types fail cleanly), so we
  // only enforce it's a bounded non-empty string here — not a brittle enum that
  // would reject newly-added runners.
  actionType: nonEmpty.max(64),
  title: nonEmpty.max(300),
  payload: z.record(z.string(), z.unknown()).optional(),
  riskLevel: z.enum(RISK_LEVELS).optional(),
  taskId: uuid.optional(),
});
export type OpsCreateInput = z.infer<typeof OpsCreateSchema>;

export const OpsPatchSchema = z
  .object({
    id: uuid,
    status: z.enum(OPS_PATCH_STATUSES).optional(),
    assignedTo: uuid.optional(),
    execute: z.boolean().optional(),
  })
  .refine((b) => b.status !== undefined || b.assignedTo !== undefined || b.execute !== undefined, {
    message: "no mutation supplied (status, assignedTo, or execute required)",
  });
export type OpsPatchInput = z.infer<typeof OpsPatchSchema>;

/** Project-scoped action triggers (fastest-path sync, etc.). */
export const ProjectIdSchema = z.object({ projectId: uuid });

/** Keyword research request. */
export const KeywordsSchema = z.object({
  projectId: uuid,
  seeds: z.array(nonEmpty.max(200)).max(200).optional(),
  geo: z.string().trim().max(64).optional(),
});
