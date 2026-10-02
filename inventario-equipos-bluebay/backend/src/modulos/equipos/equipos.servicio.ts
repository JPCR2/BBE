import type { Prisma } from "../../generated/prisma/client.ts";
import type { ClientePrisma } from "../../lib/clientePrisma.ts";
import { normalizarNumeroSerie } from "../../lib/clientePrisma.ts";
import { escaparComodines, palabrasDe } from "../../lib/busqueda.ts";
import { ErrorHttp, noEncontrado } from "../../lib/errores.ts";
import { fechaATexto, fechaDesdeTexto, hoyEnElHotel, tiempoTranscurrido } from "../../lib/fechas.ts";
import { avisosPorEquipo, mantenimientoBaseDto, ordenarRecientesPrimero } from "../mantenimientos/mantenimientos.modulo.ts";
import { MENSAJE_GARANTIA_ANTES_DE_COMPRA, type DatosCrearEquipo, type DatosEditarEquipo, type FiltrosEquipos } from "./equipos.esquemas.ts";

const conAsignacionVigente = {
  asignaciones: {
    where: { fechaDevolucion: null },
    include: { empleado: { include: { departamento: true } } },
    take: 1,
  },
} satisfies Prisma.EquipoInclude;

type EmpleadoConDepartamento = Prisma.EmpleadoGetPayload<{ include: { departamento: true } }>;
type EquipoConAsignacion = Prisma.EquipoGetPayload<{ include: typeof conAsignacionVigente }>;

function empleadoDto(empleado: EmpleadoConDepartamento) {
  return {
    id: empleado.id,
    numeroEmpleado: empleado.numeroEmpleado,
    nombre: empleado.nombre,
    apellidos: empleado.apellidos,
    puesto: empleado.puesto,
    departamento: empleado.departamento.nombre,
    activo: empleado.activo,
  };
}

/** Forma resumida de un equipo, la que usan el listado y el buscador. */
export function equipoResumenDto(equipo: EquipoConAsignacion) {
  const vigente = equipo.asignaciones[0];
  return {
    id: equipo.id,
    numeroSerie: equipo.numeroSerie,
    tipo: equipo.tipo,
    marca: equipo.marca,
    modelo: equipo.modelo,
    ubicacion: equipo.ubicacion,
    estado: equipo.estado,
    folioFactura: equipo.folioFactura,
    asignacionVigente: vigente
      ? { id: vigente.id, fechaAsignacion: vigente.fechaAsignacion.toISOString(), empleado: empleadoDto(vigente.empleado) }
      : null,
  };
}

/** @param reloj Devuelve "ahora"; las pruebas lo fijan para revisar los avisos por fecha. */
export function crearServicioEquipos(db: ClientePrisma, reloj: () => Date = () => new Date()) {
  const hoy = () => fechaDesdeTexto(hoyEnElHotel(reloj()));

  /** Arma el filtro de búsqueda: cada palabra debe aparecer en la serie, la marca o el modelo. */
  function filtroBase(filtros: Pick<FiltrosEquipos, "busqueda" | "tipo">): Prisma.EquipoWhereInput {
    const palabras = palabrasDe(filtros.busqueda);
    return {
      estado: { not: "BAJA" },
      ...(filtros.tipo ? { tipo: filtros.tipo } : {}),
      AND: palabras.map((palabra) => ({
        OR: [
          { numeroSerie: { contains: escaparComodines(normalizarNumeroSerie(palabra)) } },
          { marca: { contains: escaparComodines(palabra) } },
          { modelo: { contains: escaparComodines(palabra) } },
          { folioFactura: { contains: escaparComodines(palabra) } },
        ],
      })),
    };
  }

  const conVigente: Prisma.EquipoWhereInput = { asignaciones: { some: { fechaDevolucion: null } } };
  const sinVigente: Prisma.EquipoWhereInput = { asignaciones: { none: { fechaDevolucion: null } } };

  async function obtenerExistente(id: number) {
    const equipo = await db.equipo.findUnique({ where: { id } });
    if (!equipo) throw noEncontrado(`No existe el equipo con id ${id}.`);
    return equipo;
  }

  async function verificarSerieLibre(numeroSerie: string, idPropio?: number) {
    const otro = await db.equipo.findUnique({ where: { numeroSerie } });
    if (otro && otro.id !== idPropio) {
      const mensaje = `Ya existe un equipo con el número de serie ${numeroSerie}.`;
      throw new ErrorHttp(409, "NUMERO_SERIE_DUPLICADO", mensaje, { numeroSerie: mensaje });
    }
  }

  return {
    /** Listado paginado con conteos para los filtros rápidos. No incluye equipos dados de baja salvo que se pidan. */
    async listar(filtros: FiltrosEquipos) {
      const base = filtroBase(filtros);
      const where: Prisma.EquipoWhereInput = {
        ...base,
        ...(filtros.estado ? { estado: filtros.estado } : {}),
        ...(filtros.asignacion === "asignados" ? conVigente : {}),
        ...(filtros.asignacion === "libres" ? sinVigente : {}),
      };
      const [total, equipos, todos, asignados, libres, mantenimiento] = await db.$transaction([
        db.equipo.count({ where }),
        db.equipo.findMany({
          where,
          include: conAsignacionVigente,
          orderBy: { numeroSerie: "asc" },
          skip: (filtros.pagina - 1) * filtros.porPagina,
          take: filtros.porPagina,
        }),
        db.equipo.count({ where: base }),
        db.equipo.count({ where: { ...base, ...conVigente } }),
        db.equipo.count({ where: { ...base, ...sinVigente } }),
        db.equipo.count({ where: { ...base, estado: "EN_MANTENIMIENTO" } }),
      ]);
      // Aviso de mantenimiento vencido o próximo, que se muestra bajo el estado.
      const avisos = await avisosPorEquipo(db, equipos.map((e) => e.id), hoy());
      return {
        datos: equipos.map((e) => ({ ...equipoResumenDto(e), avisoMantenimiento: avisos.get(e.id) ?? null })),
        total,
        pagina: filtros.pagina,
        porPagina: filtros.porPagina,
        conteos: { todos, asignados, libres, mantenimiento },
      };
    },

    /** Búsqueda exacta por número de serie (buscador y lector de código de barras). */
    async obtenerPorSerie(numeroSerie: string) {
      const equipo = await db.equipo.findUnique({ where: { numeroSerie }, include: conAsignacionVigente });
      if (!equipo) throw noEncontrado(`No existe un equipo con el número de serie ${normalizarNumeroSerie(numeroSerie)}.`);
      return equipoResumenDto(equipo);
    },

    /** Ficha completa: datos, historial de asignaciones y mantenimientos. */
    async obtenerFicha(id: number) {
      const equipo = await db.equipo.findUnique({
        where: { id },
        include: {
          asignaciones: {
            include: { empleado: { include: { departamento: true } } },
            orderBy: [{ fechaAsignacion: "desc" }, { id: "desc" }],
          },
          mantenimientos: true,
          baja: true,
        },
      });
      if (!equipo) throw noEncontrado(`No existe el equipo con id ${id}.`);
      const fechaHoy = hoy();
      const vigente = equipo.asignaciones.find((a) => a.fechaDevolucion === null);
      return {
        ...equipoResumenDto({ ...equipo, asignaciones: vigente ? [vigente] : [] }),
        especificaciones: equipo.especificaciones,
        fechaAdquisicion: equipo.fechaAdquisicion ? fechaATexto(equipo.fechaAdquisicion) : null,
        costo: equipo.costo ? equipo.costo.toFixed(2) : null,
        folioFactura: equipo.folioFactura,
        fechaVencimientoGarantia: equipo.fechaVencimientoGarantia ? fechaATexto(equipo.fechaVencimientoGarantia) : null,
        /** null si no se registró la garantía. */
        garantiaVigente: equipo.fechaVencimientoGarantia ? equipo.fechaVencimientoGarantia >= fechaHoy : null,
        /** Hasta hoy, o hasta el día de la baja si ya salió del inventario. */
        tiempoFuncionamiento: equipo.fechaAdquisicion
          ? tiempoTranscurrido(equipo.fechaAdquisicion, equipo.baja ? equipo.baja.fechaBaja : fechaHoy)
          : null,
        baja: equipo.baja
          ? { id: equipo.baja.id, folio: equipo.baja.folio, fechaBaja: fechaATexto(equipo.baja.fechaBaja), observaciones: equipo.observacionBaja ?? "" }
          : null,
        creadoEn: equipo.creadoEn.toISOString(),
        asignaciones: equipo.asignaciones.map((a) => ({
          id: a.id,
          fechaAsignacion: a.fechaAsignacion.toISOString(),
          fechaDevolucion: a.fechaDevolucion ? a.fechaDevolucion.toISOString() : null,
          observaciones: a.observaciones,
          empleado: empleadoDto(a.empleado),
        })),
        mantenimientos: ordenarRecientesPrimero(equipo.mantenimientos.map((m) => mantenimientoBaseDto(m, fechaHoy))),
      };
    },

    async crear(datos: DatosCrearEquipo) {
      await verificarSerieLibre(datos.numeroSerie);
      const equipo = await db.equipo.create({ data: datos });
      return this.obtenerFicha(equipo.id);
    },

    async editar(id: number, datos: DatosEditarEquipo) {
      const actual = await obtenerExistente(id);
      if (actual.estado === "BAJA") {
        throw new ErrorHttp(409, "EQUIPO_DADO_DE_BAJA", "Este equipo está dado de baja y ya no se puede modificar.");
      }
      if (datos.numeroSerie) await verificarSerieLibre(datos.numeroSerie, id);
      // La garantía se compara con la fecha de adquisición que quedará guardada.
      const adquisicion = datos.fechaAdquisicion !== undefined ? datos.fechaAdquisicion : actual.fechaAdquisicion;
      const garantia = datos.fechaVencimientoGarantia !== undefined ? datos.fechaVencimientoGarantia : actual.fechaVencimientoGarantia;
      if (adquisicion && garantia && garantia < adquisicion) {
        const campo = datos.fechaVencimientoGarantia !== undefined ? "fechaVencimientoGarantia" : "fechaAdquisicion";
        throw new ErrorHttp(400, "DATOS_INVALIDOS", "Revisa los datos marcados.", { [campo]: MENSAJE_GARANTIA_ANTES_DE_COMPRA });
      }
      await db.equipo.update({ where: { id }, data: datos });
      return this.obtenerFicha(id);
    },

    /** Conteos para la pantalla de Inicio (sin equipos dados de baja). */
    async resumen() {
      const base: Prisma.EquipoWhereInput = { estado: { not: "BAJA" } };
      const [equipos, asignados, sinAsignar, enMantenimiento] = await db.$transaction([
        db.equipo.count({ where: base }),
        db.equipo.count({ where: { ...base, ...conVigente } }),
        db.equipo.count({ where: { ...base, ...sinVigente } }),
        db.equipo.count({ where: { estado: "EN_MANTENIMIENTO" } }),
      ]);
      return { equipos, asignados, sinAsignar, enMantenimiento };
    },
  };
}

export type ServicioEquipos = ReturnType<typeof crearServicioEquipos>;
