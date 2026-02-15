import type { FastifyInstance } from "fastify";
import type { DatabaseAdapter } from "../../db/adapter.js";

export async function jobLogRoutes(
  fastify: FastifyInstance,
  opts: { adapter: DatabaseAdapter },
): Promise<void> {
  const { adapter } = opts;

  // GET /jobs/:id/logs — Job logs, optional ?attempt=N
  fastify.get("/jobs/:id/logs", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string | undefined>;

    const job = await adapter.getJob(id);
    if (!job) {
      return reply.status(404).send({ error: "Job not found", statusCode: 404 });
    }

    let attempt: number | undefined;
    if (query.attempt !== undefined) {
      attempt = Number(query.attempt);
      if (isNaN(attempt) || !Number.isInteger(attempt) || attempt < 0) {
        return reply.status(400).send({
          error: "attempt must be a non-negative integer",
          statusCode: 400,
        });
      }
    }

    const logs = await adapter.getJobLogs(id, attempt);
    return { logs };
  });
}
