const SECRET_VALUE = /(authorization|apikey|api_key|token|secret|service[_-]?role)\s*[:=]\s*([^\s,;}]+)/gi;
const BEARER_VALUE = /bearer\s+[a-z0-9._~+/=-]+/gi;
const LONG_CREDENTIAL = /\b[a-z0-9_-]{80,}\b/gi;

export function sanitizeMonitorMessage(value) {
  const raw = value instanceof Error ? value.message : String(value ?? "operation_failed");
  return raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(BEARER_VALUE, "Bearer [redacted]")
    .replace(SECRET_VALUE, "$1=[redacted]")
    .replace(LONG_CREDENTIAL, "[redacted]")
    .trim()
    .slice(0, 240) || "operation_failed";
}

export class MonitorStepError extends Error {
  constructor(step, cause) {
    super(sanitizeMonitorMessage(cause));
    this.name = "MonitorStepError";
    this.step = step;
  }
}

export async function requireMonitorResult(step, operation) {
  try {
    const result = await operation();
    if (result?.error) throw result.error;
    return result?.data;
  } catch (error) {
    if (error instanceof MonitorStepError) throw error;
    throw new MonitorStepError(step, error);
  }
}

export function isMonitorAuthorized(secret, monitorSecret, dispatchSecret, serviceKey) {
  return Boolean(
    (monitorSecret && (secret === monitorSecret || secret === `Bearer ${monitorSecret}`)) ||
    (dispatchSecret && (secret === dispatchSecret || secret === `Bearer ${dispatchSecret}`)) ||
    (serviceKey && secret === `Bearer ${serviceKey}`),
  );
}

export function monitorHttpResult(error, results = {}) {
  if (!error) return { status: 200, body: { success: true, results } };
  const failure = error instanceof MonitorStepError
    ? error
    : new MonitorStepError("monitor_cycle", error);
  return {
    status: 500,
    body: {
      success: false,
      error: { step: failure.step, message: sanitizeMonitorMessage(failure) },
      results,
    },
  };
}
