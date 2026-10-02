import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    // En desarrollo, las llamadas a /api se envían al backend de Express.
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
  test: {
    environment: "happy-dom",
    reporters: ["verbose"],
  },
});
