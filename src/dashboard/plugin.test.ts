import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { createDashboardPlugin } from "./plugin.js";
import type { DatabaseAdapter } from "../db/adapter.js";
import type { Job, JobLog, JobStatus } from "../types.js";
import * as registry from "../core/registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "01912345-6789-7abc-def0-123456789abc",
    job_type: "email.send",
    args: '{"to":"user@test.com"}',
    status: "queued",
    attempts: 0,
    max_attempts: 3,
    run_at: "2025-01-01T00:00:00.000Z",
    locked_until: null,
    last_error: null,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeLog(overrides: Partial<JobLog> = {}): JobLog {
  return {
    id: "01912345-0000-7abc-def0-000000000001",
    job_id: "01912345-6789-7abc-def0-123456789abc",
    attempt: 1,
    level: "info",
    message: "Processing started",
    timestamp: "2025-01-01T00:00:01.000Z",
    ...overrides,
  };
}

function mockAdapter(overrides: Partial<DatabaseAdapter> = {}): DatabaseAdapter {
  return {
    initialize: vi.fn(),
    close: vi.fn(),
    insertJob: vi.fn(),
    getJob: vi.fn(),
    listJobs: vi.fn(),
    updateJob: vi.fn(),
    deleteJob: vi.fn(),
    claimNextJob: vi.fn(),
    markSucceeded: vi.fn(),
    markFailed: vi.fn(),
    requeueJob: vi.fn(),
    recoverStaleJobs: vi.fn(),
    insertLog: vi.fn(),
    insertLogs: vi.fn(),
    getJobLogs: vi.fn(),
    getJobCounts: vi.fn(),
    deleteOldJobs: vi.fn(),
    deleteOldLogs: vi.fn(),
    ...overrides,
  } as DatabaseAdapter;
}

async function buildApp(
  adapter: DatabaseAdapter,
  basePath?: string,
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(createDashboardPlugin, { adapter, basePath });
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dashboard API", () => {
  beforeEach(() => {
    registry.clear();
  });

  // -------------------------------------------------------------------------
  // Overview
  // -------------------------------------------------------------------------

  describe("GET /dashq/api/overview", () => {
    it("returns job counts by status", async () => {
      const counts: Record<JobStatus, number> = {
        queued: 5,
        running: 2,
        succeeded: 100,
        failed: 3,
      };
      const adapter = mockAdapter({
        getJobCounts: vi.fn().mockResolvedValue(counts),
      });
      const app = await buildApp(adapter);

      const res = await app.inject({ method: "GET", url: "/dashq/api/overview" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ counts });
    });
  });

  // -------------------------------------------------------------------------
  // Jobs List
  // -------------------------------------------------------------------------

  describe("GET /dashq/api/jobs", () => {
    it("returns an empty job list", async () => {
      const adapter = mockAdapter({
        listJobs: vi.fn().mockResolvedValue({ jobs: [], total: 0 }),
      });
      const app = await buildApp(adapter);

      const res = await app.inject({ method: "GET", url: "/dashq/api/jobs" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ jobs: [], total: 0 });
    });

    it("passes filter params to the adapter", async () => {
      const adapter = mockAdapter({
        listJobs: vi.fn().mockResolvedValue({ jobs: [], total: 0 }),
      });
      const app = await buildApp(adapter);

      await app.inject({
        method: "GET",
        url: "/dashq/api/jobs?status=failed&job_type=email.send&offset=10&limit=5&sort_by=updated_at&sort_order=asc",
      });

      expect(adapter.listJobs).toHaveBeenCalledWith({
        status: "failed",
        job_type: "email.send",
        offset: 10,
        limit: 5,
        sort_by: "updated_at",
        sort_order: "asc",
      });
    });

    it("returns 400 for invalid status", async () => {
      const adapter = mockAdapter();
      const app = await buildApp(adapter);

      const res = await app.inject({
        method: "GET",
        url: "/dashq/api/jobs?status=invalid",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Invalid status");
    });

    it("returns 400 for invalid offset", async () => {
      const adapter = mockAdapter();
      const app = await buildApp(adapter);

      const res = await app.inject({
        method: "GET",
        url: "/dashq/api/jobs?offset=-1",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("offset");
    });

    it("returns 400 for invalid limit", async () => {
      const adapter = mockAdapter();
      const app = await buildApp(adapter);

      const res = await app.inject({
        method: "GET",
        url: "/dashq/api/jobs?limit=0",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("limit");
    });

    it("returns 400 for invalid sort_by", async () => {
      const adapter = mockAdapter();
      const app = await buildApp(adapter);

      const res = await app.inject({
        method: "GET",
        url: "/dashq/api/jobs?sort_by=invalid",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Invalid sort_by");
    });

    it("returns 400 for invalid sort_order", async () => {
      const adapter = mockAdapter();
      const app = await buildApp(adapter);

      const res = await app.inject({
        method: "GET",
        url: "/dashq/api/jobs?sort_order=up",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Invalid sort_order");
    });
  });

  // -------------------------------------------------------------------------
  // Job Detail
  // -------------------------------------------------------------------------

  describe("GET /dashq/api/jobs/:id", () => {
    it("returns a job when found", async () => {
      const job = makeJob();
      const adapter = mockAdapter({
        getJob: vi.fn().mockResolvedValue(job),
      });
      const app = await buildApp(adapter);

      const res = await app.inject({ method: "GET", url: `/dashq/api/jobs/${job.id}` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ job });
    });

    it("returns 404 when job not found", async () => {
      const adapter = mockAdapter({
        getJob: vi.fn().mockResolvedValue(null),
      });
      const app = await buildApp(adapter);

      const res = await app.inject({ method: "GET", url: "/dashq/api/jobs/nonexistent" });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Job not found", statusCode: 404 });
    });
  });

  // -------------------------------------------------------------------------
  // Job Logs
  // -------------------------------------------------------------------------

  describe("GET /dashq/api/jobs/:id/logs", () => {
    it("returns logs for a job", async () => {
      const job = makeJob();
      const logs = [makeLog(), makeLog({ id: "log-2", message: "Done" })];
      const adapter = mockAdapter({
        getJob: vi.fn().mockResolvedValue(job),
        getJobLogs: vi.fn().mockResolvedValue(logs),
      });
      const app = await buildApp(adapter);

      const res = await app.inject({ method: "GET", url: `/dashq/api/jobs/${job.id}/logs` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ logs });
      expect(adapter.getJobLogs).toHaveBeenCalledWith(job.id, undefined);
    });

    it("passes attempt filter to adapter", async () => {
      const job = makeJob();
      const adapter = mockAdapter({
        getJob: vi.fn().mockResolvedValue(job),
        getJobLogs: vi.fn().mockResolvedValue([]),
      });
      const app = await buildApp(adapter);

      await app.inject({
        method: "GET",
        url: `/dashq/api/jobs/${job.id}/logs?attempt=2`,
      });

      expect(adapter.getJobLogs).toHaveBeenCalledWith(job.id, 2);
    });

    it("returns 400 for invalid attempt value", async () => {
      const job = makeJob();
      const adapter = mockAdapter({
        getJob: vi.fn().mockResolvedValue(job),
      });
      const app = await buildApp(adapter);

      const res = await app.inject({
        method: "GET",
        url: `/dashq/api/jobs/${job.id}/logs?attempt=abc`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("attempt");
    });

    it("returns 404 when job not found", async () => {
      const adapter = mockAdapter({
        getJob: vi.fn().mockResolvedValue(null),
      });
      const app = await buildApp(adapter);

      const res = await app.inject({
        method: "GET",
        url: "/dashq/api/jobs/nonexistent/logs",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Job not found", statusCode: 404 });
    });
  });

  // -------------------------------------------------------------------------
  // Retry
  // -------------------------------------------------------------------------

  describe("POST /dashq/api/jobs/:id/retry", () => {
    it("resets a failed job to queued", async () => {
      const job = makeJob({ status: "failed", attempts: 3, last_error: "boom" });
      const updatedJob = makeJob({ status: "queued", attempts: 0, last_error: null });
      const adapter = mockAdapter({
        getJob: vi.fn().mockResolvedValue(job),
        updateJob: vi.fn().mockResolvedValue(updatedJob),
      });
      const app = await buildApp(adapter);

      const res = await app.inject({
        method: "POST",
        url: `/dashq/api/jobs/${job.id}/retry`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ job: updatedJob });
      expect(adapter.updateJob).toHaveBeenCalledWith(job.id, {
        status: "queued",
        attempts: 0,
        run_at: expect.any(String),
        locked_until: null,
        last_error: null,
      });
    });

    it("returns 404 when job not found", async () => {
      const adapter = mockAdapter({
        getJob: vi.fn().mockResolvedValue(null),
      });
      const app = await buildApp(adapter);

      const res = await app.inject({
        method: "POST",
        url: "/dashq/api/jobs/nonexistent/retry",
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 400 when job is not failed", async () => {
      const job = makeJob({ status: "queued" });
      const adapter = mockAdapter({
        getJob: vi.fn().mockResolvedValue(job),
      });
      const app = await buildApp(adapter);

      const res = await app.inject({
        method: "POST",
        url: `/dashq/api/jobs/${job.id}/retry`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Only failed jobs");
    });
  });

  // -------------------------------------------------------------------------
  // Requeue
  // -------------------------------------------------------------------------

  describe("POST /dashq/api/jobs/:id/requeue", () => {
    it("creates a new job copy with 201", async () => {
      const job = makeJob({ status: "succeeded" });
      const newJob = makeJob({ id: "new-id", status: "queued" });
      const adapter = mockAdapter({
        getJob: vi.fn().mockResolvedValue(job),
        insertJob: vi.fn().mockResolvedValue(newJob),
      });
      const app = await buildApp(adapter);

      const res = await app.inject({
        method: "POST",
        url: `/dashq/api/jobs/${job.id}/requeue`,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ job: newJob });
      expect(adapter.insertJob).toHaveBeenCalledWith({
        job_type: job.job_type,
        args: job.args,
        max_attempts: job.max_attempts,
      });
    });

    it("returns 404 when job not found", async () => {
      const adapter = mockAdapter({
        getJob: vi.fn().mockResolvedValue(null),
      });
      const app = await buildApp(adapter);

      const res = await app.inject({
        method: "POST",
        url: "/dashq/api/jobs/nonexistent/requeue",
      });

      expect(res.statusCode).toBe(404);
    });

    it("preserves max_attempts from original job", async () => {
      const job = makeJob({ max_attempts: 10 });
      const adapter = mockAdapter({
        getJob: vi.fn().mockResolvedValue(job),
        insertJob: vi.fn().mockResolvedValue(makeJob()),
      });
      const app = await buildApp(adapter);

      await app.inject({
        method: "POST",
        url: `/dashq/api/jobs/${job.id}/requeue`,
      });

      expect(adapter.insertJob).toHaveBeenCalledWith(
        expect.objectContaining({ max_attempts: 10 }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  describe("DELETE /dashq/api/jobs/:id", () => {
    it("deletes a job and returns 204", async () => {
      const job = makeJob({ status: "succeeded" });
      const adapter = mockAdapter({
        getJob: vi.fn().mockResolvedValue(job),
        deleteJob: vi.fn().mockResolvedValue(undefined),
      });
      const app = await buildApp(adapter);

      const res = await app.inject({
        method: "DELETE",
        url: `/dashq/api/jobs/${job.id}`,
      });

      expect(res.statusCode).toBe(204);
      expect(adapter.deleteJob).toHaveBeenCalledWith(job.id);
    });

    it("returns 404 when job not found", async () => {
      const adapter = mockAdapter({
        getJob: vi.fn().mockResolvedValue(null),
      });
      const app = await buildApp(adapter);

      const res = await app.inject({
        method: "DELETE",
        url: "/dashq/api/jobs/nonexistent",
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 400 when job is running", async () => {
      const job = makeJob({ status: "running" });
      const adapter = mockAdapter({
        getJob: vi.fn().mockResolvedValue(job),
      });
      const app = await buildApp(adapter);

      const res = await app.inject({
        method: "DELETE",
        url: `/dashq/api/jobs/${job.id}`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Cannot delete a running job");
    });
  });

  // -------------------------------------------------------------------------
  // Job Types
  // -------------------------------------------------------------------------

  describe("GET /dashq/api/job-types", () => {
    it("returns registered job types", async () => {
      registry.register("email.send", async () => {});
      registry.register("report.generate", async () => {});

      const adapter = mockAdapter();
      const app = await buildApp(adapter);

      const res = await app.inject({ method: "GET", url: "/dashq/api/job-types" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        job_types: ["email.send", "report.generate"],
      });
    });

    it("returns empty array when no types registered", async () => {
      const adapter = mockAdapter();
      const app = await buildApp(adapter);

      const res = await app.inject({ method: "GET", url: "/dashq/api/job-types" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ job_types: [] });
    });
  });

  // -------------------------------------------------------------------------
  // Custom basePath
  // -------------------------------------------------------------------------

  describe("custom basePath", () => {
    it("routes are accessible under custom prefix", async () => {
      const counts: Record<JobStatus, number> = {
        queued: 1,
        running: 0,
        succeeded: 0,
        failed: 0,
      };
      const adapter = mockAdapter({
        getJobCounts: vi.fn().mockResolvedValue(counts),
      });
      const app = await buildApp(adapter, "/admin/jobs");

      const res = await app.inject({ method: "GET", url: "/admin/jobs/api/overview" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ counts });
    });
  });

  // -------------------------------------------------------------------------
  // Error Handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("returns 500 with error shape when adapter throws", async () => {
      const adapter = mockAdapter({
        getJobCounts: vi.fn().mockRejectedValue(new Error("DB connection lost")),
      });
      const app = await buildApp(adapter);

      const res = await app.inject({ method: "GET", url: "/dashq/api/overview" });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({
        error: "Internal Server Error",
        statusCode: 500,
      });
    });
  });
});
