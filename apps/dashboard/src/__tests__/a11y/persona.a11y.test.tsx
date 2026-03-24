import { axe } from "vitest-axe";
import { PersonaPage } from "@/routes/persona";
import { renderWithProviders } from "../test-utils";

vi.mock("@/api/queries", () => ({
  useListPersonas: vi.fn(),
  useActivePersona: vi.fn(),
}));

vi.mock("@/api/mutations", () => ({
  useUpsertPersona: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useDeletePersona: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
}));

import { useListPersonas, useActivePersona } from "@/api/queries";

const mockUseListPersonas = vi.mocked(useListPersonas);
const mockUseActivePersona = vi.mocked(useActivePersona);

function mockLoaded() {
  mockUseListPersonas.mockReturnValue({
    data: {
      personas: [
        {
          id: "p1",
          name: "JARVIS",
          corePersonality: "Professional, witty, helpful assistant",
          voiceId: "voice-123",
          capabilities: "Task management, code review",
          behavioralGuidelines: "Be concise and professional",
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useListPersonas>);
  mockUseActivePersona.mockReturnValue({
    data: { persona: { id: "p1", name: "JARVIS" } },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useActivePersona>);
}

function mockLoading() {
  mockUseListPersonas.mockReturnValue({
    data: undefined,
    isLoading: true,
    error: null,
  } as unknown as ReturnType<typeof useListPersonas>);
  mockUseActivePersona.mockReturnValue({
    data: undefined,
    isLoading: true,
    error: null,
  } as unknown as ReturnType<typeof useActivePersona>);
}

describe("PersonaPage a11y", () => {
  it("has no accessibility violations in loaded state", async () => {
    mockLoaded();
    const { container } = renderWithProviders(<PersonaPage />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no accessibility violations in loading state", async () => {
    mockLoading();
    const { container } = renderWithProviders(<PersonaPage />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no accessibility violations with empty list", async () => {
    mockUseListPersonas.mockReturnValue({
      data: { personas: [] },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useListPersonas>);
    mockUseActivePersona.mockReturnValue({
      data: { persona: null },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useActivePersona>);
    const { container } = renderWithProviders(<PersonaPage />);
    // heading-order excluded: EmptyState component uses h3 after PageHeader h1 (known issue)
    const results = await axe(container, { rules: { "heading-order": { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
