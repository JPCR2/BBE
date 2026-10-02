import { Router } from "express";
import { z } from "zod";
import type { ClientePrisma } from "../../lib/clientePrisma.ts";
import { ErrorHttp, noEncontrado } from "../../lib/errores.ts";
import { esquemaId, textoOpcional, validar } from "../../lib/validacion.ts";
import { equipoResumenDto } from "../equipos/equipos.servicio.ts";

export const esquemaCrearAsignacion = z.strictObject({
  equipoId: z.coerce.number({ error: "Selecciona un equipo." }).int().positive("Selecciona un equipo."),
  empleadoId: z.coerce.number({ error: "Selecciona un empleado." }).int().positive("Selecciona un empleado."),
  observaciones: textoOpcional(255),
});

export const esquemaDevolucion = z.strictObject({ observaciones: textoOpcional(255) });

const MOTIVO_NO_ASIGNABLE = {
  EN_MANTENIMIENTO: "Este equipo está en mantenimiento. Cámbialo a Activo para poder asignarlo.",
  BAJA: "Este equipo está dado de baja y ya no se puede asignar.",
} as const;

export function crearServicioAsignaciones(db: ClientePrisma) {
  /** Devuelve el equipo con su asignación vigente, tal como lo muestra el inventario. */
  async function equipoConVigente(equipoId: number) {
    const equipo = await db.equipo.findUniqueOrThrow({
      where: { id: equipoId },
      include: {
        asignaciones: {
          where: { fechaDevolucion: null },
          include: { empleado: { include: { departamento: true } } },
          take: 1,
        },
      },
    });
    return equipoResumenDto(equipo);
  }

  return {
    /** Entrega un equipo a un empleado. Solo equipos activos y empleados activos. */
    async crear(datos: z.output<typeof esquemaCrearAsignacion>) {
      const equipo = await db.equipo.findUnique({ where: { id: datos.equipoId } });
      if (!equipo) throw noEncontrado(`No existe el equipo con id ${datos.equipoId}.`);
      if (equipo.estado !== "ACTIVO") {
        throw new ErrorHttp(409, "EQUIPO_NO_ASIGNABLE", MOTIVO_NO_ASIGNABLE[equipo.estado]);
      }

      const empleado = await db.empleado.findUnique({ where: { id: datos.empleadoId } });
      if (!empleado) throw noEncontrado(`No existe el empleado con id ${datos.empleadoId}.`);
      if (!empleado.activo) {
        throw new ErrorHttp(
          409,
          "EMPLEADO_INACTIVO",
          `El registro de ${empleado.nombre} ${empleado.apellidos} está inactivo. Actívalo antes de asignarle un equipo.`,
        );
      }

      const vigente = await db.asignacion.findFirst({
        where: { equipoId: datos.equipoId, fechaDevolucion: null },
        include: { empleado: true },
      });
      if (vigente) {
        throw new ErrorHttp(
          409,
          "ASIGNACION_VIGENTE",
          `El equipo ${equipo.numeroSerie} ya está asignado a ${vigente.empleado.nombre} ${vigente.empleado.apellidos}. Registra la devolución antes de reasignarlo.`,
        );
      }

      const asignacion = await db.asignacion.create({
        data: { equipoId: datos.equipoId, empleadoId: datos.empleadoId, observaciones: datos.observaciones ?? null },
      });
      return {
        asignacion: {
          id: asignacion.id,
          fechaAsignacion: asignacion.fechaAsignacion.toISOString(),
          observaciones: asignacion.observaciones,
        },
        equipo: await equipoConVigente(datos.equipoId),
      };
    },

    /** Registra la devolución con la fecha y hora del momento. */
    async devolver(id: number, datos: z.output<typeof esquemaDevolucion>) {
      const asignacion = await db.asignacion.findUnique({ where: { id }, include: { empleado: true, equipo: true } });
      if (!asignacion) throw noEncontrado(`No existe la asignación con id ${id}.`);
      if (asignacion.fechaDevolucion) {
        throw new ErrorHttp(
          409,
          "ASIGNACION_YA_DEVUELTA",
          `Esta asignación ya tiene registrada la devolución del equipo ${asignacion.equipo.numeroSerie}.`,
        );
      }
      // La devolución nunca puede quedar antes de la entrega.
      const ahora = new Date();
      const fechaDevolucion = ahora < asignacion.fechaAsignacion ? asignacion.fechaAsignacion : ahora;
      const devuelta = await db.asignacion.update({
        where: { id },
        data: { fechaDevolucion, observacionesDevolucion: datos.observaciones ?? null },
      });
      return {
        asignacion: {
          id: devuelta.id,
          fechaAsignacion: devuelta.fechaAsignacion.toISOString(),
          fechaDevolucion: devuelta.fechaDevolucion!.toISOString(),
          observacionesDevolucion: devuelta.observacionesDevolucion,
        },
        equipo: await equipoConVigente(asignacion.equipoId),
      };
    },
  };
}

export type ServicioAsignaciones = ReturnType<typeof crearServicioAsignaciones>;

export function rutasAsignaciones(servicio: ServicioAsignaciones): Router {
  const rutas = Router();

  rutas.post("/", async (req, res) => {
    res.status(201).json(await servicio.crear(validar(esquemaCrearAsignacion, req.body)));
  });

  rutas.post("/:id/devolucion", async (req, res) => {
    const id = validar(esquemaId, req.params.id);
    res.json(await servicio.devolver(id, validar(esquemaDevolucion, req.body)));
  });

  return rutas;
}
