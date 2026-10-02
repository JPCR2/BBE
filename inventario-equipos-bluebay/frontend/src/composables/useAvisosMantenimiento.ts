import { ref } from "vue";
import { ErrorApi } from "../api/cliente";
import { obtenerAvisos, type AvisosMantenimiento } from "../api/mantenimientos";

/**
 * Avisos de mantenimiento (vencidos y próximos 7 días) compartidos por la
 * campana del encabezado y la tarjeta de Inicio. Cualquier pantalla que
 * programe, cierre o cancele un mantenimiento llama a recargarAvisos() para
 * que el contador nunca quede desactualizado.
 */
const avisos = ref<AvisosMantenimiento | null>(null);
const error = ref("");
const cargando = ref(false);

export async function recargarAvisos(): Promise<void> {
  cargando.value = true;
  try {
    avisos.value = await obtenerAvisos();
    error.value = "";
  } catch (e) {
    error.value = e instanceof ErrorApi ? e.message : "No se pudieron cargar los avisos de mantenimiento.";
  }
  cargando.value = false;
}

export function useAvisosMantenimiento() {
  return { avisos, error, cargando, recargar: recargarAvisos };
}
