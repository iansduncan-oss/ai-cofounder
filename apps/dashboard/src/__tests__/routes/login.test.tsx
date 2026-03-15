import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LoginPage } from "@/routes/login";

// Mock use-auth hook
const mockLogin = vi.fn();
const mockNavigate = vi.fn();

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    isAuthenticated: false,
    login: mockLogin,
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
  getAccessToken: vi.fn().mockReturnValue(null),
  setAccessToken: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    useNavigate: () => mockNavigate,
  };
});

function renderLoginPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/dashboard/login"]}>
        <Routes>
          <Route path="/dashboard/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders email input, password input, and submit button", () => {
    renderLoginPage();

    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("renders sign in to access the dashboard description", () => {
    renderLoginPage();
    expect(screen.getByText("Sign in to access the dashboard")).toBeInTheDocument();
  });

  it("calls login with email and password on form submit", async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    renderLoginPage();

    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "supersecret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("admin@example.com", "supersecret");
    });
  });

  it("navigates to /dashboard on successful login", async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    renderLoginPage();

    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "supersecret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("displays error message on login failure", async () => {
    mockLogin.mockRejectedValueOnce(new Error("Invalid credentials"));
    renderLoginPage();

    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "wrongpassword" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText("Invalid email or password")).toBeInTheDocument();
    });
  });

  it("disables submit button when email or password is empty", () => {
    renderLoginPage();

    const submitButton = screen.getByRole("button", { name: /sign in/i });
    expect(submitButton).toBeDisabled();

    // Fill email only
    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "admin@example.com" },
    });
    expect(submitButton).toBeDisabled();

    // Fill password too
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "pass" },
    });
    expect(submitButton).not.toBeDisabled();
  });
});
