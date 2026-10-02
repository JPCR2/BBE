import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Recrea la base inventario_test y le aplica las migraciones antes de todo.
    globalSetup: ["./tests/globalSetup.ts"],
    // Los archivos comparten la misma base de pruebas: se ejecutan uno por uno.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    reporters: ["verbose"],
  },
});
