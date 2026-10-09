/**
 * Aplica las migraciones pendientes (prisma migrate deploy). Solo agrega lo
 * nuevo; nunca borra datos. Lo usa el servidor de internet al arrancar y
 * también se puede correr a mano:   npm run nube:migrar
 *
 * Si hay DATABASE_CA (certificado de Aiven), lo guarda en un archivo temporal
 * y le pide a Prisma una conexión cifrada que verifique ese certificado.
 */
import "../src/lib/entorno.ts";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL.");
  process.exit(1);
}

const certificado = process.env.DATABASE_CA?.trim();
let urlMigracion = url;
if (certificado) {
  const archivo = path.join(mkdtempSync(path.join(tmpdir(), "ca-")), "ca.pem");
  writeFileSync(archivo, certificado.replace(/\n/g, "\n"));
  const conCertificado = new URL(url);
  conCertificado.searchParams.delete("ssl-mode");
  conCertificado.searchParams.set("sslcert", archivo);
  conCertificado.searchParams.set("sslaccept", "strict");
  urlMigracion = conCertificado.toString();
}

const resultado = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, DATABASE_URL: urlMigracion },
});
process.exit(resultado.status ?? 1);
