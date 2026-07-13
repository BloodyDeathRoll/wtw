// fetch with a hard timeout via AbortController.
//
// Callers that await a fetch inside a try/finally to clear a loading flag rely
// on the promise always SETTLING — a request that hangs forever (e.g. a stalled
// LLM call behind an API route with no server-side timeout) would otherwise
// leave that flag stuck. The abort guarantees the promise rejects, so `finally`
// always runs. See WTWApp's "Reading your taste…" loader.
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  ms = 45000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
