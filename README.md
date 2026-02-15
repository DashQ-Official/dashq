# DashQ

**Zero-setup job queue for Node.js with a built-in dashboard.**

[![npm version](https://img.shields.io/npm/v/dashq)](https://www.npmjs.com/package/dashq)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

DashQ is a database-first functional job queue that works out of the box — no Redis, no external services. Define jobs as functions, enqueue them with full type safety, and monitor everything through a built-in web dashboard.

## Features

- **Zero setup** — Works in-memory with SQLite by default. No infrastructure required.
- **Built-in dashboard** — Real-time web UI to inspect jobs, view logs, and retry failures.
- **Type-safe** — `defineJob()` infers argument types; `enqueue()` enforces them at compile time.
- **Database-first** — Jobs are stored in your database (SQLite or PostgreSQL), not in memory.
- **Job-scoped logging** — `console.log` inside a job is automatically captured and visible in the dashboard.
- **Automatic retries** — Configurable retry strategies with exponential, linear, or custom backoff.
- **Scheduled jobs** — Enqueue jobs to run at a specific time or after a delay.
- **Graceful shutdown** — Waits for in-flight jobs before stopping.
- **Crash recovery** — Lease-based locking detects stalled workers and re-queues their jobs.
- **Automatic cleanup** — Configurable retention policies keep your database lean.

## Quick Start

```bash
npm install dashq
```

```typescript
import { defineJob, start } from "dashq";

const emailJob = defineJob("email.send", async (to: string, subject: string) => {
  console.log(`Sending "${subject}" to ${to}`);
  // ...your logic here
});

const handle = await start({
  database: "file:jobs.db",
  port: 3000,
});

await emailJob.enqueue("user@example.com", "Welcome!");

// Dashboard → http://localhost:3000/dashq/
```

That's it. Database tables are created automatically, the worker starts polling, and the dashboard is live.

## Defining Jobs

Use `defineJob()` to register a job handler. Arguments are type-checked at enqueue time.

```typescript
import { defineJob } from "dashq";

const resizeImage = defineJob(
  "image.resize",
  async (url: string, width: number) => {
    console.log(`Resizing ${url} to ${width}px`);
    // ...
  },
  { maxAttempts: 5, backoff: "exponential" },
);
```

## Scheduling

```typescript
// Run immediately
await resizeImage.enqueue("https://example.com/img.png", 800);

// Run at a specific time
await resizeImage.enqueueAt(new Date("2025-12-25"), "https://example.com/img.png", 800);

// Run after a delay
await resizeImage.enqueueIn("5m", "https://example.com/img.png", 800);
await resizeImage.enqueueIn("2h", "https://example.com/img.png", 800);
```

Supported delay formats: `"30s"`, `"5m"`, `"2h"`, `"7d"`, or milliseconds as a number.

## Dashboard

DashQ ships with a built-in web dashboard — no separate service to deploy.

<!-- TODO: Add screenshot -->

- **Overview** — Job counts by status at a glance.
- **Job list** — Filter and sort by status, type, or date. Retry or delete from the UI.
- **Job detail** — View arguments, error stack traces, and a live-scrolling log viewer with output captured from `console.log/warn/error`.

## Configuration

```typescript
const handle = await start({
  // Required
  database: "file:jobs.db",       // SQLite file, ":memory:", or "postgres://..."

  // Optional (defaults shown)
  port: 3000,
  host: "localhost",
  dashboard: true,                // or { basePath: "/dashq" }
  worker: true,                   // or WorkerOptions (see below)
  retention: true,                // or RetentionOptions (see below)
});
```

### Worker Options

| Option | Default | Description |
|--------|---------|-------------|
| `pollingInterval` | `1000` | Base poll interval (ms) |
| `maxPollingInterval` | `30000` | Max interval during backoff (ms) |
| `backoffMultiplier` | `1.5` | Multiplier when queue is empty |
| `leaseTimeout` | `300000` | Job lock duration (ms) |
| `staleCheckInterval` | `30000` | Stale job recovery interval (ms) |
| `shutdownTimeout` | `30000` | Max wait on graceful shutdown (ms) |

### Retention Options

| Option | Default | Description |
|--------|---------|-------------|
| `succeededJobRetention` | `"7d"` | How long to keep succeeded jobs |
| `failedJobRetention` | `"14d"` | How long to keep failed jobs |
| `logRetention` | `"14d"` | How long to keep job logs |
| `cleanupInterval` | `"1h"` | How often cleanup runs |
| `cleanupBatchSize` | `1000` | Rows deleted per batch |

## Database Support

**SQLite** (default) — Zero setup. Great for development, single-server deployments, or getting started.

```typescript
await start({ database: ":memory:" });          // In-memory
await start({ database: "file:jobs.db" });       // File-based
```

**PostgreSQL** — For production multi-worker deployments. Install `pg` as a peer dependency.

```bash
npm install pg
```

```typescript
await start({ database: "postgres://user:pass@localhost:5432/mydb" });
```

Both adapters share the same interface — switch between them by changing the connection string.

## Retry & Backoff

Jobs retry automatically on failure, up to `maxAttempts` (default: 3).

```typescript
const job = defineJob("flaky-task", handler, {
  maxAttempts: 5,
  backoff: "exponential",   // 2s, 4s, 8s, 16s, ...
  // backoff: "linear",     // 1s, 2s, 3s, 4s, ...
  // backoff: "fixed",      // 1s, 1s, 1s, 1s, ...
  // backoff: (attempt) => attempt * 5000,  // custom
});
```

## Job-Scoped Logging

Any `console.log`, `console.warn`, or `console.error` called inside a job handler is automatically captured, stored in the database, and displayed in the dashboard — scoped to that job and attempt. No special logging API needed.

```typescript
const job = defineJob("example", async () => {
  console.log("Starting...");        // captured as info
  console.warn("Hmm...");           // captured as warn
  console.error("Something broke"); // captured as error
});
```

## API Reference

### Core

| Export | Description |
|--------|-------------|
| `defineJob(id, handler, options?)` | Register a job handler. Returns a `JobDefinition` with `enqueue`, `enqueueAt`, `enqueueIn`. |
| `start(options)` | Start the database, worker, and dashboard. Returns a `DashQHandle`. |

### Handle

| Method / Property | Description |
|-------------------|-------------|
| `handle.stop()` | Graceful shutdown of worker, dashboard, and database. |
| `handle.cleanup()` | Run retention cleanup on demand. |
| `handle.port` | The port the dashboard is listening on. |
| `handle.adapter` | Direct access to the database adapter. |

### Advanced

| Export | Description |
|--------|-------------|
| `createAdapter(config)` | Create a database adapter directly. |
| `createWorker(adapter, options?)` | Create a standalone worker. |
| `createDashboardPlugin(fastify, options)` | Mount the dashboard on an existing Fastify instance. |
| `waitForJob(adapter, jobId, options?)` | Poll until a job succeeds or fails. |
| `parseDuration(delay)` | Parse `"5m"` / `"2h"` / `"7d"` to milliseconds. |
| `generateId()` | Generate a UUIDv7. |

## License

[MIT](LICENSE)
