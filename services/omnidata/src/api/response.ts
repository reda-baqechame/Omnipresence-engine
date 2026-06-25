/** DataForSEO-compatible response envelope so the app can swap providers 1:1. */
export function dfsResponse(tasks: unknown[], status = 20000) {
  return {
    version: "0.1.20240624",
    status_code: status,
    status_message: status === 20000 ? "Ok." : "Error.",
    time: new Date().toISOString(),
    cost: 0,
    tasks_count: tasks.length,
    tasks_error: status === 20000 ? 0 : tasks.length,
    tasks,
  };
}
