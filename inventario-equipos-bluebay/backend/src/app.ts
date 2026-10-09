import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { rateLimit } from "express-rate-limit";
import session from "express-session";
import helmet from "helmet";
import { AlmacenSesionesPrisma } from "./lib/almacenSesiones.ts";
import type { ClientePrisma } from "./lib/clientePrisma.ts";
import { ErrorHttp, manejarErrores, rutaNoEncontrada } from "./lib/errores.ts";
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
  /**
   * En internet (Render): la API está detrás de un proxy con HTTPS, así que la
   * cookie solo viaja cifrada (secure) y se confía en la IP que manda el proxy.
   */
  produccion?: boolean;
  /** Carpeta con las pantallas ya compiladas (frontend/dist). Si existe, la API también las sirve. */
  carpetaFrontend?: string;
  /** Intentos de inicio de sesión permitidos por IP cada 15 minutos (aparte del bloqueo por usuario). */
  intentosPorIp?: number;
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
  produccion = false,
  carpetaFrontend,
  intentosPorIp = 30,
}: OpcionesApp) {
  const app = express();
  app.disable("x-powered-by");
  // Render pone un proxy delante: la IP real del visitante llega en X-Forwarded-For.
  if (produccion) app.set("trust proxy", 1);
  // Encabezados de seguridad (evita que otra página meta el sistema en un iframe, etc.).
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));
  app.use(
    session({
      name: NOMBRE_COOKIE,
      secret: secretoSesion,
      store: almacenSesiones,
      resave: false,
      saveUninitialized: false,
      // Sin maxAge: la cookie se borra al cerrar el navegador.
      cookie: { httpOnly: true, sameSite: "lax", secure: produccion, path: "/api" },
    }),
  );

  const equipos = crearServicioEquipos(db, reloj);
  const bajas = crearServicioBajas(db, reloj);
  const api = express.Router();
  api.get("/salud", (_req, res) => {
    res.json({ estado: "ok" });
  });

  // Frena a quien pruebe muchos usuarios distintos desde la misma computadora.
  api.post(
    "/auth/iniciar-sesion",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: intentosPorIp,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(new ErrorHttp(429, "DEMASIADAS_PETICIONES", "Demasiados intentos desde esta computadora. Espera 15 minutos e inténtalo de nuevo.")),
    }),
  );

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
  // La CSP solo protege páginas HTML; en un PDF podría dejar en blanco el visor del navegador.
  api.use("/reportes", (_req, res, next) => {
    res.removeHeader("Content-Security-Policy");
    next();
  }, rutasReportes(db, bajas, reloj));
  api.use("/usuarios", requiereRol("ADMIN"), rutasUsuarios(crearServicioUsuarios(db, relojAcceso)));
  api.use(rutaNoEncontrada);

  app.use("/api", api);

  // Pantallas compiladas: archivos estáticos y, para cualquier otra ruta
  // (/inventario/7, /usuarios…), index.html para que Vue Router la resuelva.
  if (carpetaFrontend && existsSync(path.join(carpetaFrontend, "index.html"))) {
    app.use(express.static(carpetaFrontend, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(carpetaFrontend, "index.html"), { headers: { "Cache-Control": "no-cache" } });
    });
  }

  app.use(manejarErrores);
  return app;
}
