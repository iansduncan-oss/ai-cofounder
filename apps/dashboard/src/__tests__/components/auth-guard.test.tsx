import { screen } from "@testing-library/react";
import { Routes, Route } from "react-router";
import { AuthGuard } from "@/components/auth/auth-guard";
import { setAccessToken } from "@/hooks/use-auth";
import { renderWithProviders } from "../test-utils";

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
  afterEach(() => {
    // Reset in-memory token after each test
    setAccessToken(null);
  });

  it("renders children when authenticated", () => {
    setAccessToken("valid-jwt-token");
    renderGuarded();
    expect(screen.getByText("Protected Content")).toBeInTheDocument();
    expect(screen.queryByText("Login Page")).not.toBeInTheDocument();
  });

  it("redirects to login when no token", () => {
    setAccessToken(null);
    renderGuarded();
    expect(screen.getByText("Login Page")).toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });
});
