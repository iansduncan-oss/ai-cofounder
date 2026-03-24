import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  base: "/dashboard/",
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    css: false,
    include: ["src/__tests__/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    commonjsOptions: {
      include: [/api-client/, /shared/, /node_modules/],
    },
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          router: ["react-router"],
          query: ["@tanstack/react-query"],
          xyflow: ["@xyflow/react", "elkjs"],
        },
      },
    },
  },
  optimizeDeps: {
    include: ["@ai-cofounder/api-client", "@ai-cofounder/shared"],
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
      "/voice": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
    },
  },
});
