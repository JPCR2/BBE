<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter, type LocationQueryRaw } from "vue-router";
import { ErrorApi } from "../api/cliente";
import type { TipoMantenimiento } from "../api/equipos";
import {
  listarMantenimientos, obtenerCalendario,
  type Calendario, type FiltrosMantenimientos, type ListadoMantenimientos, type MantenimientoConEquipo,
} from "../api/mantenimientos";
import AccionesMantenimiento from "../componentes/AccionesMantenimiento.vue";
import DialogoProgramarMantenimiento from "../componentes/DialogoProgramarMantenimiento.vue";
import Icono from "../componentes/Icono.vue";
import { mostrarAviso } from "../composables/useAvisos";
import { recargarAvisos, useAvisosMantenimiento } from "../composables/useAvisosMantenimiento";
import { fechaCorta, hoyEnElHotel } from "../utilidades/formato";
import {
  DIAS_SEMANA, ETIQUETAS_SITUACION, ETIQUETAS_TIPO_MANTENIMIENTO, VARIANTE_SITUACION,
  mesDesplazado, mesValido, nombreDia, nombreMes, semanasDelMes, textoPlazo,
} from "../utilidades/mantenimiento";

const POR_PAGINA = 20;
const ruta = useRoute();
const router = useRouter();
const { avisos } = useAvisosMantenimiento();
const hoy = hoyEnElHotel();

const texto = (valor: unknown) => (typeof valor === "string" ? valor : "");
const vista = computed(() => (ruta.query.vista === "historial" ? "historial" : "calendario"));
const mes = computed(() => (mesValido(ruta.query.mes) ? ruta.query.mes : hoy.slice(0, 7)));

/** Cambia la dirección (así Atrás, recargar y compartir el enlace funcionan). */
function actualizar(cambios: LocationQueryRaw) {
  const query: LocationQueryRaw = { ...ruta.query, ...cambios };
  for (const clave of Object.keys(query)) if (query[clave] === "" || query[clave] == null) delete query[clave];
  router.replace({ query });
}

onMounted(recargarAvisos);

// ================================================================ Calendario
const calendario = ref<Calendario | null>(null);
const cargandoCalendario = ref(false);
const errorCalendario = ref("");
let controladorCalendario: AbortController | undefined;

async function cargarCalendario() {
  controladorCalendario?.abort();
  controladorCalendario = new AbortController();
  cargandoCalendario.value = true;
  errorCalendario.value = "";
  try {
    calendario.value = await obtenerCalendario(mes.value, controladorCalendario.signal);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    errorCalendario.value = e instanceof ErrorApi ? e.message : "No se pudo cargar el calendario.";
  }
  cargandoCalendario.value = false;
}

const semanas = computed(() => semanasDelMes(mes.value, hoy));
const porDia = computed(() => {
  const mapa = new Map<string, MantenimientoConEquipo[]>();
  for (const m of calendario.value?.datos ?? []) {
    if (!mapa.has(m.fecha)) mapa.set(m.fecha, []);
    mapa.get(m.fecha)!.push(m);
  }
  return mapa;
});

/** Día elegido: el de la dirección, o hoy si es este mes, o el primero con mantenimientos. */
const diaElegido = computed(() => {
  const pedido = texto(ruta.query.dia);
  if (pedido.startsWith(mes.value)) return pedido;
  if (hoy.startsWith(mes.value)) return hoy;
  const conDatos = calendario.value?.mes === mes.value ? calendario.value.datos.find((m) => m.fecha.startsWith(mes.value))?.fecha : undefined;
  return conDatos ?? `${mes.value}-01`;
});
const delDia = computed(() => porDia.value.get(diaElegido.value) ?? []);

function irAMes(nuevo: string) {
  actualizar({ mes: nuevo === hoy.slice(0, 7) ? null : nuevo, dia: null });
}
function irAHoy() {
  actualizar({ mes: null, dia: null });
}
function elegirDia(fecha: string) {
  const mesDelDia = fecha.slice(0, 7);
  actualizar({ mes: mesDelDia === hoy.slice(0, 7) ? null : mesDelDia, dia: fecha });
}

function etiquetaDia(fecha: string) {
  const cantidad = porDia.value.get(fecha)?.length ?? 0;
  const detalle = cantidad === 0 ? "sin mantenimientos" : `${cantidad} ${cantidad === 1 ? "mantenimiento" : "mantenimientos"}`;
  return `${nombreDia(fecha)}${fecha === hoy ? " (hoy)" : ""}, ${detalle}`;
}

// ================================================================ Historial
const filtros = computed<FiltrosMantenimientos>(() => ({
  estado: texto(ruta.query.estado) as FiltrosMantenimientos["estado"],
  tipo: texto(ruta.query.tipo) as TipoMantenimiento | "",
  busqueda: texto(ruta.query.busqueda),
  pagina: Math.max(1, Number(ruta.query.pagina) || 1),
  porPagina: POR_PAGINA,
}));
const historial = ref<ListadoMantenimientos | null>(null);
const cargandoHistorial = ref(false);
const errorHistorial = ref("");
let controladorHistorial: AbortController | undefined;

async function cargarHistorial() {
  controladorHistorial?.abort();
  controladorHistorial = new AbortController();
  cargandoHistorial.value = true;
  errorHistorial.value = "";
  try {
    historial.value = await listarMantenimientos(filtros.value, controladorHistorial.signal);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    errorHistorial.value = e instanceof ErrorApi ? e.message : "No se pudo cargar el historial.";
  }
  cargandoHistorial.value = false;
}

const busqueda = ref(filtros.value.busqueda ?? "");
let pausa: ReturnType<typeof setTimeout> | undefined;
watch(busqueda, (valor) => {
  clearTimeout(pausa);
  pausa = setTimeout(() => actualizar({ busqueda: valor.trim(), pagina: null }), 300);
});

const rango = computed(() => {
  const l = historial.value;
  if (!l || l.total === 0) return "";
  const desde = (l.pagina - 1) * l.porPagina + 1;
  return `Mostrando ${desde}–${desde + l.datos.length - 1} de ${l.total}`;
});
const hayMasPaginas = computed(() => !!historial.value && historial.value.pagina * historial.value.porPagina < historial.value.total);

// ================================================================ Carga según la pestaña
watch(
  () => (vista.value === "calendario" ? `c:${mes.value}` : `h:${JSON.stringify(filtros.value)}`),
  () => (vista.value === "calendario" ? cargarCalendario() : cargarHistorial()),
  { immediate: true },
);
onBeforeUnmount(() => {
  controladorCalendario?.abort();
  controladorHistorial?.abort();
  clearTimeout(pausa);
});

async function alActualizar(mensaje: string) {
  programando.value = false;
  mostrarAviso(mensaje);
  await Promise.all([vista.value === "calendario" ? cargarCalendario() : cargarHistorial(), recargarAvisos()]);
}

// ================================================================ Programar
const programando = ref(false);
const fechaSugerida = ref<string | undefined>();
function programar(fecha?: string) {
  fechaSugerida.value = fecha;
  programando.value = true;
}
</script>

<template>
  <div class="vista">
    <div class="encabezado-pagina">
      <div>
        <h1 class="titulo-pagina">Mantenimiento</h1>
        <p class="subtitulo">Calendario de mantenimientos preventivos y correctivos, con su historial.</p>
      </div>
      <button type="button" class="boton boton-primario" @click="programar()">
        <Icono nombre="mas" :tamano="18" :grosor="2" />Programar mantenimiento
      </button>
    </div>

    <p v-if="avisos" class="resumen-avisos" aria-live="polite">
      <span class="insignia" :class="avisos.vencidos.length > 0 ? 'insignia-peligro' : 'insignia-neutra'">
        {{ avisos.vencidos.length }} {{ avisos.vencidos.length === 1 ? "vencido" : "vencidos" }}
      </span>
      <span class="insignia" :class="avisos.proximos.length > 0 ? 'insignia-alerta' : 'insignia-neutra'">
        {{ avisos.proximos.length }} en los próximos {{ avisos.diasAviso }} días
      </span>
    </p>

    <div class="pestanas" role="tablist" aria-label="Vista de mantenimiento">
      <button
        id="pestana-calendario" type="button" role="tab" class="pestana" :class="{ activa: vista === 'calendario' }"
        :aria-selected="vista === 'calendario'" aria-controls="panel-mantenimiento" @click="actualizar({ vista: null })"
      >
        <Icono nombre="calendario" :tamano="18" />Calendario
      </button>
      <button
        id="pestana-historial" type="button" role="tab" class="pestana" :class="{ activa: vista === 'historial' }"
        :aria-selected="vista === 'historial'" aria-controls="panel-mantenimiento" @click="actualizar({ vista: 'historial' })"
      >
        <Icono nombre="lista" :tamano="18" />Historial
      </button>
    </div>

    <!-- ============================================================ Calendario -->
    <section
      v-if="vista === 'calendario'" id="panel-mantenimiento" role="tabpanel" aria-labelledby="pestana-calendario"
      class="calendario-y-dia"
    >
      <div class="tarjeta calendario">
        <div class="barra-mes">
          <button type="button" class="boton boton-secundario cuadrado" aria-label="Mes anterior" @click="irAMes(mesDesplazado(mes, -1))">
            <Icono nombre="izquierda" :tamano="18" :grosor="2" />
          </button>
          <h2 class="nombre-mes" aria-live="polite">{{ nombreMes(mes) }}</h2>
          <button type="button" class="boton boton-secundario cuadrado" aria-label="Mes siguiente" @click="irAMes(mesDesplazado(mes, 1))">
            <Icono nombre="derecha" :tamano="18" :grosor="2" />
          </button>
          <button type="button" class="boton boton-secundario" :disabled="mes === hoy.slice(0, 7) && diaElegido === hoy" @click="irAHoy">Hoy</button>
        </div>

        <p v-if="errorCalendario" class="aviso-error">{{ errorCalendario }}
          <button type="button" class="boton-enlace" @click="cargarCalendario">Intentar de nuevo</button>
        </p>

        <table class="cuadricula" :aria-busy="cargandoCalendario" aria-label="Calendario del mes">
          <thead><tr><th v-for="dia in DIAS_SEMANA" :key="dia" scope="col">{{ dia }}</th></tr></thead>
          <tbody>
            <tr v-for="(semana, i) in semanas" :key="i">
              <td v-for="dia in semana" :key="dia.fecha" :class="{ fuera: !dia.delMes }">
                <button
                  type="button" class="dia" :class="{ hoy: dia.esHoy, elegido: dia.fecha === diaElegido }"
                  :aria-label="etiquetaDia(dia.fecha)" :aria-pressed="dia.fecha === diaElegido" @click="elegirDia(dia.fecha)"
                >
                  <span class="numero">{{ dia.dia }}</span>
                  <span v-for="m in (porDia.get(dia.fecha) ?? []).slice(0, 3)" :key="m.id" class="marca-dia" :class="`marca-${VARIANTE_SITUACION[m.situacion]}`">
                    {{ m.equipo.numeroSerie }}
                  </span>
                  <span v-if="(porDia.get(dia.fecha)?.length ?? 0) > 3" class="mas">+{{ porDia.get(dia.fecha)!.length - 3 }} más</span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <ul class="leyenda" aria-label="Significado de los colores">
          <li v-for="(etiqueta, situacion) in ETIQUETAS_SITUACION" :key="situacion">
            <span class="punto" :class="`marca-${VARIANTE_SITUACION[situacion]}`" aria-hidden="true" />{{ etiqueta }}
          </li>
        </ul>
      </div>

      <aside class="tarjeta dia-elegido" aria-labelledby="titulo-dia">
        <h2 id="titulo-dia">{{ nombreDia(diaElegido).replace(/^./, (l) => l.toUpperCase()) }}<span v-if="diaElegido === hoy" class="insignia insignia-primaria">Hoy</span></h2>
        <ul v-if="delDia.length > 0" class="lista-mantenimientos">
          <li v-for="m in delDia" :key="m.id">
            <div class="fila-superior">
              <RouterLink :to="{ name: 'ficha-equipo', params: { id: m.equipo.id } }" class="serie">{{ m.equipo.numeroSerie }}</RouterLink>
              <span class="insignia" :class="`insignia-${VARIANTE_SITUACION[m.situacion]}`">{{ ETIQUETAS_SITUACION[m.situacion] }}</span>
            </div>
            <strong>{{ m.descripcion }}</strong>
            <span class="detalle">
              {{ ETIQUETAS_TIPO_MANTENIMIENTO[m.tipo] }} · {{ m.equipo.marca }} {{ m.equipo.modelo }}<template v-if="m.responsable"> · {{ m.responsable }}</template>
            </span>
            <span class="detalle">{{ textoPlazo(m) }}</span>
            <AccionesMantenimiento :mantenimiento="m" :equipo="m.equipo" @actualizado="alActualizar" />
          </li>
        </ul>
        <div v-else class="sin-datos">
          <p class="subtitulo">No hay mantenimientos este día.</p>
          <button v-if="diaElegido >= hoy" type="button" class="boton boton-secundario" @click="programar(diaElegido)">
            <Icono nombre="mas" :tamano="18" :grosor="2" />Programar para este día
          </button>
        </div>
      </aside>
    </section>

    <!-- ============================================================ Historial -->
    <section v-else id="panel-mantenimiento" role="tabpanel" aria-labelledby="pestana-historial" class="historial">
      <div class="filtros">
        <div class="caja-busqueda">
          <Icono nombre="buscar" :tamano="18" />
          <input v-model="busqueda" type="search" aria-label="Filtrar por número de serie" placeholder="Número de serie">
        </div>
        <select class="entrada" aria-label="Estado" :value="filtros.estado" @change="actualizar({ estado: ($event.target as HTMLSelectElement).value, pagina: null })">
          <option value="">Todos los estados</option>
          <option value="PROGRAMADO">Programados</option>
          <option value="REALIZADO">Realizados</option>
          <option value="CANCELADO">Cancelados</option>
        </select>
        <select class="entrada" aria-label="Tipo" :value="filtros.tipo" @change="actualizar({ tipo: ($event.target as HTMLSelectElement).value, pagina: null })">
          <option value="">Preventivos y correctivos</option>
          <option v-for="(etiqueta, valor) in ETIQUETAS_TIPO_MANTENIMIENTO" :key="valor" :value="valor">{{ etiqueta }}</option>
        </select>
      </div>

      <div class="contenedor-tabla">
        <table class="tabla" aria-label="Historial de mantenimientos" :aria-busy="cargandoHistorial">
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Equipo</th>
              <th scope="col">Mantenimiento</th>
              <th scope="col">Situación</th>
              <th scope="col"><span class="oculto-visual">Acciones</span></th>
            </tr>
          </thead>
          <tbody v-if="historial && historial.datos.length > 0">
            <tr v-for="m in historial.datos" :key="m.id">
              <td class="nowrap">{{ fechaCorta(m.fecha) }}</td>
              <td>
                <span class="celda-doble">
                  <RouterLink :to="{ name: 'ficha-equipo', params: { id: m.equipo.id } }" class="serie">{{ m.equipo.numeroSerie }}</RouterLink>
                  <span>{{ m.equipo.marca }} {{ m.equipo.modelo }}</span>
                </span>
              </td>
              <td>
                <span class="celda-doble">
                  <span>{{ m.descripcion }}</span>
                  <span>{{ ETIQUETAS_TIPO_MANTENIMIENTO[m.tipo] }}<template v-if="m.responsable"> · {{ m.responsable }}</template></span>
                </span>
              </td>
              <td>
                <span class="celda-doble">
                  <span class="insignia" :class="`insignia-${VARIANTE_SITUACION[m.situacion]}`">{{ ETIQUETAS_SITUACION[m.situacion] }}</span>
                  <span v-if="m.estado === 'PROGRAMADO'">{{ textoPlazo(m) }}</span>
                </span>
              </td>
              <td><AccionesMantenimiento :mantenimiento="m" :equipo="m.equipo" @actualizado="alActualizar" /></td>
            </tr>
          </tbody>
        </table>

        <p v-if="cargandoHistorial && !historial" class="estado-vacio">Cargando historial…</p>
        <div v-else-if="errorHistorial" class="estado-vacio">
          <strong>{{ errorHistorial }}</strong>
          <button type="button" class="boton boton-secundario" @click="cargarHistorial">Intentar de nuevo</button>
        </div>
        <div v-else-if="historial && historial.datos.length === 0" class="estado-vacio">
          <strong>No hay mantenimientos con esos filtros.</strong>
          <button v-if="Object.keys(ruta.query).some((k) => k !== 'vista')" type="button" class="boton boton-secundario" @click="busqueda = ''; actualizar({ estado: null, tipo: null, busqueda: null, pagina: null })">
            Quitar filtros
          </button>
        </div>

        <div v-if="historial && historial.total > 0" class="pie-tabla">
          <span>{{ rango }}</span>
          <div class="paginas">
            <button type="button" class="boton boton-secundario" :disabled="historial.pagina <= 1" @click="actualizar({ pagina: historial.pagina - 1 })">Anterior</button>
            <button type="button" class="boton boton-secundario" :disabled="!hayMasPaginas" @click="actualizar({ pagina: historial.pagina + 1 })">Siguiente</button>
          </div>
        </div>
      </div>
    </section>

    <DialogoProgramarMantenimiento v-if="programando" :fecha-inicial="fechaSugerida" @guardado="alActualizar" @cerrar="programando = false" />
  </div>
</template>

<style scoped>
.vista { display: flex; flex-direction: column; gap: 20px; }
.resumen-avisos { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; }

.pestanas { display: flex; gap: 4px; border-bottom: 1px solid var(--borde); }
.pestana {
  display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 16px; margin-bottom: -1px;
  border: 0; border-bottom: 3px solid transparent; background: transparent;
  font: inherit; font-weight: 600; color: var(--texto-2); cursor: pointer;
}
.pestana.activa { color: var(--primario); border-bottom-color: var(--primario); }

.calendario-y-dia { display: flex; gap: 20px; align-items: flex-start; }
.calendario { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 14px; }
.barra-mes { display: flex; align-items: center; gap: 8px; }
.nombre-mes { flex: 1; margin: 0; font-family: var(--fuente-titulo); font-weight: 600; font-size: 22px; }
.cuadrado { width: 44px; padding: 0; }

.cuadricula { width: 100%; border-collapse: collapse; table-layout: fixed; }
.cuadricula th { padding: 6px 0; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--texto-2); }
.cuadricula td { padding: 2px; vertical-align: top; }
.dia {
  width: 100%; min-height: 92px; padding: 6px; display: flex; flex-direction: column; align-items: stretch; gap: 3px;
  border: 1px solid var(--linea); border-radius: var(--radio); background: var(--superficie);
  font: inherit; text-align: left; color: var(--tinta); cursor: pointer;
}
.dia:hover { border-color: var(--borde-fuerte); background: var(--superficie-suave); }
.fuera .dia { background: var(--superficie-suave); color: var(--texto-3); }
.dia.hoy .numero { background: var(--primario); color: #FFFFFF; }
.dia.elegido { border: 2px solid var(--primario); padding: 5px; background: var(--primario-tenue); }
.numero { align-self: flex-start; min-width: 26px; height: 26px; padding: 0 6px; display: inline-flex; align-items: center; justify-content: center; border-radius: 13px; font-size: 14px; font-weight: 600; }
.marca-dia {
  display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 1px 6px; border-radius: 4px; font-family: var(--fuente-mono); font-size: 11px; font-weight: 500;
}
.marca-peligro { background: var(--peligro-fondo); color: var(--peligro); }
.marca-alerta { background: var(--alerta-fondo); color: var(--alerta); }
.marca-primaria { background: var(--primario-suave); color: var(--primario); }
.marca-exito { background: var(--exito-fondo); color: var(--exito); }
.marca-neutra { background: var(--neutro-fondo); color: var(--texto-2); text-decoration: line-through; }
.mas { font-size: 12px; font-weight: 600; color: var(--texto-2); }

.leyenda { list-style: none; display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0; padding: 0; font-size: 13px; color: var(--texto-2); }
.leyenda li { display: inline-flex; align-items: center; gap: 6px; }
.punto { width: 12px; height: 12px; border-radius: 3px; }

.dia-elegido { width: 360px; flex-shrink: 0; position: sticky; top: 92px; }
.dia-elegido h2 { display: flex; align-items: center; gap: 10px; }
.lista-mantenimientos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.lista-mantenimientos li {
  display: flex; flex-direction: column; gap: 4px; padding: 12px 14px;
  background: var(--superficie-suave); border: 1px solid var(--borde); border-radius: 10px;
}
.fila-superior { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fila-superior .serie { text-decoration: none; }
.detalle { font-size: 14px; color: var(--texto-2); }
.sin-datos { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }

.historial { display: flex; flex-direction: column; gap: 16px; }
.filtros { display: flex; flex-wrap: wrap; gap: 12px; }
.filtros select { width: auto; }
.caja-busqueda {
  display: flex; align-items: center; gap: 10px; width: 280px; min-height: 44px; padding: 0 12px;
  border: 1px solid var(--borde-fuerte); border-radius: var(--radio); background: var(--superficie); color: var(--texto-2);
}
.caja-busqueda:focus-within { outline: 3px solid var(--primario); outline-offset: 2px; }
.caja-busqueda input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font-family: var(--fuente-mono); font-size: 14px; color: var(--tinta); }
.tabla .serie { font-size: 14px; text-decoration: none; }
.nowrap { white-space: nowrap; }
.paginas { display: flex; gap: 8px; }

@media (max-width: 1200px) {
  .calendario-y-dia { flex-direction: column; }
  .dia-elegido { width: 100%; position: static; }
}
@media (max-width: 700px) {
  .dia { min-height: 56px; }
  .marca-dia { font-size: 0; height: 6px; padding: 0; }
  .caja-busqueda { width: 100%; }
}
</style>
