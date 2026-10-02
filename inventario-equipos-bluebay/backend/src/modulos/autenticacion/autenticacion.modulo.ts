import bcrypt from "bcryptjs";
import type { Request, RequestHandler, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import type { RolUsuario } from "../../generated/prisma/client.ts";
import type { ClientePrisma } from "../../lib/clientePrisma.ts";
import { ErrorHttp } from "../../lib/errores.ts";
import { validar } from "../../lib/validacion.ts";

// -----------------------------------------------------------------------------
// Contraseñas
// -----------------------------------------------------------------------------

/** Costo de bcrypt: ~0.1 s por intento; suficiente para frenar ataques de fuerza bruta. */
const RONDAS_BCRYPT = 10;
export const MINIMO_CONTRASENA = 8;
/** bcrypt solo toma en cuenta los primeros 72 bytes. */
const MAXIMO_BYTES_CONTRASENA = 72;

export const MAXIMO_INTENTOS = 5;
export const MINUTOS_BLOQUEO = 15;

export function cifrarContrasena(contrasena: string): Promise<string> {
  return bcrypt.hash(contrasena, RONDAS_BCRYPT);
}

/** Se compara contra este hash cuando el usuario no existe, para tardar lo mismo y no revelar qué usuarios hay. */
const HASH_SIMULADO = bcrypt.hashSync("contrasena-que-nadie-usa", RONDAS_BCRYPT);

/** Contraseña nueva: no se recorta (los espacios cuentan), 8 caracteres mínimo. */
export const esquemaContrasenaNueva = z
  .string({ error: "Escribe la contraseña." })
  .min(MINIMO_CONTRASENA, `Debe tener al menos ${MINIMO_CONTRASENA} caracteres.`)
  .refine((valor) => valor.trim() !== "", "La contraseña no puede ser solo espacios.")
  .refine((valor) => Buffer.byteLength(valor, "utf8") <= MAXIMO_BYTES_CONTRASENA, "Es demasiado larga (máximo 72 caracteres).");

/** Nombre de usuario: se recorta y se pasa a minúsculas ("  JPolanco " → "jpolanco"). */
export const esquemaNombreUsuario = z
  .string({ error: "Escribe el nombre de usuario." })
  .trim()
  .toLowerCase()
  .min(1, "Escribe el nombre de usuario.")
  .regex(/^[a-z0-9._-]{3,40}$/, "Usa de 3 a 40 letras sin acentos, números, punto, guion o guion bajo.");

// -----------------------------------------------------------------------------
// Usuario en sesión
// -----------------------------------------------------------------------------

export interface UsuarioSesion {
  id: number;
  usuario: string;
  nombre: string;
  rol: RolUsuario;
}

const camposSesion = { id: true, usuario: true, nombre: true, rol: true } as const;

/** Usuario que hizo la petición (lo deja `requiereSesion`). */
export function usuarioActual(res: Response): UsuarioSesion {
  return res.locals.usuario as UsuarioSesion;
}

/**
 * Exige una sesión válida. El usuario se vuelve a leer de la base en cada
 * petición: si lo desactivan o le cambian el rol, aplica de inmediato.
 */
export function requiereSesion(db: ClientePrisma): RequestHandler {
  return async (req, res, next) => {
    const id = req.session.usuarioId;
    if (!id) return next(new ErrorHttp(401, "NO_AUTENTICADO", "Inicia sesión para continuar."));
    const usuario = await db.usuario.findUnique({ where: { id }, select: { ...camposSesion, activo: true } });
    if (!usuario || !usuario.activo) {
      await destruirSesion(req);
      return next(new ErrorHttp(401, "NO_AUTENTICADO", "Tu sesión terminó. Vuelve a iniciar sesión."));
    }
    const { activo: _activo, ...datos } = usuario;
    res.locals.usuario = datos satisfies UsuarioSesion;
    next();
  };
}

export function requiereRol(rol: RolUsuario): RequestHandler {
  return (_req, res, next) => {
    if (usuarioActual(res).rol !== rol) {
      return next(new ErrorHttp(403, "SIN_PERMISO", "Esta sección es solo para administradores."));
    }
    next();
  };
}

function destruirSesion(req: Request): Promise<void> {
  return new Promise((resolver, rechazar) => req.session.destroy((error) => (error ? rechazar(error) : resolver())));
}

/** Cambia el id de la sesión al iniciar sesión (evita que alguien fije la cookie de antemano). */
function regenerarSesion(req: Request): Promise<void> {
  return new Promise((resolver, rechazar) => req.session.regenerate((error) => (error ? rechazar(error) : resolver())));
}

function guardarSesion(req: Request): Promise<void> {
  return new Promise((resolver, rechazar) => req.session.save((error) => (error ? rechazar(error) : resolver())));
}

// -----------------------------------------------------------------------------
// Servicio
// -----------------------------------------------------------------------------

const esquemaInicioSesion = z.strictObject({
  usuario: z.string({ error: "Escribe tu usuario." }).trim().toLowerCase().min(1, "Escribe tu usuario.").max(40, "Usuario o contraseña incorrectos."),
  contrasena: z.string({ error: "Escribe tu contraseña." }).min(1, "Escribe tu contraseña.").max(200, "Usuario o contraseña incorrectos."),
});

const esquemaCambioContrasena = z.strictObject({
  contrasenaActual: z.string({ error: "Escribe tu contraseña actual." }).min(1, "Escribe tu contraseña actual."),
  contrasenaNueva: esquemaContrasenaNueva,
});

function minutosRestantes(hasta: Date, ahora: Date): number {
  return Math.max(1, Math.ceil((hasta.getTime() - ahora.getTime()) / 60_000));
}

export function crearServicioAutenticacion(db: ClientePrisma, reloj: () => Date) {
  const incorrectos = () => new ErrorHttp(401, "CREDENCIALES_INVALIDAS", "Usuario o contraseña incorrectos.");

  return {
    /**
     * Verifica usuario y contraseña. Tras 5 intentos fallidos seguidos el
     * usuario queda bloqueado 15 minutos (aunque luego escriba bien la contraseña).
     */
    async verificar(datos: { usuario: string; contrasena: string }): Promise<UsuarioSesion> {
      const ahora = reloj();
      const usuario = await db.usuario.findUnique({ where: { usuario: datos.usuario } });
      if (!usuario) {
        await bcrypt.compare(datos.contrasena, HASH_SIMULADO);
        throw incorrectos();
      }

      if (usuario.bloqueadoHasta && usuario.bloqueadoHasta > ahora) {
        const minutos = minutosRestantes(usuario.bloqueadoHasta, ahora);
        throw new ErrorHttp(
          429,
          "USUARIO_BLOQUEADO",
          `Por seguridad, el usuario está bloqueado por demasiados intentos fallidos. Intenta de nuevo en ${minutos} ${minutos === 1 ? "minuto" : "minutos"} o pide a un administrador que restablezca tu contraseña.`,
        );
      }

      const correcta = await bcrypt.compare(datos.contrasena, usuario.contrasenaHash);
      if (!correcta) {
        // Si el bloqueo anterior ya venció, se empieza a contar de nuevo.
        const previos = usuario.bloqueadoHasta ? 0 : usuario.intentosFallidos;
        const intentos = previos + 1;
        if (intentos >= MAXIMO_INTENTOS) {
          await db.usuario.update({
            where: { id: usuario.id },
            data: { intentosFallidos: 0, bloqueadoHasta: new Date(ahora.getTime() + MINUTOS_BLOQUEO * 60_000) },
          });
          throw new ErrorHttp(
            429,
            "USUARIO_BLOQUEADO",
            `Escribiste mal la contraseña ${MAXIMO_INTENTOS} veces. Por seguridad, el usuario queda bloqueado ${MINUTOS_BLOQUEO} minutos.`,
          );
        }
        await db.usuario.update({ where: { id: usuario.id }, data: { intentosFallidos: intentos, bloqueadoHasta: null } });
        throw incorrectos();
      }

      if (!usuario.activo) {
        throw new ErrorHttp(403, "USUARIO_INACTIVO", "Tu usuario está desactivado. Pide a un administrador que lo reactive.");
      }

      await db.usuario.update({ where: { id: usuario.id }, data: { intentosFallidos: 0, bloqueadoHasta: null, ultimoAcceso: ahora } });
      return { id: usuario.id, usuario: usuario.usuario, nombre: usuario.nombre, rol: usuario.rol };
    },

    /** Cambia la contraseña propia y cierra las demás sesiones abiertas de ese usuario. */
    async cambiarContrasena(usuarioId: number, idSesionActual: string, datos: { contrasenaActual: string; contrasenaNueva: string }) {
      const usuario = await db.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
      if (!(await bcrypt.compare(datos.contrasenaActual, usuario.contrasenaHash))) {
        const mensaje = "La contraseña actual no es correcta.";
        throw new ErrorHttp(400, "DATOS_INVALIDOS", mensaje, { contrasenaActual: mensaje });
      }
      if (datos.contrasenaActual === datos.contrasenaNueva) {
        const mensaje = "La nueva contraseña debe ser distinta de la actual.";
        throw new ErrorHttp(400, "DATOS_INVALIDOS", mensaje, { contrasenaNueva: mensaje });
      }
      await db.$transaction([
        db.usuario.update({ where: { id: usuarioId }, data: { contrasenaHash: await cifrarContrasena(datos.contrasenaNueva) } }),
        db.sesion.deleteMany({ where: { usuarioId, id: { not: idSesionActual } } }),
      ]);
    },
  };
}

export type ServicioAutenticacion = ReturnType<typeof crearServicioAutenticacion>;

// -----------------------------------------------------------------------------
// Rutas: /api/auth
// -----------------------------------------------------------------------------

export function rutasAutenticacion(servicio: ServicioAutenticacion, sesionValida: RequestHandler): Router {
  const rutas = Router();

  rutas.post("/iniciar-sesion", async (req, res) => {
    const usuario = await servicio.verificar(validar(esquemaInicioSesion, req.body));
    await regenerarSesion(req);
    req.session.usuarioId = usuario.id;
    await guardarSesion(req);
    res.json({ usuario });
  });

  rutas.post("/cerrar-sesion", async (req, res) => {
    await destruirSesion(req);
    res.clearCookie(NOMBRE_COOKIE, { path: "/api" });
    res.status(204).end();
  });

  rutas.get("/sesion", sesionValida, (_req, res) => {
    res.json({ usuario: usuarioActual(res) });
  });

  rutas.post("/cambiar-contrasena", sesionValida, async (req, res) => {
    await servicio.cambiarContrasena(usuarioActual(res).id, req.sessionID, validar(esquemaCambioContrasena, req.body));
    res.status(204).end();
  });

  return rutas;
}

export const NOMBRE_COOKIE = "inventario.sid";
