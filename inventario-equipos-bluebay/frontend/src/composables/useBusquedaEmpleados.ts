import { onBeforeUnmount, ref, watch } from "vue";
import { ErrorApi } from "../api/cliente";
import { listarEmpleados, type Empleado } from "../api/empleados";

/** Busca empleados activos mientras se escribe (para el diálogo de asignación). */
export function useBusquedaEmpleados(limite = 6, pausaMs = 250) {
  const texto = ref("");
  const resultados = ref<Empleado[]>([]);
  const cargando = ref(false);
  const error = ref("");
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  let controlador: AbortController | undefined;

  async function consultar() {
    controlador?.abort();
    controlador = new AbortController();
    cargando.value = true;
    try {
      const respuesta = await listarEmpleados(
        { busqueda: texto.value.trim(), estado: "activos", porPagina: limite },
        controlador.signal,
      );
      resultados.value = respuesta.datos;
      error.value = "";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      resultados.value = [];
      error.value = e instanceof ErrorApi ? e.message : "No se pudo buscar empleados.";
    }
    cargando.value = false;
  }

  watch(texto, () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(consultar, pausaMs);
  });

  onBeforeUnmount(() => {
    clearTimeout(temporizador);
    controlador?.abort();
  });

  return { texto, resultados, cargando, error, consultar };
}
