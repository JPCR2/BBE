<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter, type LocationQueryRaw } from "vue-router";
import { listarBajas, urlReporteBaja, type ListadoBajas } from "../api/bajas";
import { ErrorApi } from "../api/cliente";
import Icono from "../componentes/Icono.vue";
import { fechaCorta, moneda } from "../utilidades/formato";

const POR_PAGINA = 20;
/** Cuántos renglones se muestran por acta antes de resumir con "+N más". */
const VISIBLES = 3;

const ruta = useRoute();
const router = useRouter();
const texto = (valor: unknown) => (typeof valor === "string" ? valor : "");
const filtros = computed(() => ({
  busqueda: texto(ruta.query.busqueda),
  pagina: Math.max(1, Number(ruta.query.pagina) || 1),
}));

const listado = ref<ListadoBajas | null>(null);
const cargando = ref(true);
const error = ref("");
let controlador: AbortController | undefined;

async function cargar() {
  controlador?.abort();
  controlador = new AbortController();
  cargando.value = true;
  error.value = "";
  try {
    listado.value = await listarBajas({ ...filtros.value, porPagina: POR_PAGINA }, controlador.signal);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    error.value = e instanceof ErrorApi ? e.message : "No se pudieron cargar las bajas.";
  }
  cargando.value = false;
}
watch(filtros, cargar, { immediate: true, deep: true });
onBeforeUnmount(() => controlador?.abort());

function actualizar(cambios: LocationQueryRaw) {
  const query: LocationQueryRaw = { ...ruta.query, ...cambios };
  for (const clave of Object.keys(query)) if (query[clave] === "" || query[clave] == null) delete query[clave];
  if (!("pagina" in cambios)) delete query.pagina;
  router.replace({ query });
}

// La búsqueda se aplica tras una pausa corta para no consultar en cada tecla.
const busqueda = ref(filtros.value.busqueda);
let pausa: ReturnType<typeof setTimeout> | undefined;
watch(busqueda, (valor) => {
  clearTimeout(pausa);
  pausa = setTimeout(() => actualizar({ busqueda: valor.trim() }), 300);
});
watch(() => filtros.value.busqueda, (valor) => { if (valor !== busqueda.value.trim()) busqueda.value = valor; });

const rango = computed(() => {
  const l = listado.value;
  if (!l || l.total === 0) return "";
  const desde = (l.pagina - 1) * l.porPagina + 1;
  return `Mostrando ${desde}–${desde + l.datos.length - 1} de ${l.total} ${l.total === 1 ? "baja" : "bajas"}`;
});
const hayMasPaginas = computed(() => !!listado.value && listado.value.pagina * listado.value.porPagina < listado.value.total);
</script>

<template>
  <div class="vista">
    <div class="encabezado-pagina">
      <div>
        <h1 class="titulo-pagina">Bajas</h1>
        <p class="subtitulo">Reportes «Bajas de equipo operacional». Un equipo dado de baja sale del inventario, pero su ficha e historial se conservan.</p>
      </div>
      <RouterLink :to="{ name: 'nueva-baja' }" class="boton boton-primario"><Icono nombre="mas" :tamano="18" :grosor="2" />Registrar baja</RouterLink>
    </div>

    <div class="caja-busqueda">
      <Icono nombre="buscar" :tamano="18" />
      <input v-model="busqueda" type="search" aria-label="Buscar por folio, número de serie o artículo" placeholder="Folio, número de serie o artículo">
    </div>

    <div class="contenedor-tabla">
      <table class="tabla" aria-label="Bajas registradas" :aria-busy="cargando">
        <thead>
          <tr>
            <th scope="col">Folio</th>
            <th scope="col">Fecha</th>
            <th scope="col">Qué se dio de baja</th>
            <th scope="col">Costo</th>
            <th scope="col">Capturó</th>
            <th scope="col"><span class="oculto-visual">Reporte</span></th>
          </tr>
        </thead>
        <tbody v-if="listado && listado.datos.length > 0">
          <tr v-for="baja in listado.datos" :key="baja.id">
            <td class="serie">{{ baja.folio }}</td>
            <td>{{ fechaCorta(baja.fechaBaja) }}</td>
            <td>
              <span class="series">
                <RouterLink
                  v-for="equipo in baja.equipos.slice(0, VISIBLES)" :key="equipo.id"
                  :to="{ name: 'ficha-equipo', params: { id: equipo.id } }" class="serie"
                >{{ equipo.numeroSerie }}</RouterLink>
                <span v-if="baja.equipos.length > VISIBLES" class="tenue">+{{ baja.equipos.length - VISIBLES }} más</span>
              </span>
              <span v-if="baja.articulos.length > 0" class="articulos">
                {{ baja.articulos.slice(0, VISIBLES).map((a) => `${a.descripcion} (${a.cantidad})`).join(" · ") }}<template v-if="baja.articulos.length > VISIBLES"> · +{{ baja.articulos.length - VISIBLES }} más</template>
              </span>
            </td>
            <td class="numero">{{ moneda(baja.costoTotal) }}</td>
            <td>{{ baja.elaboro }}</td>
            <td>
              <a :href="urlReporteBaja(baja.id)" target="_blank" rel="noopener" class="imprimir" :aria-label="`Imprimir reporte ${baja.folio}`">
                <Icono nombre="imprimir" :tamano="16" />Imprimir
              </a>
            </td>
          </tr>
        </tbody>
      </table>

      <p v-if="cargando && !listado" class="estado-vacio">Cargando bajas…</p>
      <div v-else-if="error" class="estado-vacio">
        <strong>{{ error }}</strong>
        <button type="button" class="boton boton-secundario" @click="cargar">Intentar de nuevo</button>
      </div>
      <div v-else-if="listado && listado.datos.length === 0 && filtros.busqueda" class="estado-vacio">
        <strong>Ninguna baja coincide con «{{ filtros.busqueda }}».</strong>
        <button type="button" class="boton boton-secundario" @click="busqueda = ''">Quitar búsqueda</button>
      </div>
      <div v-else-if="listado && listado.datos.length === 0" class="estado-vacio">
        <strong>Todavía no hay bajas registradas.</strong>
        <p>Cuando un equipo ya no sirva, regístralo aquí para imprimir su reporte de baja.</p>
        <RouterLink :to="{ name: 'nueva-baja' }" class="boton boton-secundario">Registrar la primera baja</RouterLink>
      </div>

      <div v-if="listado && listado.total > 0" class="pie-tabla">
        <span>{{ rango }}</span>
        <div class="paginas">
          <button type="button" class="boton boton-secundario" :disabled="listado.pagina <= 1" @click="actualizar({ pagina: listado.pagina - 1 })">Anterior</button>
          <button type="button" class="boton boton-secundario" :disabled="!hayMasPaginas" @click="actualizar({ pagina: listado.pagina + 1 })">Siguiente</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vista { display: flex; flex-direction: column; gap: 20px; }
.caja-busqueda {
  display: flex; align-items: center; gap: 10px; width: min(420px, 100%); min-height: 44px; padding: 0 12px;
  border: 1px solid var(--borde-fuerte); border-radius: var(--radio); background: var(--superficie); color: var(--texto-2);
}
.caja-busqueda:focus-within { outline: 3px solid var(--primario); outline-offset: 2px; }
.caja-busqueda input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font: inherit; color: var(--tinta); }
.series { display: flex; flex-wrap: wrap; gap: 4px 10px; }
.series .serie { font-size: 14px; text-decoration: none; }
.articulos { display: block; font-size: 14px; margin-top: 2px; }
.numero { white-space: nowrap; }
.tenue { color: var(--texto-2); }
.imprimir { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; font-size: 14px; font-weight: 600; text-decoration: none; white-space: nowrap; }
.paginas { display: flex; gap: 8px; }
</style>
