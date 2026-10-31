// Small typed wrapper around fetch for the Express API.
// - Cookies carry the session (httpOnly, never readable here).
// - Every state-changing request sends the CSRF token in a header.

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
  get code(): string | undefined {
    return (this.details as { code?: string } | undefined)?.code;
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (token: string | null) => {
  csrfToken = token;
};

type Listener = (error: ApiError) => void;
const authListeners = new Set<Listener>();
/** Notified when the server says the session is gone (401) or a password change is required. */
export const onAuthProblem = (listener: Listener) => {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
};

type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: Query) {
  const url = new URL(`/api${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.pathname + url.search;
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check that the API is running.");
  }

  const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const error = new ApiError(response.status, data?.error ?? `Request failed (${response.status})`, data?.details);
    const isLoginCall = path === "/auth/login";
    if (!isLoginCall && (response.status === 401 || error.code === "PASSWORD_CHANGE_REQUIRED")) {
      authListeners.forEach((listener) => listener(error));
    }
    throw error;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>("GET", path, undefined, query),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
