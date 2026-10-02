import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ErrorApi } from "../api/cliente";
import { buscarPorSerie, listarEquipos, type EquipoResumen } from "../api/equipos";
import { normalizarNumeroSerie } from "../utilidades/formato";

/**
 * Búsqueda de equipos mientras se escribe (con una pausa corta para no
 * consultar en cada tecla). La usan el buscador del encabezado y el de Inicio.
 */
export function useBusquedaEquipos(limite = 5, pausaMs = 250) {
  const texto = ref("");
  const resultados = ref<EquipoResumen[]>([]);
  const cargando = ref(false);
  const error = ref("");
  const consultado = ref("");
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  let controlador: AbortController | undefined;

  watch(texto, (valor) => {
    clearTimeout(temporizador);
    const limpio = valor.trim();
    if (limpio === "") {
      controlador?.abort();
      resultados.value = [];
      consultado.value = "";
      cargando.value = false;
      return;
    }
    cargando.value = true;
    temporizador = setTimeout(async () => {
      controlador?.abort();
      controlador = new AbortController();
      try {
        const respuesta = await listarEquipos({ busqueda: limpio, porPagina: limite }, controlador.signal);
        resultados.value = respuesta.datos;
        error.value = "";
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        resultados.value = [];
        error.value = e instanceof ErrorApi ? e.message : "No se pudo realizar la búsqueda.";
      }
      consultado.value = limpio;
      cargando.value = false;
    }, pausaMs);
  });

  onBeforeUnmount(() => {
    clearTimeout(temporizador);
    controlador?.abort();
  });

  const exacto = computed(
    () => resultados.value.find((e) => e.numeroSerie === normalizarNumeroSerie(texto.value)) ?? null,
  );
  const sinResultados = computed(
    () => !cargando.value && consultado.value !== "" && resultados.value.length === 0 && error.value === "",
  );

  /**
   * Para Enter (o un lector de código de barras, que escribe y presiona Enter
   * muy rápido): devuelve la coincidencia exacta aunque la búsqueda aún no termine.
   */
  async function resolverExacto(): Promise<EquipoResumen | null> {
    const limpio = texto.value.trim();
    if (limpio === "") return null;
    if (exacto.value) return exacto.value;
    try {
      return await buscarPorSerie(limpio);
    } catch {
      return null;
    }
  }

  return { texto, resultados, cargando, error, exacto, sinResultados, resolverExacto };
}
