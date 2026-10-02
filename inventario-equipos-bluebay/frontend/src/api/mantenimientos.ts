import { pedir } from "./cliente";
import type { EstadoEquipo, Mantenimiento, TipoEquipo, TipoMantenimiento } from "./equipos";

export interface MantenimientoConEquipo extends Mantenimiento {
  equipo: { id: number; numeroSerie: string; tipo: TipoEquipo; marca: string; modelo: string; ubicacion: string | null; estado: EstadoEquipo };
}

export interface ListadoMantenimientos {
  datos: MantenimientoConEquipo[];
  total: number;
  pagina: number;
  porPagina: number;
}

export interface Calendario {
  mes: string;
  /** Primer y último día de la cuadrícula (semanas completas). */
  desde: string;
  hasta: string;
  hoy: string;
  datos: MantenimientoConEquipo[];
}

export interface AvisosMantenimiento {
  hoy: string;
  diasAviso: number;
  total: number;
  vencidos: MantenimientoConEquipo[];
  proximos: MantenimientoConEquipo[];
}

export interface FiltrosMantenimientos {
  equipoId?: number;
  estado?: Mantenimiento["estado"] | "";
  tipo?: TipoMantenimiento | "";
  busqueda?: string;
  pagina?: number;
  porPagina?: number;
}

/** Programar (lo normal) o registrar uno que ya se hizo. */
export type DatosNuevoMantenimiento =
  | { estado: "PROGRAMADO"; equipoId: number; tipo: TipoMantenimiento | ""; descripcion: string; responsable: string; fechaProgramada: string }
  | { estado: "REALIZADO"; equipoId: number; tipo: TipoMantenimiento | ""; descripcion: string; responsable: string; fechaRealizacion: string };

export interface DatosEditarMantenimiento {
  tipo?: TipoMantenimiento;
  descripcion?: string;
  responsable?: string;
  fechaProgramada?: string;
}

export interface DatosRealizado {
  fechaRealizacion?: string;
  responsable?: string;
  descripcion?: string;
}

export const listarMantenimientos = (filtros: FiltrosMantenimientos, senal?: AbortSignal) =>
  pedir<ListadoMantenimientos>("/mantenimientos", { consulta: { ...filtros }, senal });

export const obtenerCalendario = (mes?: string, senal?: AbortSignal) =>
  pedir<Calendario>("/mantenimientos/calendario", { consulta: { mes }, senal });

export const obtenerAvisos = () => pedir<AvisosMantenimiento>("/mantenimientos/avisos");

export const crearMantenimiento = (datos: DatosNuevoMantenimiento) =>
  pedir<MantenimientoConEquipo>("/mantenimientos", { metodo: "POST", cuerpo: datos });

export const editarMantenimiento = (id: number, datos: DatosEditarMantenimiento) =>
  pedir<MantenimientoConEquipo>(`/mantenimientos/${id}`, { metodo: "PATCH", cuerpo: datos });

export const registrarRealizado = (id: number, datos: DatosRealizado) =>
  pedir<MantenimientoConEquipo>(`/mantenimientos/${id}/realizado`, { metodo: "POST", cuerpo: datos });

export const cancelarMantenimiento = (id: number) =>
  pedir<MantenimientoConEquipo>(`/mantenimientos/${id}/cancelacion`, { metodo: "POST" });
