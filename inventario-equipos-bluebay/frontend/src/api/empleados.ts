import { pedir } from "./cliente";
import type { EstadoEquipo, TipoEquipo } from "./equipos";

export interface Departamento { id: number; nombre: string; empleadosActivos: number }

export interface Empleado {
  id: number;
  numeroEmpleado: string;
  nombre: string;
  apellidos: string;
  puesto: string;
  activo: boolean;
  departamento: { id: number; nombre: string };
  equiposAsignados: number;
}

export interface LineaAsignacion {
  id: number;
  fechaAsignacion: string;
  fechaDevolucion: string | null;
  observaciones: string | null;
  observacionesDevolucion: string | null;
  equipo: { id: number; numeroSerie: string; tipo: TipoEquipo; marca: string; modelo: string; estado: EstadoEquipo };
}

export interface FichaEmpleado extends Empleado {
  creadoEn: string;
  equiposVigentes: LineaAsignacion[];
  historial: LineaAsignacion[];
}

export interface ListadoEmpleados {
  datos: Empleado[];
  total: number;
  pagina: number;
  porPagina: number;
  conteos: { activos: number; inactivos: number };
}

export interface FiltrosEmpleados {
  busqueda?: string;
  departamentoId?: number | "";
  estado?: "activos" | "inactivos" | "todos";
  pagina?: number;
  porPagina?: number;
}

/** Datos del formulario de empleado. */
export interface DatosEmpleado {
  numeroEmpleado: string;
  nombre: string;
  apellidos: string;
  puesto: string;
  departamentoId: number | "";
}

export const listarEmpleados = (filtros: FiltrosEmpleados, senal?: AbortSignal) =>
  pedir<ListadoEmpleados>("/empleados", { consulta: { ...filtros }, senal });

export const obtenerEmpleado = (id: number) => pedir<FichaEmpleado>(`/empleados/${id}`);

export const registrarEmpleado = (datos: DatosEmpleado) =>
  pedir<FichaEmpleado>("/empleados", { metodo: "POST", cuerpo: datos });

export const editarEmpleado = (id: number, datos: Partial<DatosEmpleado> & { activo?: boolean }) =>
  pedir<FichaEmpleado>(`/empleados/${id}`, { metodo: "PATCH", cuerpo: datos });

export const listarDepartamentos = () => pedir<{ datos: Departamento[] }>("/departamentos");

export const registrarDepartamento = (nombre: string) =>
  pedir<Departamento>("/departamentos", { metodo: "POST", cuerpo: { nombre } });

export const renombrarDepartamento = (id: number, nombre: string) =>
  pedir<Departamento>(`/departamentos/${id}`, { metodo: "PATCH", cuerpo: { nombre } });
