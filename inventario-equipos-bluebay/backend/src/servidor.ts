import "./lib/entorno.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crearApp } from "./app.ts";
import { AlmacenSesionesPrisma } from "./lib/almacenSesiones.ts";
import { prisma } from "./lib/prisma.ts";

const produccion = process.env.NODE_ENV === "production";
// Render indica el puerto en PORT; en la computadora se usa PUERTO o 3000.
const puerto = Number(process.env.PORT ?? process.env.PUERTO ?? 3000);
// En la computadora solo escucha en este equipo; en internet debe escuchar en todas las interfaces.
const host = process.env.HOST ?? (produccion ? "0.0.0.0" : "127.0.0.1");

const secretoSesion = process.env.SESION_SECRETO?.trim() || undefined;
if (!secretoSesion) {
  if (produccion) {
    console.error("Falta SESION_SECRETO. En internet es obligatorio: agrégalo en las variables de entorno del servidor.");
    process.exit(1);
  }
  console.warn("Aviso: falta SESION_SECRETO en el archivo .env; cada vez que se reinicie la API habrá que volver a iniciar sesión.");
}

const almacenSesiones = new AlmacenSesionesPrisma(prisma);
const limpiar = () => almacenSesiones.limpiarVencidas().catch((error: unknown) => console.error("No se pudieron limpiar las sesiones vencidas:", error));
limpiar();
setInterval(limpiar, 60 * 60 * 1000).unref();

// Las pantallas compiladas (npm run build en frontend) se sirven desde la misma API.
const carpetaFrontend = process.env.CARPETA_FRONTEND
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/dist");

crearApp({ db: prisma, secretoSesion, almacenSesiones, produccion, carpetaFrontend }).listen(puerto, host, () => {
  console.log(`Inventario listo en http://${host}:${puerto} (API en /api${produccion ? ", modo producción" : ""})`);
});
