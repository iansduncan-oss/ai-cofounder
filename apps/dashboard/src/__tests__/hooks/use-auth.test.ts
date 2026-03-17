import { renderHook, act } from "@testing-library/react";
import { useAuth, getAccessToken, setAccessToken } from "@/hooks/use-auth";

// Save original location
const originalLocation = window.location;

beforeEach(() => {
  // Reset module-level token
  setAccessToken(null);

  // Mock window.location.href setter
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...originalLocation, href: "" },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    writable: true,
    value: originalLocation,
  });
});

describe("getAccessToken / setAccessToken", () => {
  it("returns null by default", () => {
    expect(getAccessToken()).toBeNull();
  });

  it("stores and retrieves token", () => {
    setAccessToken("tok-123");
    expect(getAccessToken()).toBe("tok-123");
  });

  it("clears token with null", () => {
    setAccessToken("tok-123");
    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
  });
});

describe("useAuth", () => {
  it("starts unauthenticated", () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(false);
  });

  describe("login", () => {
    it("sets token on success", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ accessToken: "new-tok" }),
      });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.login("user@test.com", "pass123");
      });

      expect(result.current.isAuthenticated).toBe(true);
      expect(getAccessToken()).toBe("new-tok");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/login"),
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: JSON.stringify({ email: "user@test.com", password: "pass123" }),
        }),
      );
    });

    it("throws on failure with server error message", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Invalid credentials" }),
      });

      const { result } = renderHook(() => useAuth());

      await expect(
        act(async () => {
          await result.current.login("user@test.com", "wrong");
        }),
      ).rejects.toThrow("Invalid credentials");

      expect(result.current.isAuthenticated).toBe(false);
    });

    it("throws generic message when server returns no error field", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.reject(new Error("parse error")),
      });

      const { result } = renderHook(() => useAuth());

      await expect(
        act(async () => {
          await result.current.login("user@test.com", "wrong");
        }),
      ).rejects.toThrow("Login failed");
    });
  });

  describe("logout", () => {
    it("clears token, calls endpoint, and redirects", async () => {
      setAccessToken("tok-existing");
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

      const { result } = renderHook(() => useAuth());
      expect(result.current.isAuthenticated).toBe(true);

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(getAccessToken()).toBeNull();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/logout"),
        expect.objectContaining({ method: "POST", credentials: "include" }),
      );
      expect(window.location.href).toBe("/dashboard/login");
    });

    it("still clears token and redirects when logout endpoint fails", async () => {
      setAccessToken("tok-existing");
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("network"));

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(window.location.href).toBe("/dashboard/login");
    });
  });

  describe("refresh", () => {
    it("returns new token on success", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ accessToken: "refreshed-tok" }),
      });

      const { result } = renderHook(() => useAuth());

      let token: string | null = null;
      await act(async () => {
        token = await result.current.refresh();
      });

      expect(token).toBe("refreshed-tok");
      expect(result.current.isAuthenticated).toBe(true);
      expect(getAccessToken()).toBe("refreshed-tok");
    });

    it("clears token and returns null on failure", async () => {
      setAccessToken("tok-old");
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });

      const { result } = renderHook(() => useAuth());

      let token: string | null = "not-null";
      await act(async () => {
        token = await result.current.refresh();
      });

      expect(token).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(getAccessToken()).toBeNull();
    });

    it("clears token and returns null on network error", async () => {
      setAccessToken("tok-old");
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("network"));

      const { result } = renderHook(() => useAuth());

      let token: string | null = "not-null";
      await act(async () => {
        token = await result.current.refresh();
      });

      expect(token).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });
  });
});
