import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  base: "/dashboard/",
  plugins: [react(), tailwindcss()],
  test: {
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    commonjsOptions: {
      include: [/api-client/, /node_modules/],
    },
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          router: ["react-router"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
  optimizeDeps: {
    include: ["@ai-cofounder/api-client"],
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
    },
  },
});
