import type { DatabaseAdapter, DatabaseConfig } from "./adapter.js";
import { createSqliteAdapter } from "./sqlite-adapter.js";
import { createPostgresAdapter } from "./postgres-adapter.js";

export function createAdapter(config: DatabaseConfig): DatabaseAdapter {
  switch (config.type) {
    case "sqlite":
      return createSqliteAdapter(config.path);
    case "postgres":
      return createPostgresAdapter(config.connectionString);
    default:
      throw new Error(
        `Unknown database type: ${(config as { type: string }).type}`,
      );
  }
}
