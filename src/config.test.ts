import { describe, it, expect } from "vitest";
import { parseDatabaseConfig, validateConfig } from "./config.js";

// ---------------------------------------------------------------------------
// parseDatabaseConfig
// ---------------------------------------------------------------------------

describe("parseDatabaseConfig", () => {
  it("parses file: prefix as sqlite", () => {
    expect(parseDatabaseConfig("file:jobs.db")).toEqual({
      type: "sqlite",
      path: "jobs.db",
    });
  });

  it("parses plain filename as sqlite", () => {
    expect(parseDatabaseConfig("jobs.db")).toEqual({
      type: "sqlite",
      path: "jobs.db",
    });
  });

  it("parses :memory: as sqlite", () => {
    expect(parseDatabaseConfig(":memory:")).toEqual({
      type: "sqlite",
      path: ":memory:",
    });
  });

  it("parses postgres:// as postgres", () => {
    expect(parseDatabaseConfig("postgres://localhost/db")).toEqual({
      type: "postgres",
      connectionString: "postgres://localhost/db",
    });
  });

  it("parses postgresql:// as postgres", () => {
    expect(parseDatabaseConfig("postgresql://localhost/db")).toEqual({
      type: "postgres",
      connectionString: "postgresql://localhost/db",
    });
  });
});

// ---------------------------------------------------------------------------
// validateConfig
// ---------------------------------------------------------------------------

describe("validateConfig", () => {
  it("throws when database is missing", () => {
    expect(() => validateConfig({} as any)).toThrow("'database' is required");
  });

  it("throws when database is empty string", () => {
    expect(() => validateConfig({ database: "" })).toThrow(
      "'database' is required",
    );
  });

  it("throws when port is negative", () => {
    expect(() => validateConfig({ database: "x", port: -1 })).toThrow("port");
  });

  it("throws when port exceeds 65535", () => {
    expect(() => validateConfig({ database: "x", port: 70000 })).toThrow(
      "port",
    );
  });

  it("throws when port is a float", () => {
    expect(() => validateConfig({ database: "x", port: 3.5 })).toThrow(
      "port",
    );
  });

  it("passes with only database", () => {
    expect(() => validateConfig({ database: "x" })).not.toThrow();
  });

  it("passes with port 0", () => {
    expect(() => validateConfig({ database: "x", port: 0 })).not.toThrow();
  });

  it("passes with all valid options", () => {
    expect(() =>
      validateConfig({
        database: "file:jobs.db",
        port: 3000,
        host: "localhost",
        worker: { pollingInterval: 500 },
        dashboard: { basePath: "/admin" },
      }),
    ).not.toThrow();
  });
});
