import { NextResponse } from "next/server";
import { getCapabilitiesSummary } from "@/lib/config/capabilities";
import { getProductionReadiness } from "@/lib/config/production";

export async function GET() {
  return NextResponse.json({
    ...getCapabilitiesSummary(),
    production: getProductionReadiness(),
  });
}
