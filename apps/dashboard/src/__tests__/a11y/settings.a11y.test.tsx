import { axe } from "vitest-axe";
import { SettingsPage } from "@/routes/settings";
import { renderWithProviders } from "../test-utils";

vi.mock("@/api/queries", () => ({
  useHealth: vi.fn(),
  useProviderHealth: vi.fn(),
  useToolTierConfig: vi.fn(),
  useSettings: vi.fn(),
  useProjects: vi.fn(),
  useBudgetStatus: vi.fn(),
}));

vi.mock("@/api/mutations", () => ({
  useUpdateToolTier: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateBudgetThresholds: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useCreateProject: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteProject: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
}));

import {
  useHealth,
  useProviderHealth,
  useToolTierConfig,
  useSettings,
  useProjects,
  useBudgetStatus,
} from "@/api/queries";

const mockUseHealth = vi.mocked(useHealth);
const mockUseProviderHealth = vi.mocked(useProviderHealth);
const mockUseToolTierConfig = vi.mocked(useToolTierConfig);
const mockUseSettings = vi.mocked(useSettings);
const mockUseProjects = vi.mocked(useProjects);
const mockUseBudgetStatus = vi.mocked(useBudgetStatus);

function mockAllLoaded() {
  mockUseHealth.mockReturnValue({
    data: { status: "ok", timestamp: new Date().toISOString(), uptime: 7200 },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useHealth>);
  mockUseProviderHealth.mockReturnValue({
    data: [
      { name: "anthropic", status: "healthy", latencyMs: 120, successRate: 0.99, lastChecked: new Date().toISOString() },
    ],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useProviderHealth>);
  mockUseToolTierConfig.mockReturnValue({
    data: [
      { toolName: "search_web", tier: "green", updatedAt: new Date().toISOString() },
      { toolName: "write_file", tier: "yellow", updatedAt: new Date().toISOString() },
    ],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useToolTierConfig>);
  mockUseSettings.mockReturnValue({
    data: { dailyTokenLimit: 100000, briefingHour: 9, briefingTimezone: "America/New_York" },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useSettings>);
  mockUseProjects.mockReturnValue({
    data: [
      { id: "p1", name: "Test Project", repoUrl: "https://github.com/test/test", createdAt: new Date().toISOString() },
    ],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useProjects>);
  mockUseBudgetStatus.mockReturnValue({
    data: { dailyLimitUsd: 10, todaySpentUsd: 2.5, remainingUsd: 7.5, utilizationPct: 25, isOverBudget: false },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useBudgetStatus>);
}

describe("SettingsPage a11y", () => {
  it("has no accessibility violations in loaded state", async () => {
    mockAllLoaded();
    const { container } = renderWithProviders(<SettingsPage />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no accessibility violations in loading state", async () => {
    mockUseHealth.mockReturnValue({ data: undefined, isLoading: true, error: null } as unknown as ReturnType<typeof useHealth>);
    mockUseProviderHealth.mockReturnValue({ data: undefined, isLoading: true, error: null } as unknown as ReturnType<typeof useProviderHealth>);
    mockUseToolTierConfig.mockReturnValue({ data: undefined, isLoading: true, error: null } as unknown as ReturnType<typeof useToolTierConfig>);
    mockUseSettings.mockReturnValue({ data: undefined, isLoading: true, error: null } as unknown as ReturnType<typeof useSettings>);
    mockUseProjects.mockReturnValue({ data: undefined, isLoading: true, error: null } as unknown as ReturnType<typeof useProjects>);
    mockUseBudgetStatus.mockReturnValue({ data: undefined, isLoading: true, error: null } as unknown as ReturnType<typeof useBudgetStatus>);

    const { container } = renderWithProviders(<SettingsPage />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
