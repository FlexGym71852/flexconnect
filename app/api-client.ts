"use client";

export type ApiConfig = { baseUrl: string; adminToken: string };

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
const builtInBaseUrl = env?.VITE_FLEX_API_BASE_URL?.trim().replace(/\/$/, "") || "";
export const isGitHubPagesBuild = env?.VITE_GITHUB_PAGES === "true";
const storageKey = "flex-connect-api";

export function getApiConfig(): ApiConfig {
  const fallback = { baseUrl: builtInBaseUrl, adminToken: "" };
  if (typeof window === "undefined") return fallback;
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) || "{}") as Partial<ApiConfig>;
    return { baseUrl: stored.baseUrl?.trim().replace(/\/$/, "") || fallback.baseUrl, adminToken: stored.adminToken || "" };
  } catch { return fallback; }
}

export function saveApiConfig(config: ApiConfig) {
  const normalized = { baseUrl: config.baseUrl.trim().replace(/\/$/, ""), adminToken: config.adminToken.trim() };
  window.localStorage.setItem(storageKey, JSON.stringify(normalized));
  return normalized;
}

export function hasExternalApi() {
  return Boolean(getApiConfig().baseUrl);
}

function remoteApiPath(path: string) {
  const config = getApiConfig();
  if (!config.baseUrl) return path;
  const suffix = path.startsWith("/api/") ? path.slice(4) : path;
  return `${config.baseUrl}/api/remote${suffix}`;
}

export function publicAppUrl(path: string) {
  const baseUrl = getApiConfig().baseUrl;
  return baseUrl ? `${baseUrl}${path}` : path;
}

export function apiFetch(path: string, init: RequestInit = {}) {
  const config = getApiConfig();
  const headers = new Headers(init.headers);
  if (config.adminToken) headers.set("x-flex-admin-token", config.adminToken);
  return fetch(remoteApiPath(path), { ...init, headers });
}
