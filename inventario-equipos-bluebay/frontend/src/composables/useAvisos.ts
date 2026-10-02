import { reactive } from "vue";

export interface Aviso { id: number; texto: string; tipo: "exito" | "error" }

/** Mensajes breves que confirman una acción ("Equipo registrado"). */
export const avisos = reactive<Aviso[]>([]);
let siguienteId = 1;

export function cerrarAviso(id: number) {
  const indice = avisos.findIndex((a) => a.id === id);
  if (indice !== -1) avisos.splice(indice, 1);
}

export function mostrarAviso(texto: string, tipo: Aviso["tipo"] = "exito", duracionMs = 6000) {
  const id = siguienteId++;
  avisos.push({ id, texto, tipo });
  setTimeout(() => cerrarAviso(id), duracionMs);
}
