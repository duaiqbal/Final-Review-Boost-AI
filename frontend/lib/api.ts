// ReviewBoost AI — Backend API client (TypeScript)
// All HTTP traffic between the frontend and the FastAPI backend goes through this file.

const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ||
  "https://review-boost-ai-backend-production.up.railway.app"
)
  .trim()
  .replace(/\/+$/, "")
  // Guard against a common config mistake: pasting the Swagger UI address (".../docs").
  .replace(/\/docs$/, "");

export const API_BASE = API_URL;

// ---- Token management ----
function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem("rb_admin_token");
  } catch {
    return null;
  }
}

function setToken(token: string): void {
  try {
    sessionStorage.setItem("rb_admin_token", token);
  } catch {
    /* ignore */
  }
}

function clearToken(): void {
  try {
    sessionStorage.removeItem("rb_admin_token");
  } catch {
    /* ignore */
  }
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

// ---- Errors ----
export const NETWORK_ERROR_MESSAGE =
  "Cannot reach the server. Please check your internet and try again.";

/** Single error type thrown by every API call. status 0 = network failure or abort. */
export class APIError extends Error {
  readonly status: number;
  readonly code: string;
  readonly missing: string[];

  constructor(message: string, status: number, code: string, missing: string[] = []) {
    super(message);
    this.name = "APIError";
    this.status = status;
    this.code = code;
    this.missing = missing;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof APIError && err.code === "aborted";
}

export function getErrorMessage(err: unknown): string {
  return err instanceof APIError ? err.message : "Something went wrong.";
}

type ErrorDetail =
  | string
  | { code?: string; message?: string; missing?: string[] }
  | { msg: string; loc?: (string | number)[] }[]
  | undefined;

function parseDetail(detail: ErrorDetail): { message: string; code: string; missing: string[] } {
  if (typeof detail === "string") return { message: detail, code: "error", missing: [] };
  if (Array.isArray(detail)) {
    // FastAPI/Pydantic 422: [{ loc, msg }]
    const message = detail
      .map((e) => {
        const field = e.loc?.filter((x) => x !== "body").join(".");
        return field ? `${field}: ${e.msg}` : e.msg;
      })
      .join("; ");
    return { message: message || "Invalid input.", code: "validation_error", missing: [] };
  }
  return {
    message: detail?.message || "Something went wrong.",
    code: detail?.code || "error",
    missing: detail?.missing || [],
  };
}

// ---- Core request helper ----
type RequestOptions = {
  method?: string;
  body?: unknown;
  admin?: boolean;
  signal?: AbortSignal;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.admin) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch {
    if (options.signal?.aborted) throw new APIError("Request cancelled.", 0, "aborted");
    throw new APIError(NETWORK_ERROR_MESSAGE, 0, "network");
  }

  if (res.status === 204) return null as T;

  const data: { detail?: ErrorDetail } = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { message, code, missing } = parseDetail(data.detail);
    throw new APIError(message, res.status, code, missing);
  }
  return data as T;
}

// ---- Types (matching backend models) ----
export type BackendCategory = {
  id: string;
  name: string;
  description: string;
  required: boolean;
};

export type BackendRatingOption = {
  label: string;
  score: number;
};

export type BackendBusiness = {
  id: string;
  name: string;
  business_type: string;
  logo_url: string | null;
  brand_color: string;
  welcome_message: string;
  status: "active" | "inactive";
  review_destination_url: string | null;
  categories: BackendCategory[];
  rating_options: BackendRatingOption[];
  created_at: string;
  updated_at: string;
  customer_url: string;
  qr_png_url: string;
};

export type PublicBusiness = Omit<
  BackendBusiness,
  "customer_url" | "qr_png_url" | "status" | "created_at" | "updated_at"
>;

export type Template = {
  key: string;
  label: string;
  categories: { name: string; description: string; required: boolean }[];
  rating_options: BackendRatingOption[];
};

export type DashboardStats = {
  total_businesses: number;
  active_businesses: number;
  total_visits: number;
  drafts_generated: number;
  copy_and_open_clicks: number;
  per_business: {
    id: string;
    name: string;
    status: string;
    visits: number;
    drafts_generated: number;
    copy_and_open_clicks: number;
  }[];
  recent_activity: {
    event_type: string;
    created_at: string;
    business_name: string;
  }[];
  note: string;
};

export type GenerateReviewResult = {
  review: string;
  source: "ai" | "fallback";
  fallback_reason: string | null;
  warnings: string[];
  disclaimer: string;
};

// ---- Admin API ----
export async function adminLogin(
  password: string
): Promise<{ token: string; expires_in_hours: number }> {
  const data = await request<{ token: string; expires_in_hours: number }>(
    "/api/admin/login",
    { method: "POST", body: { password } }
  );
  setToken(data.token);
  return data;
}

export function adminLogout(): void {
  clearToken();
}

export const getDashboard = (signal?: AbortSignal): Promise<DashboardStats> =>
  request<DashboardStats>("/api/admin/dashboard", { admin: true, signal });

export const getTemplates = (signal?: AbortSignal): Promise<Template[]> =>
  request<Template[]>("/api/admin/templates", { admin: true, signal });

export const listBusinesses = (signal?: AbortSignal): Promise<BackendBusiness[]> =>
  request<BackendBusiness[]>("/api/admin/businesses", { admin: true, signal });

export const getBusiness = (id: string, signal?: AbortSignal): Promise<BackendBusiness> =>
  request<BackendBusiness>(`/api/admin/businesses/${id}`, { admin: true, signal });

export type BusinessInput = {
  name: string;
  business_type: string;
  logo_url: string | null;
  brand_color: string;
  welcome_message: string;
  status: "active" | "inactive";
  review_destination_url: string | null;
  categories: {
    id?: string;
    name: string;
    description: string;
    required: boolean;
  }[];
  rating_options: { label: string; score: number }[];
};

export function createBusiness(b: BusinessInput): Promise<BackendBusiness> {
  return request<BackendBusiness>("/api/admin/businesses", {
    method: "POST",
    body: b,
    admin: true,
  });
}

export function updateBusiness(id: string, b: BusinessInput): Promise<BackendBusiness> {
  return request<BackendBusiness>(`/api/admin/businesses/${id}`, {
    method: "PUT",
    body: b,
    admin: true,
  });
}

export function setBusinessStatus(
  id: string,
  status: "active" | "inactive"
): Promise<BackendBusiness> {
  return request<BackendBusiness>(`/api/admin/businesses/${id}/status`, {
    method: "PATCH",
    body: { status },
    admin: true,
  });
}

export function deleteBusiness(id: string): Promise<null> {
  return request<null>(`/api/admin/businesses/${id}`, {
    method: "DELETE",
    admin: true,
  });
}

export function qrUrl(id: string, download = false): string {
  return `${API_URL}/api/qr/${id}.png${download ? "?download=true" : ""}`;
}

// ---- Customer (public) API ----
export function getPublicBusiness(
  id: string,
  preview = false,
  signal?: AbortSignal
): Promise<PublicBusiness> {
  return request<PublicBusiness>(
    `/api/public/business/${encodeURIComponent(id)}${preview ? "?preview=true" : ""}`,
    { signal }
  );
}

export function generateReview(
  id: string,
  answers: { category_id: string; rating: string }[],
  comment: string,
  regenerate = false
): Promise<GenerateReviewResult> {
  return request<GenerateReviewResult>(
    `/api/public/business/${id}/generate-review`,
    { method: "POST", body: { answers, comment, regenerate } }
  );
}

export function trackCopyAndOpen(id: string): Promise<null> {
  return request<null>(`/api/public/business/${id}/events`, {
    method: "POST",
    body: { event: "copy_and_open_clicked" },
  });
}

export const DEFAULT_RATING_OPTIONS: BackendRatingOption[] = [
  { label: "Excellent", score: 4 },
  { label: "Good", score: 3 },
  { label: "Average", score: 2 },
  { label: "Needs improvement", score: 1 },
];