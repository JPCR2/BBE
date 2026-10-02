import "./lib/entorno.ts";
import { crearApp } from "./app.ts";
import { AlmacenSesionesPrisma } from "./lib/almacenSesiones.ts";
import { prisma } from "./lib/prisma.ts";

const puerto = Number(process.env.PUERTO ?? 3000);
// Por defecto solo escucha en este equipo. Para abrirlo a la red local: HOST=0.0.0.0
const host = process.env.HOST ?? "127.0.0.1";

const secretoSesion = process.env.SESION_SECRETO?.trim() || undefined;
if (!secretoSesion) {
  console.warn("Aviso: falta SESION_SECRETO en el archivo .env; cada vez que se reinicie la API habrá que volver a iniciar sesión.");
}

const almacenSesiones = new AlmacenSesionesPrisma(prisma);
const limpiar = () => almacenSesiones.limpiarVencidas().catch((error: unknown) => console.error("No se pudieron limpiar las sesiones vencidas:", error));
limpiar();
setInterval(limpiar, 60 * 60 * 1000).unref();

crearApp({ db: prisma, secretoSesion, almacenSesiones }).listen(puerto, host, () => {
  console.log(`API del inventario lista en http://${host}:${puerto}/api`);
});
