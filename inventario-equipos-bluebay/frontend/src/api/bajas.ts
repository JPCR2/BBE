import { pedir } from "./cliente";
import type { TipoEquipo } from "./equipos";

export interface EquipoDeBaja {
  id: number;
  numeroSerie: string;
  tipo: TipoEquipo;
  marca: string;
  modelo: string;
  fechaAdquisicion: string | null;
  costo: string | null;
  /** Desde la adquisición hasta el día de la baja. */
  tiempoFuncionamiento: { anios: number; meses: number } | null;
  /** Motivo de la baja y condiciones del equipo. */
  observaciones: string;
  /** Tiempo de uso escrito al darlo de baja ("5 a 6 años"). */
  tiempoUso: string | null;
}

/** Renglón para algo sin número de serie (baterías, tóners…). */
export interface ArticuloDeBaja {
  id: number;
  descripcion: string;
  cantidad: number;
  /** Costo total del renglón. */
  costo: string | null;
  aniosUso: number | null;
  /** Tiempo de uso como texto ("6 a 8 años"). */
  tiempoUso: string | null;
  observaciones: string;
}

/** Acta de baja con el formato del hotel "Bajas de equipo operacional". */
export interface Baja {
  id: number;
  folio: string;
  fechaBaja: string;
  /** Quién la capturó en el sistema. */
  elaboro: string;
  creadoEn: string;
  costoTotal: string;
  equipos: EquipoDeBaja[];
  articulos: ArticuloDeBaja[];
}

export interface ListadoBajas {
  datos: Baja[];
  total: number;
  pagina: number;
  porPagina: number;
}

/** Artículo tal como se captura en el formulario (los números van como texto). */
export interface ArticuloNuevo {
  descripcion: string;
  cantidad: string;
  costo: string;
  aniosUso: string;
  /** "6 a 8 años", "Menos de 1 año"… */
  tiempoUso: string;
  observaciones: string;
}

export interface DatosNuevaBaja {
  equipos: { id: number; observaciones: string; tiempoUso: string }[];
  articulos: ArticuloNuevo[];
  fechaBaja: string;
  elaboro: string;
}

export const listarBajas = (filtros: { busqueda?: string; pagina?: number; porPagina?: number }, senal?: AbortSignal) =>
  pedir<ListadoBajas>("/bajas", { consulta: { ...filtros }, senal });

export const obtenerBaja = (id: number) => pedir<Baja>(`/bajas/${id}`);

export const registrarBaja = (datos: DatosNuevaBaja) =>
  pedir<Baja & { mantenimientosCancelados: number }>("/bajas", { metodo: "POST", cuerpo: datos });

/** Equipo del inventario listo para darse de baja (resultado de revisar una lista de series). */
export interface EquipoParaBaja {
  id: number;
  numeroSerie: string;
  tipo: TipoEquipo;
  marca: string;
  modelo: string;
  ubicacion: string | null;
}

export interface RevisionDeSeries {
  revisadas: number;
  disponibles: EquipoParaBaja[];
  noEncontrados: string[];
  yaDeBaja: { numeroSerie: string; folio: string | null }[];
  asignados: { numeroSerie: string; empleado: string }[];
  repetidos: string[];
}

/** Compara una lista de números de serie contra el inventario (no modifica nada). */
export const verificarSeries = (series: string[]) =>
  pedir<RevisionDeSeries>("/bajas/verificar-series", { metodo: "POST", cuerpo: { series } });

/** Dirección del PDF imprimible del acta. */
export const urlReporteBaja = (id: number) => `/api/reportes/baja/${id}`;
