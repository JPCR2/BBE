import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

config({ quiet: true });

// Configuración del CLI de Prisma 7 (migraciones, seed y conexión).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
    // Base auxiliar que usa "prisma migrate dev" para detectar diferencias.
    // Es opcional: en el servidor de internet solo se usa "migrate deploy", que no la necesita.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
