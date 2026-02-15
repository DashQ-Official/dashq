import type { FastifyInstance } from "fastify";
import type { DatabaseAdapter } from "../../db/adapter.js";

export async function overviewRoutes(
  fastify: FastifyInstance,
  opts: { adapter: DatabaseAdapter },
): Promise<void> {
  const { adapter } = opts;

  fastify.get("/overview", async () => {
    const counts = await adapter.getJobCounts();
    return { counts };
  });
}
