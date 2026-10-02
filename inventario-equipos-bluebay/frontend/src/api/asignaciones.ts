import { pedir } from "./cliente";
import type { EquipoResumen } from "./equipos";

export interface RespuestaAsignacion {
  asignacion: { id: number; fechaAsignacion: string; fechaDevolucion?: string; observaciones?: string | null; observacionesDevolucion?: string | null };
  equipo: EquipoResumen;
}

export const asignarEquipo = (datos: { equipoId: number; empleadoId: number; observaciones?: string }) =>
  pedir<RespuestaAsignacion>("/asignaciones", { metodo: "POST", cuerpo: datos });

export const registrarDevolucion = (asignacionId: number, observaciones?: string) =>
  pedir<RespuestaAsignacion>(`/asignaciones/${asignacionId}/devolucion`, { metodo: "POST", cuerpo: { observaciones } });
