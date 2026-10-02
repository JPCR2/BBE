import { Router } from "express";
import { z } from "zod";
import type { ClientePrisma } from "../../lib/clientePrisma.ts";
import { ErrorHttp, noEncontrado } from "../../lib/errores.ts";
import { esquemaId, textoObligatorio, validar } from "../../lib/validacion.ts";
import { cifrarContrasena, esquemaContrasenaNueva, esquemaNombreUsuario, usuarioActual } from "../autenticacion/autenticacion.modulo.ts";

const rol = z.enum(["ADMIN", "TECNICO"], { error: "Elige el rol: Administrador o Técnico." });
const nombre = textoObligatorio("Escribe el nombre completo.", 100);

export const esquemaCrearUsuario = z.strictObject({
  usuario: esquemaNombreUsuario,
  nombre,
  rol,
  contrasena: esquemaContrasenaNueva,
});

export const esquemaEditarUsuario = z
  .strictObject({
    nombre: nombre.optional(),
    rol: rol.optional(),
    activo: z.boolean({ error: "Indica si el usuario está activo (true o false)." }).optional(),
  })
  .refine((datos) => Object.keys(datos).length > 0, "No hay cambios que guardar.");

export const esquemaRestablecerContrasena = z.strictObject({ contrasena: esquemaContrasenaNueva });

const camposPublicos = {
  id: true, usuario: true, nombre: true, rol: true, activo: true, ultimoAcceso: true, bloqueadoHasta: true, creadoEn: true,
} as const;

type FilaUsuario = { bloqueadoHasta: Date | null } & Record<string, unknown>;

/**
 * Gestión de usuarios del sistema (solo administradores). Los usuarios no se
 * borran: se desactivan. Un administrador no puede desactivarse ni quitarse
 * el rol a sí mismo; así siempre queda al menos un administrador activo.
 */
export function crearServicioUsuarios(db: ClientePrisma, reloj: () => Date) {
  /** Agrega `bloqueado` (true mientras dure el bloqueo por intentos fallidos). */
  function publico<T extends FilaUsuario>(fila: T) {
    return { ...fila, bloqueado: fila.bloqueadoHasta !== null && fila.bloqueadoHasta > reloj() };
  }

  async function buscar(id: number) {
    const usuario = await db.usuario.findUnique({ where: { id }, select: camposPublicos });
    if (!usuario) throw noEncontrado(`No existe el usuario con id ${id}.`);
    return usuario;
  }

  return {
    /** Activos primero y luego por nombre. */
    async listar() {
      const usuarios = await db.usuario.findMany({ select: camposPublicos, orderBy: [{ activo: "desc" }, { nombre: "asc" }] });
      return { datos: usuarios.map(publico) };
    },

    async crear(datos: z.output<typeof esquemaCrearUsuario>) {
      const existente = await db.usuario.findUnique({ where: { usuario: datos.usuario } });
      if (existente) {
        const mensaje = `Ya existe el usuario «${existente.usuario}».`;
        throw new ErrorHttp(409, "DUPLICADO", mensaje, { usuario: mensaje });
      }
      const { contrasena, ...resto } = datos;
      const creado = await db.usuario.create({
        data: { ...resto, contrasenaHash: await cifrarContrasena(contrasena) },
        select: camposPublicos,
      });
      return publico(creado);
    },

    async editar(id: number, idPropio: number, datos: z.output<typeof esquemaEditarUsuario>) {
      const actual = await buscar(id);
      if (id === idPropio) {
        if (datos.activo === false) {
          throw new ErrorHttp(409, "ACCION_SOBRE_SI_MISMO", "No puedes desactivar tu propio usuario.");
        }
        if (datos.rol !== undefined && datos.rol !== actual.rol) {
          throw new ErrorHttp(409, "ACCION_SOBRE_SI_MISMO", "No puedes cambiar tu propio rol; pídeselo a otro administrador.");
        }
      }
      const guardado = await db.$transaction(async (tx) => {
        const fila = await tx.usuario.update({ where: { id }, data: datos, select: camposPublicos });
        // Al desactivarlo se cierran sus sesiones abiertas.
        if (datos.activo === false) await tx.sesion.deleteMany({ where: { usuarioId: id } });
        return fila;
      });
      return publico(guardado);
    },

    /**
     * Pone una contraseña nueva a otro usuario (p. ej. si la olvidó), le quita
     * el bloqueo y cierra sus sesiones. La propia se cambia en "Cambiar contraseña".
     */
    async restablecerContrasena(id: number, idPropio: number, contrasena: string) {
      await buscar(id);
      if (id === idPropio) {
        throw new ErrorHttp(409, "ACCION_SOBRE_SI_MISMO", "Para tu propia contraseña usa «Cambiar mi contraseña» en el menú de tu usuario.");
      }
      const contrasenaHash = await cifrarContrasena(contrasena);
      const [guardado] = await db.$transaction([
        db.usuario.update({ where: { id }, data: { contrasenaHash, intentosFallidos: 0, bloqueadoHasta: null }, select: camposPublicos }),
        db.sesion.deleteMany({ where: { usuarioId: id } }),
      ]);
      return publico(guardado);
    },
  };
}

export type ServicioUsuarios = ReturnType<typeof crearServicioUsuarios>;

export function rutasUsuarios(servicio: ServicioUsuarios): Router {
  const rutas = Router();

  rutas.get("/", async (_req, res) => {
    res.json(await servicio.listar());
  });

  rutas.post("/", async (req, res) => {
    res.status(201).json(await servicio.crear(validar(esquemaCrearUsuario, req.body)));
  });

  rutas.patch("/:id", async (req, res) => {
    const id = validar(esquemaId, req.params.id);
    res.json(await servicio.editar(id, usuarioActual(res).id, validar(esquemaEditarUsuario, req.body)));
  });

  rutas.post("/:id/restablecer-contrasena", async (req, res) => {
    const id = validar(esquemaId, req.params.id);
    const { contrasena } = validar(esquemaRestablecerContrasena, req.body);
    res.json(await servicio.restablecerContrasena(id, usuarioActual(res).id, contrasena));
  });

  return rutas;
}
