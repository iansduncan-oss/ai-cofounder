import { axe } from "vitest-axe";
import { FollowUpsPage } from "@/routes/follow-ups";
import { renderWithProviders } from "../test-utils";

vi.mock("@/api/queries", () => ({
  useFollowUps: vi.fn(),
}));

vi.mock("@/api/mutations", () => ({
  useCreateFollowUp: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useUpdateFollowUp: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useDeleteFollowUp: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
}));

import { useFollowUps } from "@/api/queries";

const mockUseFollowUps = vi.mocked(useFollowUps);

function mockLoaded() {
  mockUseFollowUps.mockReturnValue({
    data: {
      data: [
        {
          id: "fu1",
          title: "Review PR",
          description: "Check the latest changes",
          status: "pending",
          source: "agent",
          dueDate: "2026-03-25T10:00:00Z",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useFollowUps>);
}

function mockLoading() {
  mockUseFollowUps.mockReturnValue({
    data: undefined,
    isLoading: true,
    error: null,
  } as unknown as ReturnType<typeof useFollowUps>);
}

describe("FollowUpsPage a11y", () => {
  it("has no accessibility violations in loaded state", async () => {
    mockLoaded();
    const { container } = renderWithProviders(<FollowUpsPage />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no accessibility violations in loading state", async () => {
    mockLoading();
    const { container } = renderWithProviders(<FollowUpsPage />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no accessibility violations with empty list", async () => {
    mockUseFollowUps.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useFollowUps>);
    const { container } = renderWithProviders(<FollowUpsPage />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
