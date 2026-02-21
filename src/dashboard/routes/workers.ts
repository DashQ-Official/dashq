import type { FastifyInstance } from "fastify";
import type { DatabaseAdapter } from "../../db/adapter.js";

const VALID_STATUSES = new Set(["active", "stopped"]);

export async function workerRoutes(
  fastify: FastifyInstance,
  opts: { adapter: DatabaseAdapter },
): Promise<void> {
  const { adapter } = opts;

  fastify.get("/workers", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const status = query.status;

    if (status !== undefined && !VALID_STATUSES.has(status)) {
      return reply.status(400).send({
        error: `Invalid status. Must be one of: active, stopped`,
        statusCode: 400,
      });
    }

    const workers = await adapter.listWorkers(
      status as "active" | "stopped" | undefined,
    );
    return { workers };
  });

  fastify.get("/workers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const worker = await adapter.getWorker(id);

    if (!worker) {
      return reply.status(404).send({
        error: "Worker not found",
        statusCode: 404,
      });
    }

    return { worker };
  });

  fastify.get("/workers/:id/jobs", async (request, reply) => {
    const { id } = request.params as { id: string };
    const worker = await adapter.getWorker(id);

    if (!worker) {
      return reply.status(404).send({
        error: "Worker not found",
        statusCode: 404,
      });
    }

    const result = await adapter.listJobs({
      status: "running",
      worker_id: id,
    });

    return { jobs: result.jobs, total: result.total };
  });
}
