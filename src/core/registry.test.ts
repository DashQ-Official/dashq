import { describe, it, expect, beforeEach } from "vitest";
import { register, getHandler, getAllJobTypes, has, clear } from "./registry.js";

const noop = async () => {};

describe("registry", () => {
  beforeEach(() => {
    clear();
  });

  // -----------------------------------------------------------------------
  // register()
  // -----------------------------------------------------------------------

  it("registers a job with default options", () => {
    register("email.send", noop);
    const entry = getHandler("email.send");
    expect(entry).toBeDefined();
    expect(entry!.jobId).toBe("email.send");
    expect(entry!.handler).toBe(noop);
    expect(entry!.options.maxAttempts).toBe(3);
    expect(entry!.options.backoff).toBe("exponential");
  });

  it("registers a job with custom options", () => {
    register("report.generate", noop, { maxAttempts: 5, backoff: "linear" });
    const entry = getHandler("report.generate");
    expect(entry!.options.maxAttempts).toBe(5);
    expect(entry!.options.backoff).toBe("linear");
  });

  it("registers a job with fixed backoff", () => {
    register("cleanup", noop, { backoff: "fixed" });
    expect(getHandler("cleanup")!.options.backoff).toBe("fixed");
  });

  it("registers a job with a custom backoff function", () => {
    const customBackoff = (attempt: number) => attempt * 1000;
    register("webhook.retry", noop, { backoff: customBackoff });
    const entry = getHandler("webhook.retry");
    expect(entry!.options.backoff).toBe(customBackoff);
    expect((entry!.options.backoff as Function)(3)).toBe(3000);
  });

  it("throws on duplicate jobId", () => {
    register("dup", noop);
    expect(() => register("dup", noop)).toThrow('Job "dup" is already registered');
  });

  it("throws on empty jobId", () => {
    expect(() => register("", noop)).toThrow("jobId must be a non-empty string");
  });

  it("throws on whitespace-only jobId", () => {
    expect(() => register("   ", noop)).toThrow("jobId must be a non-empty string");
  });

  it("throws when maxAttempts is 0", () => {
    expect(() => register("bad", noop, { maxAttempts: 0 })).toThrow(
      "maxAttempts must be a positive integer",
    );
  });

  it("throws when maxAttempts is negative", () => {
    expect(() => register("bad", noop, { maxAttempts: -1 })).toThrow(
      "maxAttempts must be a positive integer",
    );
  });

  it("throws when maxAttempts is not an integer", () => {
    expect(() => register("bad", noop, { maxAttempts: 2.5 })).toThrow(
      "maxAttempts must be a positive integer",
    );
  });

  // -----------------------------------------------------------------------
  // getHandler()
  // -----------------------------------------------------------------------

  it("returns undefined for an unregistered jobId", () => {
    expect(getHandler("nonexistent")).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // has()
  // -----------------------------------------------------------------------

  it("returns true for a registered jobId", () => {
    register("exists", noop);
    expect(has("exists")).toBe(true);
  });

  it("returns false for an unregistered jobId", () => {
    expect(has("nope")).toBe(false);
  });

  // -----------------------------------------------------------------------
  // getAllJobTypes()
  // -----------------------------------------------------------------------

  it("returns an empty array when nothing is registered", () => {
    expect(getAllJobTypes()).toEqual([]);
  });

  it("returns all registered job type ids", () => {
    register("a", noop);
    register("b", noop);
    register("c", noop);
    expect(getAllJobTypes()).toEqual(["a", "b", "c"]);
  });

  // -----------------------------------------------------------------------
  // clear()
  // -----------------------------------------------------------------------

  it("resets the registry and allows re-registration", () => {
    register("temp", noop);
    expect(has("temp")).toBe(true);
    clear();
    expect(has("temp")).toBe(false);
    expect(getAllJobTypes()).toEqual([]);
    // Should not throw — "temp" was cleared
    register("temp", noop);
    expect(has("temp")).toBe(true);
  });
});
