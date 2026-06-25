export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logProductionWarnings } = await import("@/lib/config/production-startup");
    logProductionWarnings();
  }
}
