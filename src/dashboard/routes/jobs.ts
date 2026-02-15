import type { FastifyInstance } from "fastify";
import type { DatabaseAdapter } from "../../db/adapter.js";
import type { JobStatus, JobFilter } from "../../types.js";

const VALID_STATUSES = new Set<string>(["queued", "running", "succeeded", "failed"]);
const VALID_SORT_BY = new Set<string>(["created_at", "updated_at", "run_at"]);
const VALID_SORT_ORDER = new Set<string>(["asc", "desc"]);

export async function jobRoutes(
  fastify: FastifyInstance,
  opts: { adapter: DatabaseAdapter },
): Promise<void> {
  const { adapter } = opts;

  // GET /jobs — Paginated listing with filters
  fastify.get("/jobs", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;

    const status = query.status;
    const job_type = query.job_type;
    const offset = query.offset !== undefined ? Number(query.offset) : undefined;
    const limit = query.limit !== undefined ? Number(query.limit) : undefined;
    const sort_by = query.sort_by;
    const sort_order = query.sort_order;

    // Validate
    if (status !== undefined && !VALID_STATUSES.has(status)) {
      return reply.status(400).send({
        error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(", ")}`,
        statusCode: 400,
      });
    }

    if (offset !== undefined && (isNaN(offset) || offset < 0 || !Number.isInteger(offset))) {
      return reply.status(400).send({
        error: "offset must be a non-negative integer",
        statusCode: 400,
      });
    }

    if (limit !== undefined && (isNaN(limit) || limit < 1 || !Number.isInteger(limit))) {
      return reply.status(400).send({
        error: "limit must be a positive integer",
        statusCode: 400,
      });
    }

    if (sort_by !== undefined && !VALID_SORT_BY.has(sort_by)) {
      return reply.status(400).send({
        error: `Invalid sort_by. Must be one of: ${[...VALID_SORT_BY].join(", ")}`,
        statusCode: 400,
      });
    }

    if (sort_order !== undefined && !VALID_SORT_ORDER.has(sort_order)) {
      return reply.status(400).send({
        error: `Invalid sort_order. Must be one of: ${[...VALID_SORT_ORDER].join(", ")}`,
        statusCode: 400,
      });
    }

    const filter: JobFilter = {
      status: status as JobStatus | undefined,
      job_type,
      offset,
      limit,
      sort_by: sort_by as JobFilter["sort_by"],
      sort_order: sort_order as JobFilter["sort_order"],
    };

    const result = await adapter.listJobs(filter);
    return { jobs: result.jobs, total: result.total };
  });

  // GET /jobs/:id — Single job detail
  fastify.get("/jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await adapter.getJob(id);

    if (!job) {
      return reply.status(404).send({ error: "Job not found", statusCode: 404 });
    }

    return { job };
  });

  // POST /jobs/:id/retry — Reset failed job to queued
  fastify.post("/jobs/:id/retry", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await adapter.getJob(id);

    if (!job) {
      return reply.status(404).send({ error: "Job not found", statusCode: 404 });
    }

    if (job.status !== "failed") {
      return reply.status(400).send({
        error: "Only failed jobs can be retried",
        statusCode: 400,
      });
    }

    const updated = await adapter.updateJob(id, {
      status: "queued",
      attempts: 0,
      run_at: new Date().toISOString(),
      locked_until: null,
      last_error: null,
    });

    return { job: updated };
  });

  // POST /jobs/:id/requeue — Create new job copy
  fastify.post("/jobs/:id/requeue", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await adapter.getJob(id);

    if (!job) {
      return reply.status(404).send({ error: "Job not found", statusCode: 404 });
    }

    const newJob = await adapter.insertJob({
      job_type: job.job_type,
      args: job.args,
      max_attempts: job.max_attempts,
    });

    return reply.status(201).send({ job: newJob });
  });

  // DELETE /jobs/:id — Delete job + logs
  fastify.delete("/jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await adapter.getJob(id);

    if (!job) {
      return reply.status(404).send({ error: "Job not found", statusCode: 404 });
    }

    if (job.status === "running") {
      return reply.status(400).send({
        error: "Cannot delete a running job",
        statusCode: 400,
      });
    }

    await adapter.deleteJob(id);
    return reply.status(204).send();
  });
}
