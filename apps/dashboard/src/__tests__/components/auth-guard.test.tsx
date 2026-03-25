import { screen, waitFor } from "@testing-library/react";
import { Routes, Route } from "react-router";
import { AuthGuard } from "@/components/auth/auth-guard";
import { renderWithProviders } from "../test-utils";

const mockGetAccessToken = vi.fn();
const mockSetAccessToken = vi.fn();
const mockUseProactiveRefresh = vi.fn();

vi.mock("@/hooks/use-auth", () => ({
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
  setAccessToken: (...args: unknown[]) => mockSetAccessToken(...args),
  useProactiveRefresh: () => mockUseProactiveRefresh(),
}));

function renderGuarded() {
  return renderWithProviders(
    <Routes>
      <Route
        path="/dashboard"
        element={
          <AuthGuard>
            <div>Protected Content</div>
          </AuthGuard>
        }
      />
      <Route path="/dashboard/login" element={<div>Login Page</div>} />
    </Routes>,
    { initialEntries: ["/dashboard"] },
  );
}

describe("AuthGuard", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockGetAccessToken.mockReset();
    mockSetAccessToken.mockReset();
    mockUseProactiveRefresh.mockReset();
  });

  it("renders children when authenticated", () => {
    mockGetAccessToken.mockReturnValue("valid-jwt-token");
    renderGuarded();
    expect(screen.getByText("Protected Content")).toBeInTheDocument();
    expect(screen.queryByText("Login Page")).not.toBeInTheDocument();
  });

  it("redirects to login when no token", async () => {
    mockGetAccessToken.mockReturnValue(null);
    renderGuarded();
    await waitFor(() => {
      expect(screen.getByText("Login Page")).toBeInTheDocument();
    });
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("shows spinner then renders children on successful refresh", async () => {
    mockGetAccessToken.mockReturnValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ accessToken: "new-token" }),
      }),
    );

    renderGuarded();

    // Spinner should appear while checking
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();

    // After refresh resolves, children should render
    await waitFor(() => {
      expect(screen.getByText("Protected Content")).toBeInTheDocument();
    });

    expect(mockSetAccessToken).toHaveBeenCalledWith("new-token");
  });

  it("shows spinner then redirects on failed refresh", async () => {
    mockGetAccessToken.mockReturnValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false }),
    );

    renderGuarded();

    // Spinner should appear while checking
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();

    // After failed refresh, should redirect to login
    await waitFor(() => {
      expect(screen.getByText("Login Page")).toBeInTheDocument();
    });

    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });
});
