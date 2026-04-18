const explicitApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim();

function defaultApiBaseUrl(): string {
  // Prefer same-origin by default. In local dev, Vite proxies /v1 -> API.
  return "";
}

export const API_BASE_URL = (explicitApiBaseUrl || defaultApiBaseUrl()).replace(/\/+$/, "");
