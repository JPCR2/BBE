<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter, type LocationQueryRaw } from "vue-router";
import { ErrorApi } from "../api/cliente";
import { listarEquipos, type AvisoMantenimientoEquipo, type EstadoEquipo, type FiltroAsignacion, type ListadoEquipos, type TipoEquipo } from "../api/equipos";
import DialogoReporteAlta from "../componentes/DialogoReporteAlta.vue";
import Icono from "../componentes/Icono.vue";
import InsigniaEstado from "../componentes/InsigniaEstado.vue";
import { ETIQUETAS_TIPO, fechaCorta, hoyEnElHotel, nombreCompleto } from "../utilidades/formato";

const POR_PAGINA = 20;
const armandoReporte = ref(false);
const hoy = hoyEnElHotel();
const manana = hoyEnElHotel(new Date(Date.now() + 86_400_000));

/** Texto corto bajo el estado: "Mantenimiento vencido", "… hoy", "… mañana", "… el 25/09/2026". */
function textoAviso(aviso: AvisoMantenimientoEquipo): string {
  if (aviso.situacion === "VENCIDO") return "Mantenimiento vencido";
  if (aviso.fecha === hoy) return "Mantenimiento hoy";
  if (aviso.fecha === manana) return "Mantenimiento mañana";
  return `Mantenimiento el ${fechaCorta(aviso.fecha)}`;
}
const ruta = useRoute();
const router = useRouter();

const texto = (valor: unknown) => (typeof valor === "string" ? valor : "");
const filtros = computed(() => ({
  busqueda: texto(ruta.query.busqueda),
  tipo: texto(ruta.query.tipo) as TipoEquipo | "",
  estado: texto(ruta.query.estado) as EstadoEquipo | "",
  asignacion: (texto(ruta.query.asignacion) || "todos") as FiltroAsignacion,
  pagina: Math.max(1, Number(ruta.query.pagina) || 1),
}));

type Rapido = "todos" | "asignados" | "libres" | "mantenimiento";
const rapidoActual = computed<Rapido>(() => {
  if (filtros.value.estado === "EN_MANTENIMIENTO") return "mantenimiento";
  if (filtros.value.asignacion === "asignados" || filtros.value.asignacion === "libres") return filtros.value.asignacion;
  return "todos";
});

const listado = ref<ListadoEquipos | null>(null);
const cargando = ref(true);
const error = ref("");
let controlador: AbortController | undefined;

async function cargar() {
  controlador?.abort();
  controlador = new AbortController();
  cargando.value = true;
  error.value = "";
  try {
    listado.value = await listarEquipos({ ...filtros.value, porPagina: POR_PAGINA }, controlador.signal);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    error.value = e instanceof ErrorApi ? e.message : "No se pudo cargar el inventario.";
  }
  cargando.value = false;
}
watch(filtros, cargar, { immediate: true, deep: true });
onBeforeUnmount(() => controlador?.abort());

/** Cambia los filtros en la dirección (así el botón Atrás y los enlaces funcionan). */
function actualizar(cambios: LocationQueryRaw) {
  const query: LocationQueryRaw = { ...ruta.query, ...cambios };
  for (const clave of Object.keys(query)) if (query[clave] === "" || query[clave] == null) delete query[clave];
  if (!("pagina" in cambios)) delete query.pagina;
  router.replace({ query });
}

function elegirRapido(rapido: Rapido) {
  actualizar({
    asignacion: rapido === "asignados" || rapido === "libres" ? rapido : null,
    estado: rapido === "mantenimiento" ? "EN_MANTENIMIENTO" : null,
  });
}

// La búsqueda se aplica tras una pausa corta para no consultar en cada tecla.
const busqueda = ref(filtros.value.busqueda);
let pausa: ReturnType<typeof setTimeout> | undefined;
watch(busqueda, (valor) => {
  clearTimeout(pausa);
  pausa = setTimeout(() => actualizar({ busqueda: valor.trim() }), 300);
});
watch(() => filtros.value.busqueda, (valor) => { if (valor !== busqueda.value.trim()) busqueda.value = valor; });

function quitarFiltros() {
  busqueda.value = "";
  router.replace({ query: {} });
}

const botonesRapidos = computed(() => {
  const c = listado.value?.conteos;
  return [
    { clave: "todos" as const, etiqueta: "Todos", conteo: c?.todos },
    { clave: "asignados" as const, etiqueta: "Asignados", conteo: c?.asignados },
    { clave: "libres" as const, etiqueta: "Sin asignar", conteo: c?.libres },
    { clave: "mantenimiento" as const, etiqueta: "En mantenimiento", conteo: c?.mantenimiento },
  ];
});

const rango = computed(() => {
  const l = listado.value;
  if (!l || l.total === 0) return "";
  const desde = (l.pagina - 1) * l.porPagina + 1;
  return `Mostrando ${desde}–${desde + l.datos.length - 1} de ${l.total} ${l.total === 1 ? "equipo" : "equipos"}`;
});
const hayMasPaginas = computed(() => !!listado.value && listado.value.pagina * listado.value.porPagina < listado.value.total);
</script>

<template>
  <div class="vista">
    <div class="encabezado-pagina">
      <div>
        <h1 class="titulo-pagina">Inventario</h1>
        <p class="subtitulo">Todos los equipos de cómputo del hotel, con su estado y a quién están asignados.</p>
      </div>
      <div class="acciones-encabezado">
        <button type="button" class="boton boton-secundario" @click="armandoReporte = true">
          <Icono nombre="imprimir" :tamano="18" />Reporte de alta
        </button>
        <RouterLink to="/inventario/nuevo" class="boton boton-primario"><Icono nombre="mas" :tamano="18" :grosor="2" />Registrar equipo</RouterLink>
      </div>
    </div>

    <div class="filtros">
      <div class="rapidos" role="group" aria-label="Filtros rápidos">
        <button
          v-for="boton in botonesRapidos" :key="boton.clave" type="button" class="rapido"
          :class="{ activo: rapidoActual === boton.clave }" :aria-pressed="rapidoActual === boton.clave"
          @click="elegirRapido(boton.clave)"
        >
          {{ boton.etiqueta }}<span v-if="boton.conteo !== undefined" class="conteo">{{ boton.conteo }}</span>
        </button>
      </div>
      <div class="derecha">
        <div class="caja-busqueda">
          <Icono nombre="buscar" :tamano="18" />
          <input v-model="busqueda" type="search" aria-label="Filtrar por número de serie, marca, modelo o folio de factura" placeholder="Serie, marca, modelo o factura">
        </div>
        <select
          class="entrada" aria-label="Tipo de equipo" :value="filtros.tipo"
          @change="actualizar({ tipo: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">Todos los tipos</option>
          <option v-for="(etiqueta, valor) in ETIQUETAS_TIPO" :key="valor" :value="valor">{{ etiqueta }}</option>
        </select>
      </div>
    </div>

    <div class="contenedor-tabla">
      <table class="tabla" aria-label="Equipos registrados" :aria-busy="cargando">
        <thead>
          <tr>
            <th scope="col">Número de serie</th>
            <th scope="col">Equipo</th>
            <th scope="col">Ubicación</th>
            <th scope="col">Estado</th>
            <th scope="col">Asignado a</th>
            <th scope="col"><span class="oculto-visual">Acciones</span></th>
          </tr>
        </thead>
        <tbody v-if="listado && listado.datos.length > 0">
          <tr v-for="equipo in listado.datos" :key="equipo.id">
            <td><RouterLink :to="{ name: 'ficha-equipo', params: { id: equipo.id } }" class="serie">{{ equipo.numeroSerie }}</RouterLink></td>
            <td><span class="celda-doble"><strong>{{ equipo.marca }} {{ equipo.modelo }}</strong><span>{{ ETIQUETAS_TIPO[equipo.tipo] }}</span></span></td>
            <td class="tenue">{{ equipo.ubicacion ?? "—" }}</td>
            <td>
              <span class="celda-estado">
                <InsigniaEstado :estado="equipo.estado" />
                <RouterLink
                  v-if="equipo.avisoMantenimiento" :to="{ name: 'ficha-equipo', params: { id: equipo.id } }"
                  class="aviso-mantenimiento" :class="equipo.avisoMantenimiento.situacion === 'VENCIDO' ? 'vencido' : 'proximo'"
                >{{ textoAviso(equipo.avisoMantenimiento) }}</RouterLink>
              </span>
            </td>
            <td>
              <span v-if="equipo.asignacionVigente" class="celda-doble">
                <span>{{ nombreCompleto(equipo.asignacionVigente.empleado) }}</span>
                <span>{{ equipo.asignacionVigente.empleado.departamento }}</span>
              </span>
              <span v-else class="insignia insignia-neutra">Sin asignar</span>
            </td>
            <td>
              <RouterLink :to="{ name: 'ficha-equipo', params: { id: equipo.id } }" class="ver-ficha" :aria-label="`Ver ficha de ${equipo.numeroSerie}`">
                Ver ficha<Icono nombre="derecha" :tamano="16" :grosor="2" />
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>

      <p v-if="cargando && !listado" class="estado-vacio">Cargando equipos…</p>
      <div v-else-if="error" class="estado-vacio">
        <strong>{{ error }}</strong>
        <button type="button" class="boton boton-secundario" @click="cargar">Intentar de nuevo</button>
      </div>
      <div v-else-if="listado && listado.datos.length === 0" class="estado-vacio">
        <strong>No hay equipos con esos filtros.</strong>
        <p>Revisa lo que escribiste o quita los filtros para ver todo el inventario.</p>
        <button type="button" class="boton boton-secundario" @click="quitarFiltros">Quitar filtros</button>
      </div>

      <div v-if="listado && listado.total > 0" class="pie-tabla">
        <span>{{ rango }}</span>
        <div class="paginas">
          <button type="button" class="boton boton-secundario" :disabled="listado.pagina <= 1" @click="actualizar({ pagina: listado.pagina - 1 })">Anterior</button>
          <button type="button" class="boton boton-secundario" :disabled="!hayMasPaginas" @click="actualizar({ pagina: listado.pagina + 1 })">Siguiente</button>
        </div>
      </div>
    </div>

    <DialogoReporteAlta v-if="armandoReporte" @cerrar="armandoReporte = false" />
  </div>
</template>

<style scoped>
.vista { display: flex; flex-direction: column; gap: 20px; }
.acciones-encabezado { display: flex; flex-wrap: wrap; gap: 10px; }
.filtros { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
.rapidos { display: flex; flex-wrap: wrap; gap: 8px; }
.rapido {
  display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 16px;
  border: 1px solid var(--borde-fuerte); border-radius: 22px; background: var(--superficie);
  font: inherit; font-weight: 600; color: var(--tinta); cursor: pointer;
}
.rapido.activo { background: var(--primario); border-color: var(--primario); color: #FFFFFF; }
.conteo {
  display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 22px; padding: 0 7px;
  border-radius: 11px; background: var(--neutro-fondo); color: var(--texto-2); font-size: 13px; font-weight: 700;
}
.rapido.activo .conteo { background: #FFFFFF; color: var(--primario); }
.derecha { display: flex; gap: 12px; }
.derecha select { width: auto; }
.caja-busqueda {
  display: flex; align-items: center; gap: 10px; width: 320px; min-height: 44px; padding: 0 12px;
  border: 1px solid var(--borde-fuerte); border-radius: var(--radio); background: var(--superficie); color: var(--texto-2);
}
.caja-busqueda:focus-within { outline: 3px solid var(--primario); outline-offset: 2px; }
.caja-busqueda input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font: inherit; color: var(--tinta); }
.tabla .serie { font-size: 14px; text-decoration: none; }
.tenue { color: var(--texto-2); }
.celda-estado { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.aviso-mantenimiento { font-size: 13px; font-weight: 600; text-decoration: none; white-space: nowrap; }
.aviso-mantenimiento.vencido { color: var(--peligro); }
.aviso-mantenimiento.proximo { color: var(--alerta); }
.ver-ficha { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; font-size: 14px; font-weight: 600; text-decoration: none; white-space: nowrap; }
.paginas { display: flex; gap: 8px; }
@media (max-width: 700px) {
  .derecha { flex-wrap: wrap; width: 100%; }
  .caja-busqueda { width: 100%; }
}
</style>
