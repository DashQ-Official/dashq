/**
 * Manages the database adapter reference for enqueue operations.
 *
 * `start()` calls `setAdapter()` to wire up the database.
 * Enqueue methods call `getAdapter()` which throws if not initialized.
 */

import type { DatabaseAdapter } from "../db/adapter.js";

let adapter: DatabaseAdapter | null = null;

/** Store the adapter reference. Called by `start()`. */
export function setAdapter(db: DatabaseAdapter): void {
  adapter = db;
}

/** Return the adapter or throw if not initialized. */
export function getAdapter(): DatabaseAdapter {
  if (!adapter) {
    throw new Error(
      "DashQ has not been started. Call start() before enqueueing jobs.",
    );
  }
  return adapter;
}

/** Reset to null. Intended for test isolation. */
export function clearAdapter(): void {
  adapter = null;
}
