import { apiError } from "@/lib/security/api-response";
import { FREE_ACCESS_MODE } from "@/lib/config/access";

export async function POST() {
  if (FREE_ACCESS_MODE) {
    return apiError("Billing is disabled — all features are currently free.", 410);
  }
  return apiError("Billing not configured", 503);
}
