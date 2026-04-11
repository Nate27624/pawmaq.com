const explicitApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim();

function defaultApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return "http://localhost:3000";
  }
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const hostname = window.location.hostname || "localhost";
  return `${protocol}//${hostname}:3000`;
}

export const API_BASE_URL = (explicitApiBaseUrl || defaultApiBaseUrl()).replace(/\/+$/, "");
