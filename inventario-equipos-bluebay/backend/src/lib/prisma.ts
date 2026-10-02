import "./entorno.ts";
import { crearClientePrisma } from "./clientePrisma.ts";

const urlBaseDeDatos = process.env.DATABASE_URL;
if (!urlBaseDeDatos) {
  throw new Error("Falta la variable DATABASE_URL. Copia .env.example como .env y ajústala.");
}

/** Cliente único de Prisma que usará toda la aplicación. */
export const prisma = crearClientePrisma(urlBaseDeDatos);
