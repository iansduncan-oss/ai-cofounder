import { ApiClient } from "@ai-cofounder/api-client";

const baseUrl = import.meta.env.VITE_API_URL || "";

export const apiClient = new ApiClient({ baseUrl });
