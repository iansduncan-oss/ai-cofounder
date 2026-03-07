import { ApiClient } from "@ai-cofounder/api-client";

const baseUrl = import.meta.env.VITE_API_URL || "";
const apiSecret = localStorage.getItem("ai-cofounder-token") ?? undefined;

export const apiClient = new ApiClient({ baseUrl, apiSecret });
