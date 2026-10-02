import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.ts";
import { EstadoMantenimiento, TipoMantenimiento } from "../../generated/prisma/enums.ts";
import type { ClientePrisma } from "../../lib/clientePrisma.ts";
import { normalizarNumeroSerie } from "../../lib/clientePrisma.ts";
import { escaparComodines } from "../../lib/busqueda.ts";
import { ErrorHttp, noEncontrado } from "../../lib/errores.ts";
import { fechaATexto, fechaDesdeTexto, hoyEnElHotel, sumarDias } from "../../lib/fechas.ts";
import { esquemaId, fechaCalendario, textoObligatorio, textoOpcional, vacioAUndefined, validar } from "../../lib/validacion.ts";

/** Días de anticipación con que se avisa de un mantenimiento próximo (acordado con el hotel). */
export const DIAS_AVISO = 7;

// -----------------------------------------------------------------------------
// Esquemas de entrada
// -----------------------------------------------------------------------------

const tipo = z.enum(TipoMantenimiento, { error: "Selecciona si es preventivo o correctivo." });
const descripcion = textoObligatorio("Describe qué se hará o qué se hizo.", 2000);

/**
 * Programar (lo normal) o registrar uno que ya se hizo (por ejemplo, un
 * correctivo urgente que se atendió en el momento).
 */
export const esquemaCrearMantenimiento = z.discriminatedUnion(
  "estado",
  [
    z.strictObject({
      estado: z.literal(EstadoMantenimiento.PROGRAMADO),
      equipoId: z.coerce.number({ error: "Selecciona un equipo." }).int().positive("Selecciona un equipo."),
      tipo,
      descripcion,
      responsable: textoOpcional(100),
      fechaProgramada: fechaCalendario("Elige la fecha programada."),
    }),
    z.strictObject({
      estado: z.literal(EstadoMantenimiento.REALIZADO),
      equipoId: z.coerce.number({ error: "Selecciona un equipo." }).int().positive("Selecciona un equipo."),
      tipo,
      descripcion,
      responsable: textoOpcional(100),
      fechaRealizacion: fechaCalendario("Elige la fecha en que se realizó."),
    }),
  ],
  { error: "Indica si el mantenimiento se programa (PROGRAMADO) o ya se realizó (REALIZADO)." },
);

/** El estado es opcional al programar: si no se envía, se programa. */
function conEstadoPorDefecto(cuerpo: unknown) {
  if (typeof cuerpo === "object" && cuerpo !== null && !("estado" in cuerpo)) {
    return { ...cuerpo, estado: EstadoMantenimiento.PROGRAMADO };
  }
  return cuerpo;
}

/** Editar o reprogramar un mantenimiento que sigue programado. */
export const esquemaEditarMantenimiento = z
  .strictObject({ tipo, descripcion, responsable: textoOpcional(100), fechaProgramada: fechaCalendario("Elige la fecha programada.") })
  .partial()
  .refine((datos) => Object.keys(datos).length > 0, { message: "Envía al menos un campo para modificar." });

export const esquemaRegistrarRealizado = z.strictObject({
  /** Si no se envía, se toma la fecha de hoy en el hotel. */
  fechaRealizacion: z.preprocess(vacioAUndefined, fechaCalendario("Elige la fecha en que se realizó.").optional()),
  responsable: textoOpcional(100),
  /** Lo que realmente se hizo; si no se envía se conserva la descripción original. */
  descripcion: z.preprocess(vacioAUndefined, descripcion.optional()),
});

const esquemaMes = z
  .string({ error: "El mes debe tener el formato AAAA-MM." })
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "El mes debe tener el formato AAAA-MM, por ejemplo 2026-09.")
  .refine((texto) => {
    const anio = Number(texto.slice(0, 4));
    return anio >= 1900 && anio <= 2100;
  }, "El año debe estar entre 1900 y 2100.");

export const esquemaCalendario = z.object({ mes: z.preprocess(vacioAUndefined, esquemaMes.optional()) });

export const esquemaListarMantenimientos = z.object({
  equipoId: z.preprocess(vacioAUndefined, z.coerce.number().int().positive("Equipo no válido.").optional()),
  estado: z.preprocess(vacioAUndefined, z.enum(EstadoMantenimiento, { error: "Estado no válido." }).optional()),
  tipo: z.preprocess(vacioAUndefined, tipo.optional()),
  /** Número de serie (o parte de él). */
  busqueda: z.preprocess(vacioAUndefined, z.string().trim().max(100, "Máximo 100 caracteres.").optional()),
  pagina: z.preprocess(vacioAUndefined, z.coerce.number().int().min(1, "La página empieza en 1.").default(1)),
  porPagina: z.preprocess(
    vacioAUndefined,
    z.coerce.number().int().min(1).max(100, "Máximo 100 mantenimientos por página.").default(20),
  ),
});

type DatosCrear = z.output<typeof esquemaCrearMantenimiento>;
type DatosEditar = z.output<typeof esquemaEditarMantenimiento>;
type DatosRealizado = z.output<typeof esquemaRegistrarRealizado>;
type FiltrosListado = z.output<typeof esquemaListarMantenimientos>;

// -----------------------------------------------------------------------------
// Formato de salida
// -----------------------------------------------------------------------------

/**
 * Situación que ve la persona. "Vencido" y "próximo" no se guardan: se calculan
 * contra la fecha de hoy en el hotel para que nunca queden desactualizados.
 */
export type Situacion = "VENCIDO" | "PROXIMO" | "PROGRAMADO" | "REALIZADO" | "CANCELADO";

const conEquipo = { equipo: true } satisfies Prisma.MantenimientoInclude;
type MantenimientoConEquipo = Prisma.MantenimientoGetPayload<{ include: typeof conEquipo }>;

const MS_POR_DIA = 86_400_000;

function situacionDe(m: { estado: EstadoMantenimiento; fechaProgramada: Date | null }, hoy: Date): Situacion {
  if (m.estado !== "PROGRAMADO") return m.estado;
  if (m.fechaProgramada! < hoy) return "VENCIDO";
  if (m.fechaProgramada! <= sumarDias(hoy, DIAS_AVISO)) return "PROXIMO";
  return "PROGRAMADO";
}

/** La fecha con la que aparece en el calendario: cuándo se hizo, o cuándo toca. */
function fechaDelCalendario(m: { estado: EstadoMantenimiento; fechaProgramada: Date | null; fechaRealizacion: Date | null }) {
  return m.estado === "REALIZADO" ? m.fechaRealizacion! : (m.fechaProgramada ?? m.fechaRealizacion!);
}

type MantenimientoFila = Prisma.MantenimientoGetPayload<object>;

/** Forma sin datos del equipo; la usa la ficha del equipo. */
export function mantenimientoBaseDto(m: MantenimientoFila, hoy: Date) {
  return {
    id: m.id,
    tipo: m.tipo,
    estado: m.estado,
    situacion: situacionDe(m, hoy),
    fechaProgramada: m.fechaProgramada ? fechaATexto(m.fechaProgramada) : null,
    fechaRealizacion: m.fechaRealizacion ? fechaATexto(m.fechaRealizacion) : null,
    fecha: fechaATexto(fechaDelCalendario(m)),
    /** Días que faltan (negativo = días de retraso). Solo si sigue programado. */
    diasRestantes:
      m.estado === "PROGRAMADO" ? Math.round((m.fechaProgramada!.getTime() - hoy.getTime()) / MS_POR_DIA) : null,
    descripcion: m.descripcion,
    responsable: m.responsable,
  };
}

/** Del más reciente al más antiguo según la fecha con que aparece en el calendario. */
export function ordenarRecientesPrimero<T extends { fecha: string; id: number }>(lista: T[]): T[] {
  return lista.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
}

export type AvisoEquipo = { situacion: "VENCIDO" | "PROXIMO"; fecha: string };

/** Para el inventario: el aviso más urgente de cada equipo (vencido o próximo), o nada. */
export async function avisosPorEquipo(db: ClientePrisma, equipoIds: number[], hoy: Date) {
  const porEquipo = new Map<number, AvisoEquipo>();
  if (equipoIds.length === 0) return porEquipo;
  const pendientes = await db.mantenimiento.findMany({
    where: { equipoId: { in: equipoIds }, estado: "PROGRAMADO", fechaProgramada: { lte: sumarDias(hoy, DIAS_AVISO) } },
    orderBy: [{ fechaProgramada: "asc" }, { id: "asc" }],
  });
  for (const m of pendientes) {
    if (porEquipo.has(m.equipoId)) continue;
    porEquipo.set(m.equipoId, { situacion: situacionDe(m, hoy) as AvisoEquipo["situacion"], fecha: fechaATexto(m.fechaProgramada!) });
  }
  return porEquipo;
}

function mantenimientoDto(m: MantenimientoConEquipo, hoy: Date) {
  return {
    ...mantenimientoBaseDto(m, hoy),
    equipo: {
      id: m.equipo.id,
      numeroSerie: m.equipo.numeroSerie,
      tipo: m.equipo.tipo,
      marca: m.equipo.marca,
      modelo: m.equipo.modelo,
      ubicacion: m.equipo.ubicacion,
      estado: m.equipo.estado,
    },
  };
}

// -----------------------------------------------------------------------------
// Servicio
// -----------------------------------------------------------------------------

const MENSAJE_NO_PROGRAMADO: Record<Exclude<EstadoMantenimiento, "PROGRAMADO">, { codigo: string; mensaje: string }> = {
  REALIZADO: { codigo: "MANTENIMIENTO_YA_REALIZADO", mensaje: "Este mantenimiento ya está registrado como realizado." },
  CANCELADO: { codigo: "MANTENIMIENTO_CANCELADO", mensaje: "Este mantenimiento está cancelado. Programa uno nuevo si hace falta." },
};

/**
 * @param reloj Devuelve "ahora". Las pruebas lo fijan para revisar el cambio de
 *              día en hora de Quintana Roo.
 */
export function crearServicioMantenimientos(db: ClientePrisma, reloj: () => Date = () => new Date()) {
  const hoy = () => fechaDesdeTexto(hoyEnElHotel(reloj()));

  async function obtenerExistente(id: number) {
    const mantenimiento = await db.mantenimiento.findUnique({ where: { id }, include: conEquipo });
    if (!mantenimiento) throw noEncontrado(`No existe el mantenimiento con id ${id}.`);
    return mantenimiento;
  }

  /** Solo los mantenimientos programados se pueden editar, cerrar o cancelar. */
  function exigirProgramado(m: MantenimientoConEquipo) {
    if (m.estado !== "PROGRAMADO") {
      const { codigo, mensaje } = MENSAJE_NO_PROGRAMADO[m.estado];
      throw new ErrorHttp(409, codigo, mensaje);
    }
  }

  function exigirNoFutura(fecha: Date) {
    if (fecha > hoy()) {
      const mensaje = "La fecha de realización no puede ser futura.";
      throw new ErrorHttp(400, "DATOS_INVALIDOS", "Revisa los datos marcados.", { fechaRealizacion: mensaje });
    }
  }

  function exigirNoPasada(fecha: Date) {
    if (fecha < hoy()) {
      const mensaje = "La fecha programada no puede ser anterior a hoy. Si ya se hizo, regístralo como realizado.";
      throw new ErrorHttp(400, "DATOS_INVALIDOS", "Revisa los datos marcados.", { fechaProgramada: mensaje });
    }
  }

  function exigirEquipoVigente(equipo: { numeroSerie: string; estado: string }) {
    if (equipo.estado === "BAJA") {
      throw new ErrorHttp(
        409,
        "EQUIPO_DADO_DE_BAJA",
        `El equipo ${equipo.numeroSerie} está dado de baja y ya no admite mantenimientos nuevos.`,
      );
    }
  }

  const dto = (m: MantenimientoConEquipo) => mantenimientoDto(m, hoy());

  return {
    /** Historial con filtros, del más reciente al más antiguo. */
    async listar(filtros: FiltrosListado) {
      const serie = filtros.busqueda ? normalizarNumeroSerie(filtros.busqueda) : "";
      const where: Prisma.MantenimientoWhereInput = {
        ...(filtros.equipoId ? { equipoId: filtros.equipoId } : {}),
        ...(filtros.estado ? { estado: filtros.estado } : {}),
        ...(filtros.tipo ? { tipo: filtros.tipo } : {}),
        ...(serie ? { equipo: { numeroSerie: { contains: escaparComodines(serie) } } } : {}),
      };
      const [total, mantenimientos] = await db.$transaction([
        db.mantenimiento.count({ where }),
        db.mantenimiento.findMany({
          where,
          include: conEquipo,
          // Primero lo programado, luego lo realizado y al final lo cancelado
          // (orden del enum en MariaDB); dentro de cada grupo, lo más reciente.
          // Los realizados no siempre tienen fecha programada, por eso se
          // ordena primero por la fecha de realización.
          orderBy: [{ estado: "asc" }, { fechaRealizacion: "desc" }, { fechaProgramada: "desc" }, { id: "desc" }],
          skip: (filtros.pagina - 1) * filtros.porPagina,
          take: filtros.porPagina,
        }),
      ]);
      return { datos: mantenimientos.map(dto), total, pagina: filtros.pagina, porPagina: filtros.porPagina };
    },

    /**
     * Todo lo que se ve en la cuadrícula de un mes ("AAAA-MM"; por defecto, el
     * mes actual en el hotel): semanas completas de lunes a domingo, así que
     * incluye los primeros y últimos días de los meses vecinos.
     */
    async calendario(mes?: string) {
      const textoMes = mes ?? hoyEnElHotel(reloj()).slice(0, 7);
      const primero = fechaDesdeTexto(`${textoMes}-01`);
      const anio = primero.getUTCFullYear();
      const numero = primero.getUTCMonth();
      const desfase = (primero.getUTCDay() + 6) % 7; // lunes = 0
      const diasEnMes = new Date(Date.UTC(anio, numero + 1, 0)).getUTCDate();
      const inicio = new Date(Date.UTC(anio, numero, 1 - desfase));
      const fin = new Date(Date.UTC(anio, numero, 1 - desfase + Math.ceil((desfase + diasEnMes) / 7) * 7));
      const enElMes = { gte: inicio, lt: fin };
      const mantenimientos = await db.mantenimiento.findMany({
        where: {
          OR: [
            { estado: { not: "REALIZADO" }, fechaProgramada: enElMes },
            { estado: "REALIZADO", fechaRealizacion: enElMes },
          ],
        },
        include: conEquipo,
      });
      const datos = mantenimientos
        .map(dto)
        .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
      const ultimo = new Date(fin.getTime() - 86_400_000).toISOString().slice(0, 10);
      return { mes: textoMes, desde: inicio.toISOString().slice(0, 10), hasta: ultimo, hoy: hoyEnElHotel(reloj()), datos };
    },

    /**
     * Avisos del dashboard: programados vencidos y los de los próximos 7 días.
     * No cuenta equipos dados de baja.
     */
    async avisos() {
      const fechaHoy = hoy();
      const pendientes = await db.mantenimiento.findMany({
        where: {
          estado: "PROGRAMADO",
          fechaProgramada: { lte: sumarDias(fechaHoy, DIAS_AVISO) },
          equipo: { estado: { not: "BAJA" } },
        },
        include: conEquipo,
        orderBy: [{ fechaProgramada: "asc" }, { id: "asc" }],
      });
      const datos = pendientes.map(dto);
      const vencidos = datos.filter((m) => m.situacion === "VENCIDO");
      const proximos = datos.filter((m) => m.situacion === "PROXIMO");
      return { hoy: fechaATexto(fechaHoy), diasAviso: DIAS_AVISO, total: datos.length, vencidos, proximos };
    },

    async obtener(id: number) {
      return dto(await obtenerExistente(id));
    },

    async crear(datos: DatosCrear) {
      const equipo = await db.equipo.findUnique({ where: { id: datos.equipoId } });
      if (!equipo) throw noEncontrado(`No existe el equipo con id ${datos.equipoId}.`);
      exigirEquipoVigente(equipo);
      if (datos.estado === "PROGRAMADO") exigirNoPasada(datos.fechaProgramada);
      else exigirNoFutura(datos.fechaRealizacion);

      const creado = await db.mantenimiento.create({
        data: {
          equipoId: datos.equipoId,
          tipo: datos.tipo,
          estado: datos.estado,
          descripcion: datos.descripcion,
          responsable: datos.responsable ?? null,
          ...(datos.estado === "PROGRAMADO"
            ? { fechaProgramada: datos.fechaProgramada }
            : { fechaRealizacion: datos.fechaRealizacion }),
        },
        include: conEquipo,
      });
      return dto(creado);
    },

    /** Cambia la fecha (reprogramar) o corrige los datos de uno programado. */
    async editar(id: number, datos: DatosEditar) {
      const actual = await obtenerExistente(id);
      exigirProgramado(actual);
      if (datos.fechaProgramada) {
        exigirEquipoVigente(actual.equipo);
        exigirNoPasada(datos.fechaProgramada);
      }
      const editado = await db.mantenimiento.update({ where: { id }, data: datos, include: conEquipo });
      return dto(editado);
    },

    async registrarRealizado(id: number, datos: DatosRealizado) {
      const actual = await obtenerExistente(id);
      exigirProgramado(actual);
      const fechaRealizacion = datos.fechaRealizacion ?? hoy();
      exigirNoFutura(fechaRealizacion);
      const realizado = await db.mantenimiento.update({
        where: { id },
        data: {
          estado: "REALIZADO",
          fechaRealizacion,
          ...(datos.responsable !== undefined ? { responsable: datos.responsable } : {}),
          ...(datos.descripcion ? { descripcion: datos.descripcion } : {}),
        },
        include: conEquipo,
      });
      return dto(realizado);
    },

    /** Se conserva en el historial como cancelado; nunca se borra. */
    async cancelar(id: number) {
      const actual = await obtenerExistente(id);
      exigirProgramado(actual);
      const cancelado = await db.mantenimiento.update({ where: { id }, data: { estado: "CANCELADO" }, include: conEquipo });
      return dto(cancelado);
    },
  };
}

export type ServicioMantenimientos = ReturnType<typeof crearServicioMantenimientos>;

// -----------------------------------------------------------------------------
// Rutas HTTP (/api/mantenimientos)
// -----------------------------------------------------------------------------

export function rutasMantenimientos(servicio: ServicioMantenimientos): Router {
  const rutas = Router();

  rutas.get("/", async (req, res) => {
    res.json(await servicio.listar(validar(esquemaListarMantenimientos, req.query)));
  });

  rutas.get("/calendario", async (req, res) => {
    res.json(await servicio.calendario(validar(esquemaCalendario, req.query).mes));
  });

  rutas.get("/avisos", async (_req, res) => {
    res.json(await servicio.avisos());
  });

  rutas.get("/:id", async (req, res) => {
    res.json(await servicio.obtener(validar(esquemaId, req.params.id)));
  });

  rutas.post("/", async (req, res) => {
    res.status(201).json(await servicio.crear(validar(esquemaCrearMantenimiento, conEstadoPorDefecto(req.body))));
  });

  rutas.patch("/:id", async (req, res) => {
    const id = validar(esquemaId, req.params.id);
    res.json(await servicio.editar(id, validar(esquemaEditarMantenimiento, req.body)));
  });

  rutas.post("/:id/realizado", async (req, res) => {
    const id = validar(esquemaId, req.params.id);
    res.json(await servicio.registrarRealizado(id, validar(esquemaRegistrarRealizado, req.body ?? {})));
  });

  rutas.post("/:id/cancelacion", async (req, res) => {
    res.json(await servicio.cancelar(validar(esquemaId, req.params.id)));
  });

  return rutas;
}
