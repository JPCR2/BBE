<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { EquipoResumen } from "../api/equipos";
import { useAvisosMantenimiento } from "../composables/useAvisosMantenimiento";
import { useBusquedaEquipos } from "../composables/useBusquedaEquipos";
import { ETIQUETAS_ESTADO, VARIANTE_ESTADO, fechaDeHoyLarga } from "../utilidades/formato";
import Icono from "./Icono.vue";
import MenuUsuario from "./MenuUsuario.vue";

const router = useRouter();
const { texto, resultados, cargando, error, sinResultados, resolverExacto } = useBusquedaEquipos(5);
const enfocado = ref(false);
const activo = ref(-1);
const fechaHoy = fechaDeHoyLarga();

// Campana: mantenimientos vencidos y de los próximos 7 días.
const { avisos, recargar } = useAvisosMantenimiento();
onMounted(recargar);
const pendientes = computed(() => avisos.value?.total ?? 0);
const etiquetaCampana = computed(() => {
  const a = avisos.value;
  if (!a || a.total === 0) return "Mantenimiento: sin avisos pendientes";
  return `Mantenimiento: ${a.vencidos.length} vencidos y ${a.proximos.length} próximos`;
});

const abierto = computed(() => enfocado.value && texto.value.trim() !== "");
watch(resultados, () => (activo.value = -1));

function mover(paso: number) {
  if (resultados.value.length === 0) return;
  const total = resultados.value.length;
  activo.value = (activo.value + paso + total) % total;
}

function abrir(equipo: EquipoResumen) {
  texto.value = "";
  enfocado.value = false;
  router.push({ name: "ficha-equipo", params: { id: equipo.id } });
}

/** Enter: abre el resultado marcado con las flechas, o la coincidencia exacta, o el listado filtrado. */
async function alPresionarEnter() {
  const marcado = resultados.value[activo.value];
  if (marcado) return abrir(marcado);
  const exacto = await resolverExacto();
  if (exacto) return abrir(exacto);
  const busqueda = texto.value.trim();
  if (busqueda === "") return;
  texto.value = "";
  enfocado.value = false;
  router.push({ name: "inventario", query: { busqueda } });
}
</script>

<template>
  <header class="encabezado">
    <div class="buscador" @keydown.esc="enfocado = false">
      <div class="caja">
        <Icono nombre="buscar" :tamano="18" />
        <input
          v-model="texto"
          type="search"
          role="combobox"
          aria-label="Buscar equipo por número de serie, marca o modelo"
          aria-autocomplete="list"
          aria-controls="resultados-encabezado"
          :aria-expanded="abierto"
          :aria-activedescendant="activo >= 0 ? `resultado-encabezado-${activo}` : undefined"
          placeholder="Buscar equipo por número de serie"
          autocomplete="off"
          @focus="enfocado = true"
          @blur="enfocado = false"
          @keydown.down.prevent="mover(1)"
          @keydown.up.prevent="mover(-1)"
          @keydown.enter.prevent="alPresionarEnter"
        >
      </div>
      <div v-show="abierto" id="resultados-encabezado" class="desplegable" role="listbox" aria-label="Equipos encontrados">
        <button
          v-for="(equipo, indice) in resultados"
          :id="`resultado-encabezado-${indice}`"
          :key="equipo.id"
          type="button"
          role="option"
          class="opcion"
          :class="{ marcada: indice === activo }"
          :aria-selected="indice === activo"
          tabindex="-1"
          @mousedown.prevent
          @click="abrir(equipo)"
        >
          <span class="serie">{{ equipo.numeroSerie }}</span>
          <span class="equipo">{{ equipo.marca }} {{ equipo.modelo }}</span>
          <span class="insignia" :class="`insignia-${VARIANTE_ESTADO[equipo.estado]}`">{{ ETIQUETAS_ESTADO[equipo.estado] }}</span>
        </button>
        <p v-if="cargando && resultados.length === 0" class="mensaje">Buscando…</p>
        <p v-else-if="error" class="mensaje error">{{ error }}</p>
        <div v-else-if="sinResultados" class="mensaje">
          <strong>No hay equipos que coincidan con «{{ texto.trim() }}».</strong>
          <RouterLink to="/inventario/nuevo" @mousedown.prevent @click="texto = ''">Registrar un equipo nuevo</RouterLink>
        </div>
      </div>
    </div>
    <p class="fecha">{{ fechaHoy }}</p>
    <RouterLink to="/mantenimiento" class="campana" :class="{ urgente: (avisos?.vencidos.length ?? 0) > 0 }" :aria-label="etiquetaCampana" :title="etiquetaCampana">
      <Icono nombre="campana" :tamano="22" />
      <span v-if="pendientes > 0" class="contador" aria-hidden="true">{{ pendientes > 99 ? "99+" : pendientes }}</span>
    </RouterLink>
    <MenuUsuario />
  </header>
</template>

<style scoped>
.encabezado {
  position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; gap: 16px;
  height: 72px; padding: 0 40px;
  background: var(--superficie); border-bottom: 1px solid var(--borde);
}
.buscador { position: relative; width: min(460px, 100%); }
.caja {
  display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 14px;
  border: 1px solid var(--borde-fuerte); border-radius: var(--radio); background: var(--superficie-suave); color: var(--texto-2);
}
.caja:focus-within { border-color: var(--primario); box-shadow: 0 0 0 2px var(--primario-suave); }
.caja input {
  flex: 1; min-width: 0; border: 0; background: transparent; outline: none;
  font-family: var(--fuente-mono); font-size: 14px; color: var(--tinta);
}
.desplegable {
  position: absolute; top: 50px; left: 0; right: 0;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--superficie); border: 1px solid var(--borde); border-radius: 10px; box-shadow: var(--sombra-flotante);
}
.opcion {
  display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 8px 14px;
  border: 0; border-bottom: 1px solid var(--linea); background: var(--superficie);
  font: inherit; text-align: left; color: var(--tinta); cursor: pointer;
}
.opcion:hover, .opcion.marcada { background: var(--primario-tenue); }
.opcion .serie { font-size: 14px; }
.opcion .equipo { flex: 1; min-width: 0; font-size: 14px; color: var(--texto-2); }
.mensaje { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 14px; font-size: 14px; color: var(--texto-2); }
.mensaje strong { color: var(--tinta); }
.mensaje.error { color: var(--peligro); font-weight: 600; }
.fecha { margin: 0 0 0 auto; font-size: 14px; color: var(--texto-2); white-space: nowrap; }
.campana {
  position: relative; flex-shrink: 0; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
  border-radius: var(--radio); color: var(--texto-2);
}
.campana:hover { background: var(--superficie-suave); color: var(--tinta); }
.contador {
  position: absolute; top: 2px; right: 0; min-width: 20px; height: 20px; padding: 0 5px;
  display: flex; align-items: center; justify-content: center; border-radius: 10px;
  background: var(--alerta); color: #FFFFFF; font-size: 12px; font-weight: 700;
}
.urgente .contador { background: var(--peligro); }

@media (max-width: 900px) {
  .encabezado { padding: 0 16px; }
  .fecha { display: none; }
  .campana { margin-left: auto; }
}
</style>
