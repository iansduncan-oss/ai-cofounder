import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkCooldown, clearCooldowns } from "../cooldown.js";

describe("checkCooldown", () => {
  beforeEach(() => {
    clearCooldowns();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows first use of any command", () => {
    expect(checkCooldown("user1", "status")).toBeNull();
  });

  it("blocks rapid reuse of a command", () => {
    checkCooldown("user1", "status");
    const remaining = checkCooldown("user1", "status");
    expect(remaining).toBe(3);
  });

  it("allows reuse after default cooldown (3s)", () => {
    checkCooldown("user1", "status");
    vi.advanceTimersByTime(3000);
    expect(checkCooldown("user1", "status")).toBeNull();
  });

  it("uses 10s cooldown for expensive commands (ask)", () => {
    checkCooldown("user1", "ask");
    vi.advanceTimersByTime(5000);
    const remaining = checkCooldown("user1", "ask");
    expect(remaining).toBe(5);
  });

  it("uses 10s cooldown for expensive commands (execute)", () => {
    checkCooldown("user1", "execute");
    vi.advanceTimersByTime(9000);
    const remaining = checkCooldown("user1", "execute");
    expect(remaining).toBe(1);
  });

  it("allows expensive command after 10s", () => {
    checkCooldown("user1", "ask");
    vi.advanceTimersByTime(10000);
    expect(checkCooldown("user1", "ask")).toBeNull();
  });

  it("tracks users independently", () => {
    checkCooldown("user1", "status");
    expect(checkCooldown("user2", "status")).toBeNull();
  });

  it("tracks commands independently", () => {
    checkCooldown("user1", "status");
    expect(checkCooldown("user1", "goals")).toBeNull();
  });

  it("returns decreasing remaining seconds", () => {
    checkCooldown("user1", "ask");
    vi.advanceTimersByTime(2000);
    expect(checkCooldown("user1", "ask")).toBe(8);
    vi.advanceTimersByTime(3000);
    expect(checkCooldown("user1", "ask")).toBe(5);
  });

  it("clearCooldowns resets all state", () => {
    checkCooldown("user1", "status");
    clearCooldowns();
    expect(checkCooldown("user1", "status")).toBeNull();
  });
});
