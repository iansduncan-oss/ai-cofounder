import { screen, fireEvent } from "@testing-library/react";
import { ProjectSwitcher } from "@/components/layout/project-switcher";
import { renderWithProviders } from "../test-utils";

// Mock query hooks
vi.mock("@/api/queries", () => ({
  useProjects: vi.fn(),
}));

// Mock active project hooks
vi.mock("@/hooks/use-active-project", () => ({
  useActiveProject: vi.fn(),
  useSetActiveProject: vi.fn(),
}));

import { useProjects } from "@/api/queries";
import { useActiveProject, useSetActiveProject } from "@/hooks/use-active-project";

const mockUseProjects = vi.mocked(useProjects);
const mockUseActiveProject = vi.mocked(useActiveProject);
const mockUseSetActiveProject = vi.mocked(useSetActiveProject);

const mockSetActiveProject = vi.fn();

const sampleProjects = [
  {
    id: "proj-1",
    name: "Project Alpha",
    repoUrl: "https://github.com/org/alpha",
    workspacePath: "/tmp/alpha",
    isActive: true,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  },
  {
    id: "proj-2",
    name: "Project Beta",
    repoUrl: "https://github.com/org/beta",
    workspacePath: "/tmp/beta",
    isActive: false,
    createdAt: "2025-01-02T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
  },
];

describe("ProjectSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseActiveProject.mockReturnValue(null);
    mockUseSetActiveProject.mockReturnValue(mockSetActiveProject);
  });

  it("renders All projects option plus one option per registered project", () => {
    mockUseProjects.mockReturnValue({
      data: sampleProjects,
      isLoading: false,
    } as ReturnType<typeof useProjects>);

    renderWithProviders(<ProjectSwitcher />);

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("All projects")).toBeInTheDocument();
    expect(screen.getByText("Project Alpha")).toBeInTheDocument();
    expect(screen.getByText("Project Beta")).toBeInTheDocument();
  });

  it("calls setActiveProject when a project is selected and stores in localStorage", () => {
    mockUseProjects.mockReturnValue({
      data: sampleProjects,
      isLoading: false,
    } as ReturnType<typeof useProjects>);

    renderWithProviders(<ProjectSwitcher />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "proj-1" } });

    expect(mockSetActiveProject).toHaveBeenCalledWith("proj-1");
  });

  it("renders nothing when no projects exist", () => {
    mockUseProjects.mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof useProjects>);

    renderWithProviders(<ProjectSwitcher />);

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("All projects")).not.toBeInTheDocument();
  });

  it("reflects active project selection in select value on initial render", () => {
    mockUseProjects.mockReturnValue({
      data: sampleProjects,
      isLoading: false,
    } as ReturnType<typeof useProjects>);
    mockUseActiveProject.mockReturnValue("proj-2");

    renderWithProviders(<ProjectSwitcher />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("proj-2");
  });
});
