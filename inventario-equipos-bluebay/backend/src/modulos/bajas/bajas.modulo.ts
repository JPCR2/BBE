import { Router } from "express";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.ts";
import type { ClientePrisma } from "../../lib/clientePrisma.ts";
import { normalizarNumeroSerie } from "../../lib/clientePrisma.ts";
import { escaparComodines } from "../../lib/busqueda.ts";
import { ErrorHttp, noEncontrado } from "../../lib/errores.ts";
import { fechaATexto, fechaDesdeTexto, hoyEnElHotel, tiempoTranscurrido } from "../../lib/fechas.ts";
import { esquemaId, fechaCalendario, textoObligatorio, vacioAUndefined, validar } from "../../lib/validacion.ts";
import { esquemaCosto } from "../equipos/equipos.esquemas.ts";

/**
 * Bajas con el formato del hotel "Bajas de equipo operacional": cada renglón
 * lleva su propio motivo y condiciones. Un acta puede incluir equipos del
 * inventario y artículos sin número de serie (baterías, tóners…).
 */

/** Máximos por acta. */
export const MAXIMO_EQUIPOS_BAJA = 100;
export const MAXIMO_ARTICULOS_BAJA = 50;

// -----------------------------------------------------------------------------
// Esquemas de entrada
// -----------------------------------------------------------------------------

const MENSAJE_SIN_RENGLONES = "Agrega al menos un equipo o un artículo.";
const observaciones = textoObligatorio("Escribe el motivo de la baja y las condiciones.", 255);

const esquemaEquipoDeBaja = z.strictObject({
  id: z.number({ error: "Los equipos se indican con su id numérico." }).int().positive("Los equipos se indican con su id numérico."),
  observaciones,
});

const esquemaArticulo = z.strictObject({
  descripcion: textoObligatorio("Describe el artículo, por ejemplo «Baterías de UPS».", 150),
  cantidad: z.coerce
    .number({ error: "Escribe la cantidad." })
    .int("La cantidad debe ser un número entero.")
    .min(1, "La cantidad debe ser mayor que cero.")
    .max(100_000, "La cantidad es demasiado grande."),
  costo: esquemaCosto,
  aniosUso: z.preprocess(
    (valor) => (valor === "" || valor === null ? undefined : valor),
    z.coerce
      .number({ error: "Escribe los años de uso como número." })
      .int("Escribe los años de uso sin decimales (0 si es menos de un año).")
      .min(0, "Los años de uso no pueden ser negativos.")
      .max(100, "Revisa los años de uso.")
      .optional(),
  ),
  observaciones,
});

export const esquemaCrearBaja = z
  .strictObject({
    equipos: z
      .array(esquemaEquipoDeBaja, { error: "Los equipos van en una lista." })
      .max(MAXIMO_EQUIPOS_BAJA, `Máximo ${MAXIMO_EQUIPOS_BAJA} equipos por baja.`)
      .default([])
      // Si un equipo viene dos veces, cuenta una (con el primer motivo).
      .transform((lista) => lista.filter((e, i) => lista.findIndex((otro) => otro.id === e.id) === i)),
    articulos: z
      .array(esquemaArticulo, { error: "Los artículos van en una lista." })
      .max(MAXIMO_ARTICULOS_BAJA, `Máximo ${MAXIMO_ARTICULOS_BAJA} artículos por baja.`)
      .default([]),
    fechaBaja: fechaCalendario("Elige la fecha de la baja."),
    elaboro: textoObligatorio("Escribe el nombre de quien captura la baja.", 100),
  })
  .superRefine((datos, contexto) => {
    if (datos.equipos.length + datos.articulos.length === 0) {
      contexto.addIssue({ code: "custom", path: ["equipos"], message: MENSAJE_SIN_RENGLONES });
    }
  });

export const esquemaListarBajas = z.object({
  /** Folio del acta, número de serie de un equipo o descripción de un artículo. */
  busqueda: z.preprocess(vacioAUndefined, z.string().trim().max(100, "Máximo 100 caracteres.").optional()),
  pagina: z.preprocess(vacioAUndefined, z.coerce.number().int().min(1, "La página empieza en 1.").default(1)),
  porPagina: z.preprocess(vacioAUndefined, z.coerce.number().int().min(1).max(100, "Máximo 100 por página.").default(20)),
});

type DatosCrear = z.output<typeof esquemaCrearBaja>;
type FiltrosListado = z.output<typeof esquemaListarBajas>;

// -----------------------------------------------------------------------------
// Formato de salida
// -----------------------------------------------------------------------------

const conRenglones = {
  equipos: { orderBy: { numeroSerie: "asc" } },
  articulos: { orderBy: { id: "asc" } },
} satisfies Prisma.BajaInclude;
type BajaConRenglones = Prisma.BajaGetPayload<{ include: typeof conRenglones }>;

const aCentavos = (costo: Prisma.Decimal | null) => (costo ? Math.round(Number(costo) * 100) : 0);

/** Detalle del acta con todo lo que va en el reporte impreso. */
export function bajaDto(baja: BajaConRenglones) {
  let centavos = 0;
  for (const e of baja.equipos) centavos += aCentavos(e.costo);
  for (const a of baja.articulos) centavos += aCentavos(a.costo);
  return {
    id: baja.id,
    folio: baja.folio,
    fechaBaja: fechaATexto(baja.fechaBaja),
    elaboro: baja.elaboro,
    creadoEn: baja.creadoEn.toISOString(),
    costoTotal: (centavos / 100).toFixed(2),
    equipos: baja.equipos.map((e) => ({
      id: e.id,
      numeroSerie: e.numeroSerie,
      tipo: e.tipo,
      marca: e.marca,
      modelo: e.modelo,
      fechaAdquisicion: e.fechaAdquisicion ? fechaATexto(e.fechaAdquisicion) : null,
      costo: e.costo ? e.costo.toFixed(2) : null,
      /** Desde la adquisición hasta el día de la baja. */
      tiempoFuncionamiento: e.fechaAdquisicion ? tiempoTranscurrido(e.fechaAdquisicion, baja.fechaBaja) : null,
      observaciones: e.observacionBaja ?? "",
    })),
    articulos: baja.articulos.map((a) => ({
      id: a.id,
      descripcion: a.descripcion,
      cantidad: a.cantidad,
      costo: a.costo ? a.costo.toFixed(2) : null,
      aniosUso: a.aniosUso,
      observaciones: a.observaciones,
    })),
  };
}

export type DetalleBaja = ReturnType<typeof bajaDto>;

// -----------------------------------------------------------------------------
// Servicio
// -----------------------------------------------------------------------------

const lista = (series: string[]) => series.join(", ");
const fechaCorta = (fecha: Date) => fechaATexto(fecha).split("-").reverse().join("/");

/** BAJA-2026-0001: consecutivo dentro del año de la fecha de baja. */
export function formatoFolio(anio: number, consecutivo: number) {
  return `BAJA-${anio}-${String(consecutivo).padStart(4, "0")}`;
}

export function crearServicioBajas(db: ClientePrisma, reloj: () => Date = () => new Date()) {
  const hoy = () => fechaDesdeTexto(hoyEnElHotel(reloj()));

  async function obtenerExistente(id: number) {
    const baja = await db.baja.findUnique({ where: { id }, include: conRenglones });
    if (!baja) throw noEncontrado(`No existe la baja con id ${id}.`);
    return baja;
  }

  /** Revisa todas las reglas de los equipos antes de tocar la base, para dar un mensaje claro. */
  async function verificarEquipos(datos: DatosCrear) {
    const ids = datos.equipos.map((e) => e.id);
    if (ids.length === 0) return;
    const equipos = await db.equipo.findMany({
      where: { id: { in: ids } },
      include: {
        baja: true,
        asignaciones: { where: { fechaDevolucion: null }, include: { empleado: true }, take: 1 },
      },
      orderBy: { numeroSerie: "asc" },
    });
    const faltantes = ids.filter((id) => !equipos.some((e) => e.id === id));
    if (faltantes.length > 0) {
      throw noEncontrado(`No ${faltantes.length === 1 ? "existe el equipo" : "existen los equipos"} con id ${faltantes.join(", ")}.`);
    }

    const yaDadas = equipos.filter((e) => e.estado === "BAJA");
    if (yaDadas.length > 0) {
      const detalle = yaDadas.map((e) => (e.baja ? `${e.numeroSerie} (folio ${e.baja.folio})` : e.numeroSerie));
      const mensaje = `${yaDadas.length === 1 ? "Este equipo ya está dado" : "Estos equipos ya están dados"} de baja: ${lista(detalle)}.`;
      throw new ErrorHttp(409, "EQUIPO_YA_DADO_DE_BAJA", mensaje, { equipos: mensaje });
    }

    const asignados = equipos.filter((e) => e.asignaciones.length > 0);
    if (asignados.length > 0) {
      const detalle = asignados.map((e) => `${e.numeroSerie} (${e.asignaciones[0]!.empleado.nombre} ${e.asignaciones[0]!.empleado.apellidos})`);
      const mensaje = `Registra primero la devolución de ${asignados.length === 1 ? "este equipo" : "estos equipos"}: ${lista(detalle)}.`;
      throw new ErrorHttp(409, "EQUIPO_ASIGNADO", mensaje, { equipos: mensaje });
    }

    const comprados = equipos.filter((e) => e.fechaAdquisicion && e.fechaAdquisicion > datos.fechaBaja);
    if (comprados.length > 0) {
      const detalle = comprados.map((e) => `${e.numeroSerie} (${fechaCorta(e.fechaAdquisicion!)})`);
      const mensaje = `La fecha de la baja no puede ser anterior a la adquisición de ${lista(detalle)}.`;
      throw new ErrorHttp(400, "DATOS_INVALIDOS", "Revisa los datos marcados.", { fechaBaja: mensaje });
    }
  }

  /** Siguiente folio del año. Si otra baja lo toma al mismo tiempo, el índice único lo rechaza y se reintenta. */
  async function siguienteFolio(tx: Pick<ClientePrisma, "baja">, anio: number) {
    const prefijo = `BAJA-${anio}-`;
    const ultima = await tx.baja.findFirst({ where: { folio: { startsWith: prefijo } }, orderBy: { folio: "desc" } });
    const consecutivo = ultima ? Number(ultima.folio.slice(prefijo.length)) + 1 : 1;
    return formatoFolio(anio, consecutivo);
  }

  return {
    async listar(filtros: FiltrosListado) {
      const texto = filtros.busqueda ?? "";
      const where: Prisma.BajaWhereInput = texto
        ? {
            OR: [
              { folio: { contains: escaparComodines(texto.toUpperCase()) } },
              { equipos: { some: { numeroSerie: { contains: escaparComodines(normalizarNumeroSerie(texto)) } } } },
              { articulos: { some: { descripcion: { contains: escaparComodines(texto) } } } },
            ],
          }
        : {};
      const [total, bajas] = await db.$transaction([
        db.baja.count({ where }),
        db.baja.findMany({
          where,
          include: conRenglones,
          orderBy: [{ fechaBaja: "desc" }, { id: "desc" }],
          skip: (filtros.pagina - 1) * filtros.porPagina,
          take: filtros.porPagina,
        }),
      ]);
      return { datos: bajas.map(bajaDto), total, pagina: filtros.pagina, porPagina: filtros.porPagina };
    },

    async obtener(id: number) {
      return bajaDto(await obtenerExistente(id));
    },

    /**
     * Registra el acta: los equipos pasan a BAJA con su motivo, sus
     * mantenimientos programados se cancelan y se guardan los artículos.
     * Todo o nada.
     */
    async crear(datos: DatosCrear) {
      if (datos.fechaBaja > hoy()) {
        throw new ErrorHttp(400, "DATOS_INVALIDOS", "Revisa los datos marcados.", { fechaBaja: "La fecha de la baja no puede ser futura." });
      }
      const ids = datos.equipos.map((e) => e.id);

      for (let intento = 1; ; intento++) {
        await verificarEquipos(datos);
        try {
          const { id, mantenimientosCancelados } = await db.$transaction(async (tx) => {
            const baja = await tx.baja.create({
              data: {
                folio: await siguienteFolio(tx, datos.fechaBaja.getUTCFullYear()),
                fechaBaja: datos.fechaBaja,
                elaboro: datos.elaboro,
                articulos: {
                  create: datos.articulos.map((a) => ({
                    descripcion: a.descripcion,
                    cantidad: a.cantidad,
                    costo: a.costo ?? null,
                    aniosUso: a.aniosUso ?? null,
                    observaciones: a.observaciones,
                  })),
                },
              },
            });
            // Se repiten las condiciones: si algo cambió desde la revisión
            // (alguien lo asignó en ese momento), no se da de baja nada.
            for (const equipo of datos.equipos) {
              const { count } = await tx.equipo.updateMany({
                where: { id: equipo.id, estado: { not: "BAJA" }, asignaciones: { none: { fechaDevolucion: null } } },
                data: { estado: "BAJA", bajaId: baja.id, observacionBaja: equipo.observaciones },
              });
              if (count !== 1) {
                throw new ErrorHttp(409, "EQUIPOS_CAMBIARON", "Algún equipo cambió mientras se registraba la baja. Revisa la lista e inténtalo de nuevo.");
              }
            }
            const cancelados = ids.length
              ? await tx.mantenimiento.updateMany({ where: { equipoId: { in: ids }, estado: "PROGRAMADO" }, data: { estado: "CANCELADO" } })
              : { count: 0 };
            return { id: baja.id, mantenimientosCancelados: cancelados.count };
          });
          return { ...(await this.obtener(id)), mantenimientosCancelados };
        } catch (error) {
          // Otra baja registrada en el mismo instante: tomó el mismo folio
          // (índice único) o MySQL detectó un conflicto de escritura. Se
          // vuelve a revisar todo y se reintenta.
          const conflicto =
            error instanceof Prisma.PrismaClientKnownRequestError &&
            ((error.code === "P2002" && error.message.includes("bajas_folio_key")) || error.code === "P2034");
          if (!conflicto || intento >= 5) throw error;
        }
      }
    },
  };
}

export type ServicioBajas = ReturnType<typeof crearServicioBajas>;

// -----------------------------------------------------------------------------
// Rutas HTTP (/api/bajas)
// -----------------------------------------------------------------------------

export function rutasBajas(servicio: ServicioBajas): Router {
  const rutas = Router();

  rutas.get("/", async (req, res) => {
    res.json(await servicio.listar(validar(esquemaListarBajas, req.query)));
  });

  rutas.get("/:id", async (req, res) => {
    res.json(await servicio.obtener(validar(esquemaId, req.params.id)));
  });

  rutas.post("/", async (req, res) => {
    res.status(201).json(await servicio.crear(validar(esquemaCrearBaja, req.body)));
  });

  return rutas;
}
