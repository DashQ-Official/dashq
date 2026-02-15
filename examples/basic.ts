/**
 * Basic DashQ example — define a job, enqueue it, run the worker.
 *
 * Run with: pnpm example:basic
 */

import {
  createAdapter,
  setAdapter,
  defineJob,
  createWorker,
  installConsoleInterceptors,
  waitForJob,
} from "dashq";

// 1. Database — in-memory SQLite for this demo
const db = createAdapter({ type: "sqlite", path: ":memory:" });
await db.initialize();
setAdapter(db);

// 2. Enable console log capture (worker stores console output as job logs)
installConsoleInterceptors();

// 3. Define a job
const greeting = defineJob("greeting", async (name: string) => {
  console.log(`Hello, ${name}!`);
});

// 4. Enqueue
const jobId = await greeting.enqueue("World");
console.log(`Enqueued job ${jobId}`);

// 5. Start a worker
const worker = createWorker(db, { pollingInterval: 500 });
worker.start();

// 6. Wait for the job to complete, then shut down
const completed = await waitForJob(db, jobId);
console.log(`Job ${completed.id} finished with status: ${completed.status}`);
await worker.stop();
await db.close();
