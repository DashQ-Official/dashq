/**
 * DashQ Dashboard Example
 *
 * Starts DashQ with the dashboard, defines some jobs, and enqueues
 * them on a loop so you have live data to look at.
 *
 * Run with:  pnpm example:dashboard
 */

import { defineJob, start } from "dashq";

// 1. Define jobs before calling start()
const greeting = defineJob("greeting", async (name: string) => {
  console.log(`Hello, ${name}!`);
});

const slowJob = defineJob(
  "slow-task",
  async () => {
    console.log("Starting slow task (60s)...");
    for (let elapsed = 5; elapsed <= 60; elapsed += 5) {
      await new Promise((r) => setTimeout(r, 5000));
      console.log(`Slow task running... ${elapsed}s / 60s`);
    }
    console.log("Slow task done!");
  },
  { maxAttempts: 2 },
);

const failingJob = defineJob("flaky-task", async () => {
  console.log("Attempting flaky task...");
  if (Math.random() < 0.6) {
    throw new Error("Random failure!");
  }
  console.log("Flaky task succeeded this time.");
});

// 2. Start everything (DB + worker + dashboard)
const handle = await start({
  database: "file:example.db",
  port: 3000,
  worker: {
    concurrency: 5
  }
});

console.log(`DashQ is running — open http://localhost:${handle.port}/dashq/`);

// 3. Enqueue some initial jobs
for (let i = 0; i < 5; i++) {
  await greeting.enqueue(`User ${i}`);
}
await slowJob.enqueue();
await failingJob.enqueue();

// 4. Enqueue more jobs every 10 seconds so there's always fresh data
setInterval(async () => {
  const jobs = [
    () => greeting.enqueue("Periodic"),
    () => slowJob.enqueue(),
    () => failingJob.enqueue(),
  ];
  const pick = jobs[Math.floor(Math.random() * jobs.length)]!;
  await pick();
}, 10_000);
