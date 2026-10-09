import "./entorno.ts";
import { crearClientePrisma } from "./clientePrisma.ts";

const urlBaseDeDatos = process.env.DATABASE_URL;
if (!urlBaseDeDatos) {
  throw new Error("Falta la variable DATABASE_URL. Copia .env.example como .env y ajústala.");
}

/**
 * Cliente único de Prisma que usará toda la aplicación.
 * Las bases en la nube (Aiven) exigen conexión cifrada con su propio
 * certificado: se pega en DATABASE_CA (el texto completo del archivo ca.pem).
 */
export const prisma = crearClientePrisma(urlBaseDeDatos, { certificadoCa: process.env.DATABASE_CA });
