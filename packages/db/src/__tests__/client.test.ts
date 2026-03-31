import { describe, it, expect, vi } from "vitest";

// Mock postgres and drizzle-orm before importing
const mockEnd = vi.fn().mockResolvedValue(undefined);
const mockPostgres = vi.fn().mockReturnValue(mockEnd);
const mockMigrate = vi.fn().mockResolvedValue(undefined);
const mockDrizzle = vi.fn().mockReturnValue({});

vi.mock("postgres", () => ({
  default: (...args: unknown[]) => {
    const client = mockPostgres(...args);
    client.end = mockEnd;
    return client;
  },
}));

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: (...args: unknown[]) => mockDrizzle(...args),
}));

vi.mock("drizzle-orm/postgres-js/migrator", () => ({
  migrate: (...args: unknown[]) => mockMigrate(...args),
}));

vi.mock("../schema.js", () => ({}));

const { createDb, runMigrations } = await import("../client.js");

describe("client", () => {
  describe("createDb", () => {
    it("creates a drizzle instance with the connection string", () => {
      const db = createDb("postgresql://test:test@localhost:5432/test");
      expect(db).toBeDefined();
      expect(mockPostgres).toHaveBeenCalledWith("postgresql://test:test@localhost:5432/test", { max: 20 });
    });
  });

  describe("runMigrations", () => {
    it("runs migrations and closes the client", async () => {
      await runMigrations(
        "postgresql://test:test@localhost:5432/test",
        "/path/to/migrations",
      );

      // Creates a separate connection with max: 1
      expect(mockPostgres).toHaveBeenCalledWith(
        "postgresql://test:test@localhost:5432/test",
        { max: 1 },
      );

      // Calls drizzle migrate
      expect(mockMigrate).toHaveBeenCalledWith(
        expect.anything(),
        { migrationsFolder: "/path/to/migrations" },
      );

      // Closes the migration client
      expect(mockEnd).toHaveBeenCalled();
    });
  });
});
