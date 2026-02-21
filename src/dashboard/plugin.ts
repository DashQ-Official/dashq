import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { DatabaseAdapter } from "../db/adapter.js";
import { overviewRoutes } from "./routes/overview.js";
import { jobRoutes } from "./routes/jobs.js";
import { jobLogRoutes } from "./routes/job-logs.js";
import { jobTypeRoutes } from "./routes/job-types.js";
import { workerRoutes } from "./routes/workers.js";

export type DashboardPluginOptions = {
  adapter: DatabaseAdapter;
  basePath?: string;
};

async function dashboardPlugin(
  fastify: FastifyInstance,
  opts: DashboardPluginOptions,
): Promise<void> {
  const { adapter, basePath = "/dashq" } = opts;
  const apiPrefix = `${basePath}/api`;

  // API routes (registered first — highest priority)
  fastify.register(overviewRoutes, { prefix: apiPrefix, adapter });
  fastify.register(jobRoutes, { prefix: apiPrefix, adapter });
  fastify.register(jobLogRoutes, { prefix: apiPrefix, adapter });
  fastify.register(jobTypeRoutes, { prefix: apiPrefix });
  fastify.register(workerRoutes, { prefix: apiPrefix, adapter });

  // Static file serving for the dashboard SPA
  const distDir = join(dirname(fileURLToPath(import.meta.url)), "dashboard");
  const indexPath = join(distDir, "index.html");

  if (existsSync(indexPath)) {
    // Read index.html once and inject basePath
    const rawHtml = readFileSync(indexPath, "utf-8");
    const injectedHtml = rawHtml.replace(
      "<!-- __DASHQ_INJECT__ -->",
      `<script>window.__DASHQ_BASE_PATH__ = "${basePath}";</script>`,
    );

    // Serve static assets (JS, CSS, images)
    const fastifyStatic = await import("@fastify/static");
    fastify.register(fastifyStatic.default, {
      root: join(distDir, "assets"),
      prefix: `${basePath}/assets/`,
      decorateReply: false,
    });

    // SPA fallback: serve injected index.html for all non-API, non-asset routes
    const sendHtml = (_request: unknown, reply: import("fastify").FastifyReply) => {
      reply.type("text/html").send(injectedHtml);
    };

    // /dashq (no trailing slash)
    fastify.get(`${basePath}`, sendHtml);
    // /dashq/ (trailing slash — wildcard won't match empty string)
    fastify.get(`${basePath}/`, sendHtml);

    fastify.get(`${basePath}/*`, (request, reply) => {
      const url = request.url;
      // Don't intercept API routes or asset requests
      if (url.startsWith(`${basePath}/api/`) || url.startsWith(`${basePath}/assets/`)) {
        reply.callNotFound();
        return;
      }
      reply.type("text/html").send(injectedHtml);
    });
  }

  fastify.setErrorHandler((error: { statusCode?: number; message: string }, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    reply.status(statusCode).send({
      error: statusCode === 500 ? "Internal Server Error" : error.message,
      statusCode,
    });
  });
}

export const createDashboardPlugin = fp(dashboardPlugin, {
  name: "dashq-dashboard",
});
