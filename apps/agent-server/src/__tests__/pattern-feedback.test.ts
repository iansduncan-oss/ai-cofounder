import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockListPatterns = vi.fn().mockResolvedValue({ data: [], total: 0 });
const mockAdjustPatternConfidence = vi.fn().mockResolvedValue({ id: "up-1", confidence: 55 });
const mockDeactivateLowConfidencePatterns = vi.fn().mockResolvedValue(0);

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  listPatterns: (...args: unknown[]) => mockListPatterns(...args),
  adjustPatternConfidence: (...args: unknown[]) => mockAdjustPatternConfidence(...args),
  deactivateLowConfidencePatterns: (...args: unknown[]) => mockDeactivateLowConfidencePatterns(...args),
}));

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const { PatternFeedbackProcessor } = await import("../services/pattern-feedback.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PatternFeedbackProcessor", () => {
  const db = {} as any;

  it("skips patterns with fewer than 5 hits", async () => {
    mockListPatterns.mockResolvedValueOnce({ data: [
      { id: "p1", hitCount: 3, acceptCount: 0, confidence: 50 },
    ], total: 1 });

    const processor = new PatternFeedbackProcessor(db);
    const result = await processor.processConfidenceAdjustments();

    expect(mockAdjustPatternConfidence).not.toHaveBeenCalled();
    expect(result.adjusted).toBe(0);
  });

  it("boosts confidence for high-acceptance patterns (>=70%, >=10 hits)", async () => {
    mockListPatterns.mockResolvedValueOnce({ data: [
      { id: "p1", hitCount: 10, acceptCount: 8, confidence: 60 },
    ], total: 1 });

    const processor = new PatternFeedbackProcessor(db);
    await processor.processConfidenceAdjustments();

    expect(mockAdjustPatternConfidence).toHaveBeenCalledWith(db, "p1", 5);
  });

  it("boosts confidence for moderate-acceptance patterns (>=50%, >=5 hits)", async () => {
    mockListPatterns.mockResolvedValueOnce({ data: [
      { id: "p1", hitCount: 6, acceptCount: 4, confidence: 50 },
    ], total: 1 });

    const processor = new PatternFeedbackProcessor(db);
    await processor.processConfidenceAdjustments();

    expect(mockAdjustPatternConfidence).toHaveBeenCalledWith(db, "p1", 3);
  });

  it("decays confidence for low-acceptance patterns (<10%)", async () => {
    mockListPatterns.mockResolvedValueOnce({ data: [
      { id: "p1", hitCount: 10, acceptCount: 0, confidence: 40 },
    ], total: 1 });

    const processor = new PatternFeedbackProcessor(db);
    await processor.processConfidenceAdjustments();

    expect(mockAdjustPatternConfidence).toHaveBeenCalledWith(db, "p1", -10);
  });

  it("decays confidence for below-25% acceptance patterns", async () => {
    mockListPatterns.mockResolvedValueOnce({ data: [
      { id: "p1", hitCount: 8, acceptCount: 1, confidence: 30 },
    ], total: 1 });

    const processor = new PatternFeedbackProcessor(db);
    await processor.processConfidenceAdjustments();

    expect(mockAdjustPatternConfidence).toHaveBeenCalledWith(db, "p1", -5);
  });

  it("calls deactivateLowConfidencePatterns after adjustments", async () => {
    mockListPatterns.mockResolvedValueOnce({ data: [], total: 0 });
    mockDeactivateLowConfidencePatterns.mockResolvedValueOnce(2);

    const processor = new PatternFeedbackProcessor(db);
    const result = await processor.processConfidenceAdjustments();

    expect(mockDeactivateLowConfidencePatterns).toHaveBeenCalledOnce();
    expect(result.deactivated).toBe(2);
  });
});
