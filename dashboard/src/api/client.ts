// ---------------------------------------------------------------------------
// Types (mirrors backend src/types.ts)
// ---------------------------------------------------------------------------

export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type LogLevel = "info" | "warn" | "error";

export type Job = {
  id: string;
  job_type: string;
  args: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_at: string;
  locked_until: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type JobLog = {
  id: string;
  job_id: string;
  attempt: number;
  level: LogLevel;
  message: string;
  timestamp: string;
};

export type OverviewCounts = Record<JobStatus, number>;

export type JobFilter = {
  status?: JobStatus;
  job_type?: string;
  offset?: number;
  limit?: number;
  sort_by?: "created_at" | "updated_at" | "run_at";
  sort_order?: "asc" | "desc";
};

// ---------------------------------------------------------------------------
// Base path resolution
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __DASHQ_BASE_PATH__?: string;
  }
}

function resolveBasePath(): string {
  // Injected by Fastify at serve-time
  if (window.__DASHQ_BASE_PATH__) {
    return window.__DASHQ_BASE_PATH__.replace(/\/$/, "");
  }
  // Infer from current URL (works in dev & production)
  const path = window.location.pathname.replace(/\/$/, "");
  // Strip known SPA routes to get base
  const cleaned = path
    .replace(/\/jobs\/[^/]+$/, "")
    .replace(/\/jobs$/, "");
  return cleaned || "/dashq";
}

let _basePath: string | null = null;

export function basePath(): string {
  if (_basePath === null) {
    _basePath = resolveBasePath();
  }
  return _basePath;
}

// ---------------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${basePath()}/api${endpoint}`;
  const response = await fetch(url, options);

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      (body as { error?: string }).error ?? "API request failed",
      response.status,
    );
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

export const api = {
  getOverview() {
    return fetchApi<{ counts: OverviewCounts }>("/overview");
  },

  getJobs(params: JobFilter = {}) {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.job_type) qs.set("job_type", params.job_type);
    if (params.offset !== undefined) qs.set("offset", String(params.offset));
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.sort_by) qs.set("sort_by", params.sort_by);
    if (params.sort_order) qs.set("sort_order", params.sort_order);
    const q = qs.toString();
    return fetchApi<{ jobs: Job[]; total: number }>(`/jobs${q ? `?${q}` : ""}`);
  },

  getJob(id: string) {
    return fetchApi<{ job: Job }>(`/jobs/${id}`);
  },

  getJobLogs(id: string, attempt?: number) {
    const qs = attempt !== undefined ? `?attempt=${attempt}` : "";
    return fetchApi<{ logs: JobLog[] }>(`/jobs/${id}/logs${qs}`);
  },

  getJobTypes() {
    return fetchApi<{ job_types: string[] }>("/job-types");
  },

  retryJob(id: string) {
    return fetchApi<{ job: Job }>(`/jobs/${id}/retry`, { method: "POST" });
  },

  requeueJob(id: string) {
    return fetchApi<{ job: Job }>(`/jobs/${id}/requeue`, { method: "POST" });
  },

  deleteJob(id: string) {
    return fetchApi<void>(`/jobs/${id}`, { method: "DELETE" });
  },
};
