import paths from "../../../../shared/web-routing/paths.json";

export const BUSINESS_BASE_PATH = paths.businessBasePath;
export const BUSINESS_HOME_PATH = `${BUSINESS_BASE_PATH}/home`;

export function businessPath(path: string) {
  if (path === BUSINESS_BASE_PATH || path.startsWith(`${BUSINESS_BASE_PATH}/`)) return path;
  return `${BUSINESS_BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}

const privatePath = /^\/business\/(?:home|invitations|store|media|products(?:\/(?:shipping|[^/]+))?|orders(?:\/[^/]+)?|ads(?:\/(?:new|[^/]+))?|finance(?:\/payouts)?|analytics|team|settings)$/;

export function validateBusinessReturnTo(value: string | null | undefined, _origin: string = window.location.origin) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return BUSINESS_HOME_PATH;
  const [rawPath] = value.split(/[?#]/, 1);
  if (rawPath.includes("%") || !privatePath.test(rawPath)) return BUSINESS_HOME_PATH;
  try {
    const parsed = new URL(value, _origin);
    if (parsed.origin !== _origin || parsed.pathname !== rawPath) return BUSINESS_HOME_PATH;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return BUSINESS_HOME_PATH;
  }
}
