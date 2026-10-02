import { pedir } from "./cliente";

export type TipoEquipo = "ESCRITORIO" | "LAPTOP" | "ALL_IN_ONE" | "MONITOR" | "IMPRESORA" | "OTRO";
export type EstadoEquipo = "ACTIVO" | "EN_MANTENIMIENTO" | "BAJA";
export type FiltroAsignacion = "todos" | "asignados" | "libres";

export interface EmpleadoResumen {
  id: number;
  numeroEmpleado: string;
  nombre: string;
  apellidos: string;
  puesto: string;
  departamento: string;
  activo: boolean;
}

/** Aviso de mantenimiento más urgente del equipo (vencido o en los próximos 7 días). */
export interface AvisoMantenimientoEquipo {
  situacion: "VENCIDO" | "PROXIMO";
  fecha: string;
}

export interface EquipoResumen {
  id: number;
  numeroSerie: string;
  tipo: TipoEquipo;
  marca: string;
  modelo: string;
  ubicacion: string | null;
  estado: EstadoEquipo;
  folioFactura: string | null;
  asignacionVigente: { id: number; fechaAsignacion: string; empleado: EmpleadoResumen } | null;
  /** Solo viene en el listado del inventario. */
  avisoMantenimiento?: AvisoMantenimientoEquipo | null;
}

export interface Asignacion {
  id: number;
  fechaAsignacion: string;
  fechaDevolucion: string | null;
  observaciones: string | null;
  empleado: EmpleadoResumen;
}

export type TipoMantenimiento = "PREVENTIVO" | "CORRECTIVO";
/** "Vencido" y "próximo" los calcula la API contra la fecha de hoy en el hotel. */
export type SituacionMantenimiento = "VENCIDO" | "PROXIMO" | "PROGRAMADO" | "REALIZADO" | "CANCELADO";

export interface Mantenimiento {
  id: number;
  tipo: TipoMantenimiento;
  estado: "PROGRAMADO" | "REALIZADO" | "CANCELADO";
  situacion: SituacionMantenimiento;
  fechaProgramada: string | null;
  fechaRealizacion: string | null;
  /** Fecha con la que aparece en el calendario (realización o programada). */
  fecha: string;
  /** Días que faltan (negativo = días de retraso); solo si sigue programado. */
  diasRestantes: number | null;
  descripcion: string;
  responsable: string | null;
}

export interface FichaEquipo extends EquipoResumen {
  especificaciones: string | null;
  fechaAdquisicion: string | null;
  costo: string | null;
  folioFactura: string | null;
  fechaVencimientoGarantia: string | null;
  /** null si no se registró la garantía. */
  garantiaVigente: boolean | null;
  tiempoFuncionamiento: { anios: number; meses: number } | null;
  creadoEn: string;
  asignaciones: Asignacion[];
  mantenimientos: Mantenimiento[];
  /** Acta con la que se dio de baja (solo si el estado es BAJA). */
  baja: { id: number; folio: string; fechaBaja: string; observaciones: string } | null;
}

export interface ListadoEquipos {
  datos: EquipoResumen[];
  total: number;
  pagina: number;
  porPagina: number;
  conteos: { todos: number; asignados: number; libres: number; mantenimiento: number };
}

export interface FiltrosEquipos {
  busqueda?: string;
  tipo?: TipoEquipo | "";
  estado?: EstadoEquipo | "";
  asignacion?: FiltroAsignacion;
  pagina?: number;
  porPagina?: number;
}

/** Datos que se envían al registrar o editar un equipo. */
export interface DatosEquipo {
  numeroSerie: string;
  tipo: TipoEquipo | "";
  marca: string;
  modelo: string;
  ubicacion: string;
  fechaAdquisicion: string;
  costo: string;
  folioFactura: string;
  fechaVencimientoGarantia: string;
  especificaciones: string;
  estado?: "ACTIVO" | "EN_MANTENIMIENTO";
}

export interface Resumen {
  equipos: number;
  asignados: number;
  sinAsignar: number;
  enMantenimiento: number;
}

export const listarEquipos = (filtros: FiltrosEquipos, senal?: AbortSignal) =>
  pedir<ListadoEquipos>("/equipos", { consulta: { ...filtros }, senal });

export const buscarPorSerie = (numeroSerie: string) =>
  pedir<EquipoResumen>(`/equipos/serie/${encodeURIComponent(numeroSerie)}`);

export const obtenerEquipo = (id: number) => pedir<FichaEquipo>(`/equipos/${id}`);

export const registrarEquipo = (datos: DatosEquipo) =>
  pedir<FichaEquipo>("/equipos", { metodo: "POST", cuerpo: datos });

export const editarEquipo = (id: number, datos: Partial<DatosEquipo>) =>
  pedir<FichaEquipo>(`/equipos/${id}`, { metodo: "PATCH", cuerpo: datos });

export const obtenerResumen = () => pedir<Resumen>("/resumen");

/** Dirección del PDF imprimible de alta de uno o varios equipos. */
export const urlReporteAlta = (ids: number[]) => `/api/reportes/alta?ids=${ids.join(",")}`;
