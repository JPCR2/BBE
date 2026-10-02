import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mariadb from "mariadb";

const carpetaMigraciones = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../prisma/migrations",
);

/**
 * Borra y recrea la base de pruebas y le aplica todas las migraciones en orden.
 * Cada migration.sql se envía completo al servidor (varias sentencias a la vez),
 * que es la misma forma en que Prisma las ejecuta; así también se prueba que el
 * archivo de triggers funciona sin "DELIMITER".
 */
export async function recrearBaseDePrueba(urlPrueba: string): Promise<void> {
  const url = new URL(urlPrueba);
  const nombreBase = url.pathname.replace(/^\//, "");
  if (!/_test$/.test(nombreBase)) {
    throw new Error(`Por seguridad, la base de pruebas debe terminar en "_test" (se recibió "${nombreBase}").`);
  }

  const opciones = {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };

  const servidor = await mariadb.createConnection(opciones);
  try {
    await servidor.query(`DROP DATABASE IF EXISTS \`${nombreBase}\``);
    await servidor.query(`CREATE DATABASE \`${nombreBase}\``);
  } finally {
    await servidor.end();
  }

  const conexion = await mariadb.createConnection({ ...opciones, database: nombreBase, multipleStatements: true });
  try {
    const carpetas = (await readdir(carpetaMigraciones, { withFileTypes: true }))
      .filter((entrada) => entrada.isDirectory())
      .map((entrada) => entrada.name)
      .sort();
    for (const carpeta of carpetas) {
      const sql = await readFile(path.join(carpetaMigraciones, carpeta, "migration.sql"), "utf8");
      await conexion.query(sql);
    }
  } finally {
    await conexion.end();
  }
}
