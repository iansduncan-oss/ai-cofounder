import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./test-utils";
import { NavRail } from "@/components/layout/nav-rail";

// Mock api client used by NavRail's health query
vi.mock("@/api/client", () => ({
  apiClient: {
    health: vi.fn().mockResolvedValue({ status: "ok" }),
  },
}));

// Mock auth hook
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAuthenticated: false, logout: vi.fn() }),
}));

describe("Responsive: NavRail", () => {
  const mockDrawerOpen = vi.fn();

  beforeEach(() => {
    mockDrawerOpen.mockClear();
    // Simulate mobile viewport — matchMedia returns false for md breakpoint
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it("renders hamburger button on mobile", () => {
    renderWithProviders(<NavRail onDrawerOpen={mockDrawerOpen} />);
    const hamburger = screen.getByLabelText("Open navigation");
    expect(hamburger).toBeInTheDocument();
  });

  it("opens mobile drawer when hamburger is clicked", () => {
    renderWithProviders(<NavRail onDrawerOpen={mockDrawerOpen} />);
    const hamburger = screen.getByLabelText("Open navigation");
    fireEvent.click(hamburger);

    // Close button should appear when drawer is open
    const closeBtn = screen.getByLabelText("Close navigation");
    expect(closeBtn).toBeInTheDocument();

    // Nav items should show labels in mobile drawer
    expect(screen.getByText("Command Center")).toBeInTheDocument();
    expect(screen.getByText("Goals")).toBeInTheDocument();
  });

  it("closes mobile drawer when close button is clicked", () => {
    renderWithProviders(<NavRail onDrawerOpen={mockDrawerOpen} />);

    // Open drawer
    fireEvent.click(screen.getByLabelText("Open navigation"));
    expect(screen.getByLabelText("Close navigation")).toBeInTheDocument();

    // Close drawer
    fireEvent.click(screen.getByLabelText("Close navigation"));
    expect(screen.queryByLabelText("Close navigation")).not.toBeInTheDocument();
  });

  it("closes mobile drawer on Escape key", () => {
    renderWithProviders(<NavRail onDrawerOpen={mockDrawerOpen} />);

    fireEvent.click(screen.getByLabelText("Open navigation"));
    expect(screen.getByLabelText("Close navigation")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByLabelText("Close navigation")).not.toBeInTheDocument();
  });
});
