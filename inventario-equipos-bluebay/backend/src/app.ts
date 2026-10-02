import { randomBytes } from "node:crypto";
import express from "express";
import session from "express-session";
import { AlmacenSesionesPrisma } from "./lib/almacenSesiones.ts";
import type { ClientePrisma } from "./lib/clientePrisma.ts";
import { manejarErrores, rutaNoEncontrada } from "./lib/errores.ts";
import {
  crearServicioAutenticacion,
  NOMBRE_COOKIE,
  requiereRol,
  requiereSesion,
  rutasAutenticacion,
} from "./modulos/autenticacion/autenticacion.modulo.ts";
import { crearServicioAsignaciones, rutasAsignaciones } from "./modulos/asignaciones/asignaciones.modulo.ts";
import { crearServicioBajas, rutasBajas } from "./modulos/bajas/bajas.modulo.ts";
import { crearServicioDepartamentos, rutasDepartamentos } from "./modulos/departamentos/departamentos.modulo.ts";
import { crearServicioEmpleados, rutasEmpleados } from "./modulos/empleados/empleados.modulo.ts";
import { rutasEquipos } from "./modulos/equipos/equipos.rutas.ts";
import { crearServicioEquipos } from "./modulos/equipos/equipos.servicio.ts";
import { crearServicioMantenimientos, rutasMantenimientos } from "./modulos/mantenimientos/mantenimientos.modulo.ts";
import { rutasReportes } from "./modulos/reportes/reportes.rutas.ts";
import { crearServicioUsuarios, rutasUsuarios } from "./modulos/usuarios/usuarios.modulo.ts";

interface OpcionesApp {
  db: ClientePrisma;
  /** Reloj del negocio: fechas de mantenimiento, bajas, reportes. */
  reloj?: () => Date;
  /** Reloj de las sesiones y los bloqueos por intentos fallidos (se separa para poder probarlos). */
  relojAcceso?: () => Date;
  /** Firma la cookie de sesión. Si no se da, se genera uno al azar (las sesiones se pierden al reiniciar). */
  secretoSesion?: string;
  almacenSesiones?: AlmacenSesionesPrisma;
}

/**
 * Construye la aplicación Express. Recibe el cliente de base de datos como
 * parámetro para que las pruebas usen la base inventario_test. Los relojes
 * también se pueden fijar para probar avisos por fecha y bloqueos de acceso.
 * Solo /api/salud y /api/auth/iniciar-sesion funcionan sin sesión.
 */
export function crearApp({
  db,
  reloj = () => new Date(),
  relojAcceso = () => new Date(),
  secretoSesion = randomBytes(32).toString("hex"),
  almacenSesiones = new AlmacenSesionesPrisma(db, relojAcceso),
}: OpcionesApp) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use(
    session({
      name: NOMBRE_COOKIE,
      secret: secretoSesion,
      store: almacenSesiones,
      resave: false,
      saveUninitialized: false,
      // Sin maxAge: la cookie se borra al cerrar el navegador.
      cookie: { httpOnly: true, sameSite: "lax", secure: false, path: "/api" },
    }),
  );

  const equipos = crearServicioEquipos(db, reloj);
  const bajas = crearServicioBajas(db, reloj);
  const api = express.Router();
  api.get("/salud", (_req, res) => {
    res.json({ estado: "ok" });
  });

  // Lo que está debajo de requiereSesion exige haber iniciado sesión.
  const sesionValida = requiereSesion(db);
  api.use("/auth", rutasAutenticacion(crearServicioAutenticacion(db, relojAcceso), sesionValida));
  api.use(sesionValida);
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
  api.use("/usuarios", requiereRol("ADMIN"), rutasUsuarios(crearServicioUsuarios(db, relojAcceso)));
  api.use(rutaNoEncontrada);

  app.use("/api", api);
  app.use(manejarErrores);
  return app;
}
