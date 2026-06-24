import { NextResponse } from "next/server";
import { getCapabilitiesSummary } from "@/lib/config/capabilities";

export async function GET() {
  return NextResponse.json(getCapabilitiesSummary());
}
