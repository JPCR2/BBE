<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ErrorApi } from "../api/cliente";
import { listarEquipos, urlReporteAlta, type EquipoResumen } from "../api/equipos";
import { ETIQUETAS_TIPO } from "../utilidades/formato";
import Icono from "./Icono.vue";

/** Máximo que acepta la API por reporte. */
const MAXIMO = 100;

/**
 * Arma el reporte de alta de varios equipos: se buscan (normalmente por el
 * folio de la factura), se marcan y se abre el PDF en otra pestaña.
 */
const emit = defineEmits<{ cerrar: [] }>();

const dialogo = ref<HTMLDialogElement>();
const texto = ref("");
const resultados = ref<EquipoResumen[]>([]);
const buscando = ref(false);
const buscado = ref("");
const error = ref("");
/** Se conservan entre búsquedas, en el orden en que se eligieron. */
const elegidos = ref(new Map<number, EquipoResumen>());

let pausa: ReturnType<typeof setTimeout> | undefined;
let controlador: AbortController | undefined;

async function buscar() {
  const limpio = texto.value.trim();
  controlador?.abort();
  if (limpio === "") {
    resultados.value = [];
    buscado.value = "";
    buscando.value = false;
    return;
  }
  controlador = new AbortController();
  buscando.value = true;
  try {
    resultados.value = (await listarEquipos({ busqueda: limpio, porPagina: 50 }, controlador.signal)).datos;
    error.value = "";
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    error.value = e instanceof ErrorApi ? e.message : "No se pudo buscar.";
  }
  buscado.value = limpio;
  buscando.value = false;
}
watch(texto, () => {
  clearTimeout(pausa);
  pausa = setTimeout(buscar, 250);
});

onMounted(() => dialogo.value?.showModal());
onBeforeUnmount(() => {
  clearTimeout(pausa);
  controlador?.abort();
});

function alternar(equipo: EquipoResumen) {
  const copia = new Map(elegidos.value);
  if (copia.has(equipo.id)) copia.delete(equipo.id);
  else copia.set(equipo.id, equipo);
  elegidos.value = copia;
}

const todosMarcados = computed(() => resultados.value.length > 0 && resultados.value.every((e) => elegidos.value.has(e.id)));
function alternarTodos() {
  const copia = new Map(elegidos.value);
  const marcar = !todosMarcados.value;
  for (const equipo of resultados.value) {
    if (marcar) copia.set(equipo.id, equipo);
    else copia.delete(equipo.id);
  }
  elegidos.value = copia;
}

const cantidad = computed(() => elegidos.value.size);
const excedido = computed(() => cantidad.value > MAXIMO);

function generar() {
  if (cantidad.value === 0 || excedido.value) return;
  window.open(urlReporteAlta([...elegidos.value.keys()]), "_blank", "noopener");
}
</script>

<template>
  <dialog ref="dialogo" class="dialogo" aria-labelledby="titulo-reporte-alta" @close="emit('cerrar')" @cancel="emit('cerrar')">
    <form @submit.prevent="generar">
      <div class="dialogo-encabezado">
        <h2 id="titulo-reporte-alta">Reporte de alta</h2>
        <button type="button" class="dialogo-cerrar" aria-label="Cerrar" @click="emit('cerrar')"><Icono nombre="cerrar" /></button>
      </div>
      <p class="subtitulo">Elige los equipos que salen en el reporte. Lo más común es buscar el folio de la factura para imprimir juntos los equipos que llegaron en ella.</p>

      <div class="campo">
        <label for="buscar-reporte-alta">Buscar equipos</label>
        <input
          id="buscar-reporte-alta" v-model="texto" class="entrada entrada-mono" type="search" autocomplete="off"
          placeholder="Folio de factura, número de serie, marca o modelo"
        >
      </div>

      <p v-if="error" class="aviso-error" role="alert">{{ error }}</p>
      <p v-else-if="texto.trim() === ''" class="campo-ayuda">Escribe para buscar. Puedes hacer varias búsquedas: lo que marques se conserva.</p>
      <p v-else-if="buscando && resultados.length === 0" class="campo-ayuda">Buscando…</p>
      <p v-else-if="buscado !== '' && resultados.length === 0" class="campo-ayuda">Ningún equipo coincide con «{{ buscado }}».</p>

      <div v-if="resultados.length > 0" class="resultados">
        <label class="fila todos">
          <input type="checkbox" :checked="todosMarcados" @change="alternarTodos">
          <span>{{ todosMarcados ? "Quitar" : "Marcar" }} los {{ resultados.length }} de la lista</span>
        </label>
        <label v-for="equipo in resultados" :key="equipo.id" class="fila">
          <input type="checkbox" :checked="elegidos.has(equipo.id)" @change="alternar(equipo)">
          <span class="celda-doble">
            <span><span class="serie">{{ equipo.numeroSerie }}</span> · {{ equipo.marca }} {{ equipo.modelo }}</span>
            <span>{{ ETIQUETAS_TIPO[equipo.tipo] }} · Factura {{ equipo.folioFactura ?? "sin registrar" }}</span>
          </span>
        </label>
      </div>

      <div v-if="cantidad > 0" class="elegidos" aria-live="polite">
        <strong>{{ cantidad }} {{ cantidad === 1 ? "equipo elegido" : "equipos elegidos" }}:</strong>
        <span v-for="equipo in elegidos.values()" :key="equipo.id" class="chip">
          {{ equipo.numeroSerie }}
          <button type="button" class="quitar" :aria-label="`Quitar ${equipo.numeroSerie} del reporte`" @click="alternar(equipo)">
            <Icono nombre="cerrar" :tamano="14" :grosor="2" />
          </button>
        </span>
      </div>
      <p v-if="excedido" class="aviso-error">Máximo {{ MAXIMO }} equipos por reporte. Quita algunos o haz otro reporte.</p>

      <div class="dialogo-acciones">
        <button type="button" class="boton boton-secundario" @click="emit('cerrar')">Cerrar</button>
        <button type="submit" class="boton boton-primario" :disabled="cantidad === 0 || excedido">
          <Icono nombre="imprimir" :tamano="18" />
          {{ cantidad === 0 ? "Elige al menos un equipo" : `Generar reporte (${cantidad})` }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.resultados {
  display: flex; flex-direction: column; max-height: 280px; overflow-y: auto;
  border: 1px solid var(--borde); border-radius: var(--radio);
}
.fila {
  display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 6px 14px;
  border-bottom: 1px solid var(--linea); cursor: pointer;
}
.fila:last-child { border-bottom: 0; }
.fila:hover { background: var(--superficie-suave); }
.fila input { width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--primario); }
.todos { background: var(--superficie-suave); font-weight: 600; font-size: 14px; }
.elegidos { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; font-size: 14px; }
.chip {
  display: inline-flex; align-items: center; gap: 2px; padding-left: 10px; border-radius: 16px;
  background: var(--primario-suave); color: var(--primario); font-family: var(--fuente-mono); font-size: 13px;
}
.quitar {
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  border: 0; border-radius: 16px; background: transparent; color: inherit; cursor: pointer;
}
.quitar:hover { background: rgba(11, 79, 108, 0.12); }
</style>
