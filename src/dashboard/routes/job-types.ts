import type { FastifyInstance } from "fastify";
import { getAllJobTypes } from "../../core/registry.js";

export async function jobTypeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/job-types", async () => {
    const job_types = getAllJobTypes();
    return { job_types };
  });
}
