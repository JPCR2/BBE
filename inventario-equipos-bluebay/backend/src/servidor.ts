import "./lib/entorno.ts";
import { crearApp } from "./app.ts";
import { prisma } from "./lib/prisma.ts";

const puerto = Number(process.env.PUERTO ?? 3000);
// Por defecto solo escucha en este equipo. Para abrirlo a la red local: HOST=0.0.0.0
const host = process.env.HOST ?? "127.0.0.1";

crearApp({ db: prisma }).listen(puerto, host, () => {
  console.log(`API del inventario lista en http://${host}:${puerto}/api`);
});
