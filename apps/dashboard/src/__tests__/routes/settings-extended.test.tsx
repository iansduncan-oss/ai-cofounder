import { screen, fireEvent, waitFor } from "@testing-library/react";
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
  useUpdateToolTier: vi.fn(),
  useUpdateBudgetThresholds: vi.fn(),
  useCreateProject: vi.fn(),
  useDeleteProject: vi.fn(),
}));

import {
  useHealth,
  useProviderHealth,
  useToolTierConfig,
  useSettings,
  useProjects,
  useBudgetStatus,
} from "@/api/queries";
import {
  useUpdateToolTier,
  useUpdateBudgetThresholds,
  useCreateProject,
  useDeleteProject,
} from "@/api/mutations";

const mockUseHealth = vi.mocked(useHealth);
const mockUseProviderHealth = vi.mocked(useProviderHealth);
const mockUseToolTierConfig = vi.mocked(useToolTierConfig);
const mockUseSettings = vi.mocked(useSettings);
const mockUseProjects = vi.mocked(useProjects);
const mockUseBudgetStatus = vi.mocked(useBudgetStatus);

const mockUpdateToolTierMutate = vi.fn();
const mockUpdateBudgetMutate = vi.fn();
const mockCreateProjectMutate = vi.fn();
const mockDeleteProjectMutate = vi.fn();

const mockUseUpdateToolTier = vi.mocked(useUpdateToolTier);
const mockUseUpdateBudgetThresholds = vi.mocked(useUpdateBudgetThresholds);
const mockUseCreateProject = vi.mocked(useCreateProject);
const mockUseDeleteProject = vi.mocked(useDeleteProject);

describe("SettingsPage — Budget Thresholds + Project Registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default base mocks so component renders without errors
    mockUseHealth.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    } as ReturnType<typeof useHealth>);

    mockUseProviderHealth.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    } as ReturnType<typeof useProviderHealth>);

    mockUseToolTierConfig.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useToolTierConfig>);

    mockUseBudgetStatus.mockReturnValue({
      data: {
        daily: { spentUsd: 5, limitUsd: 50, percentUsed: 10 },
        weekly: { spentUsd: 20, limitUsd: 200, percentUsed: 10 },
      },
    } as ReturnType<typeof useBudgetStatus>);

    mockUseSettings.mockReturnValue({
      data: { dailyBudgetUsd: 50, weeklyBudgetUsd: 200 },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useSettings>);

    mockUseProjects.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useProjects>);

    mockUseUpdateToolTier.mockReturnValue({
      mutate: mockUpdateToolTierMutate,
      isPending: false,
    } as ReturnType<typeof useUpdateToolTier>);

    mockUseUpdateBudgetThresholds.mockReturnValue({
      mutate: mockUpdateBudgetMutate,
      isPending: false,
    } as ReturnType<typeof useUpdateBudgetThresholds>);

    mockUseCreateProject.mockReturnValue({
      mutate: mockCreateProjectMutate,
      isPending: false,
    } as ReturnType<typeof useCreateProject>);

    mockUseDeleteProject.mockReturnValue({
      mutate: mockDeleteProjectMutate,
      isPending: false,
    } as ReturnType<typeof useDeleteProject>);
  });

  // Test 1: Budget Thresholds card renders with daily and weekly input fields
  it("renders Budget Thresholds card with daily and weekly input fields", () => {
    renderWithProviders(<SettingsPage />);

    expect(screen.getByText("Budget Thresholds")).toBeInTheDocument();
    expect(screen.getByLabelText(/daily budget/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/weekly budget/i)).toBeInTheDocument();
  });

  // Test 2: Budget inputs pre-populate with current values from useSettings query
  it("pre-populates budget inputs with values from useSettings", () => {
    mockUseSettings.mockReturnValue({
      data: { dailyBudgetUsd: 75, weeklyBudgetUsd: 350 },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useSettings>);

    renderWithProviders(<SettingsPage />);

    const dailyInput = screen.getByLabelText(/daily budget/i) as HTMLInputElement;
    const weeklyInput = screen.getByLabelText(/weekly budget/i) as HTMLInputElement;

    expect(dailyInput.value).toBe("75");
    expect(weeklyInput.value).toBe("350");
  });

  // Test 3: Clicking Save calls updateBudgetThresholds mutation with input values
  it("calls updateBudgetThresholds mutation on Save click", async () => {
    mockUseSettings.mockReturnValue({
      data: { dailyBudgetUsd: 50, weeklyBudgetUsd: 200 },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useSettings>);

    renderWithProviders(<SettingsPage />);

    const dailyInput = screen.getByLabelText(/daily budget/i);
    const weeklyInput = screen.getByLabelText(/weekly budget/i);

    fireEvent.change(dailyInput, { target: { value: "100" } });
    fireEvent.change(weeklyInput, { target: { value: "500" } });

    const saveButton = screen.getByRole("button", { name: /save budget/i });
    fireEvent.click(saveButton);

    expect(mockUpdateBudgetMutate).toHaveBeenCalledWith({
      dailyUsd: 100,
      weeklyUsd: 500,
    });
  });

  // Test 4: Projects card renders list of registered projects with name and repo URL
  it("renders project list with name and repo URL for each project", () => {
    mockUseProjects.mockReturnValue({
      data: [
        {
          id: "p1",
          name: "AI Cofounder",
          repoUrl: "https://github.com/org/ai-cofounder",
          workspacePath: "/workspace/ai-cofounder",
          isActive: true,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useProjects>);

    renderWithProviders(<SettingsPage />);

    expect(screen.getByText("AI Cofounder")).toBeInTheDocument();
    expect(screen.getByText("https://github.com/org/ai-cofounder")).toBeInTheDocument();
  });

  // Test 5: Register Project form accepts name, repo URL, workspace path and calls createProject
  it("calls createProject mutation when Register form is submitted", async () => {
    renderWithProviders(<SettingsPage />);

    // Open the register form
    const addButton = screen.getByRole("button", { name: /register new project/i });
    fireEvent.click(addButton);

    const nameInput = screen.getByPlaceholderText(/project name/i);
    const repoInput = screen.getByPlaceholderText(/repository url/i);
    const pathInput = screen.getByPlaceholderText(/workspace path/i);

    fireEvent.change(nameInput, { target: { value: "My Project" } });
    fireEvent.change(repoInput, { target: { value: "https://github.com/org/my-project" } });
    fireEvent.change(pathInput, { target: { value: "/workspace/my-project" } });

    const submitButton = screen.getByRole("button", { name: /^register$/i });
    fireEvent.click(submitButton);

    expect(mockCreateProjectMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My Project",
        repoUrl: "https://github.com/org/my-project",
        workspacePath: "/workspace/my-project",
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  // Test 6: Delete button on project calls deleteProject mutation
  it("calls deleteProject mutation when delete button is clicked", async () => {
    mockUseProjects.mockReturnValue({
      data: [
        {
          id: "p1",
          name: "AI Cofounder",
          repoUrl: "https://github.com/org/ai-cofounder",
          workspacePath: "/workspace/ai-cofounder",
          isActive: true,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useProjects>);

    // Mock window.confirm to return true
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<SettingsPage />);

    const deleteButton = screen.getByRole("button", { name: /delete project/i });
    fireEvent.click(deleteButton);

    expect(mockDeleteProjectMutate).toHaveBeenCalledWith("p1");
  });

  // Test 7: Empty projects list shows "No projects registered" message
  it("shows 'No projects registered' when projects list is empty", () => {
    mockUseProjects.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useProjects>);

    renderWithProviders(<SettingsPage />);

    expect(screen.getByText("No projects registered")).toBeInTheDocument();
  });
});
