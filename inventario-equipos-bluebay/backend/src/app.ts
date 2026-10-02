import express from "express";
import type { ClientePrisma } from "./lib/clientePrisma.ts";
import { manejarErrores, rutaNoEncontrada } from "./lib/errores.ts";
import { crearServicioAsignaciones, rutasAsignaciones } from "./modulos/asignaciones/asignaciones.modulo.ts";
import { crearServicioBajas, rutasBajas } from "./modulos/bajas/bajas.modulo.ts";
import { crearServicioDepartamentos, rutasDepartamentos } from "./modulos/departamentos/departamentos.modulo.ts";
import { crearServicioEmpleados, rutasEmpleados } from "./modulos/empleados/empleados.modulo.ts";
import { rutasEquipos } from "./modulos/equipos/equipos.rutas.ts";
import { crearServicioEquipos } from "./modulos/equipos/equipos.servicio.ts";
import { crearServicioMantenimientos, rutasMantenimientos } from "./modulos/mantenimientos/mantenimientos.modulo.ts";
import { rutasReportes } from "./modulos/reportes/reportes.rutas.ts";

/**
 * Construye la aplicación Express. Recibe el cliente de base de datos como
 * parámetro para que las pruebas usen la base inventario_test. El reloj
 * también se puede fijar para probar los avisos de mantenimiento por fecha.
 */
export function crearApp({ db, reloj = () => new Date() }: { db: ClientePrisma; reloj?: () => Date }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  const equipos = crearServicioEquipos(db, reloj);
  const bajas = crearServicioBajas(db, reloj);
  const api = express.Router();
  api.get("/salud", (_req, res) => {
    res.json({ estado: "ok" });
  });
  api.get("/resumen", async (_req, res) => {
    res.json(await equipos.resumen());
  });
  api.use("/equipos", rutasEquipos(equipos));
  api.use("/departamentos", rutasDepartamentos(crearServicioDepartamentos(db)));
  api.use("/empleados", rutasEmpleados(crearServicioEmpleados(db)));
  api.use("/asignaciones", rutasAsignaciones(crearServicioAsignaciones(db)));
  api.use("/mantenimientos", rutasMantenimientos(crearServicioMantenimientos(db, reloj)));
  api.use("/bajas", rutasBajas(bajas));
  api.use("/reportes", rutasReportes(db, bajas, reloj));
  api.use(rutaNoEncontrada);

  app.use("/api", api);
  app.use(manejarErrores);
  return app;
}
