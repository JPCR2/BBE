<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ErrorApi } from "../api/cliente";
import { obtenerResumen, type EquipoResumen, type Resumen } from "../api/equipos";
import AccionesMantenimiento from "../componentes/AccionesMantenimiento.vue";
import Icono from "../componentes/Icono.vue";
import { mostrarAviso } from "../composables/useAvisos";
import { useAvisosMantenimiento } from "../composables/useAvisosMantenimiento";
import { useBusquedaEquipos } from "../composables/useBusquedaEquipos";
import { nombreCompleto, normalizarNumeroSerie } from "../utilidades/formato";
import { ETIQUETAS_TIPO_MANTENIMIENTO, textoPlazo } from "../utilidades/mantenimiento";

const router = useRouter();
const { texto, resultados, cargando, error, sinResultados, resolverExacto } = useBusquedaEquipos(4);
const resumen = ref<Resumen | null>(null);
const errorResumen = ref("");
const { avisos, error: errorAvisos, recargar: recargarAvisos } = useAvisosMantenimiento();

async function cargarResumen() {
  try {
    resumen.value = await obtenerResumen();
    errorResumen.value = "";
  } catch (e) {
    errorResumen.value = e instanceof ErrorApi ? e.message : "No se pudo cargar el resumen.";
  }
}
onMounted(() => Promise.all([cargarResumen(), recargarAvisos()]));

const gruposAvisos = computed(() => {
  const a = avisos.value;
  if (!a) return [];
  return [
    { clave: "vencidos", titulo: "Vencidos", lista: a.vencidos, variante: "peligro" },
    { clave: "proximos", titulo: `Próximos ${a.diasAviso} días`, lista: a.proximos, variante: "alerta" },
  ].filter((grupo) => grupo.lista.length > 0);
});

/** Tras registrar o cancelar desde un aviso (los avisos se recargan solos). */
async function alActualizarMantenimiento(mensaje: string) {
  mostrarAviso(mensaje);
  await cargarResumen();
}

const esExacto = (equipo: EquipoResumen) => equipo.numeroSerie === normalizarNumeroSerie(texto.value);

async function alPresionarEnter() {
  const exacto = await resolverExacto();
  if (exacto) return router.push({ name: "ficha-equipo", params: { id: exacto.id } });
  if (texto.value.trim() !== "") router.push({ name: "inventario", query: { busqueda: texto.value.trim() } });
}
</script>

<template>
  <div class="inicio">
    <div class="principal">
      <div class="encabezado-pagina">
        <div>
          <h1 class="titulo-pagina">Inicio</h1>
          <p class="subtitulo">¿Qué necesitas hacer hoy?</p>
        </div>
      </div>

      <section class="tarjeta buscador-grande" aria-labelledby="etiqueta-busqueda">
        <label id="etiqueta-busqueda" for="busqueda-inicio">Buscar un equipo</label>
        <div class="caja">
          <Icono nombre="codigo" :tamano="24" />
          <input
            id="busqueda-inicio" v-model="texto" type="search" autocomplete="off"
            placeholder="Escribe o escanea el número de serie"
            @keydown.enter.prevent="alPresionarEnter"
          >
        </div>
        <p v-if="texto.trim() === ''" class="campo-ayuda">
          También puedes buscar por marca o modelo. Funciona con lector de código de barras: al escanear se abre la ficha del equipo.
        </p>
        <p v-else-if="cargando && resultados.length === 0" class="campo-ayuda">Buscando…</p>
        <p v-else-if="error" class="campo-error">{{ error }}</p>
        <ul v-else-if="resultados.length > 0" class="resultados">
          <li v-for="equipo in resultados" :key="equipo.id">
            <RouterLink :to="{ name: 'ficha-equipo', params: { id: equipo.id } }" :class="{ exacto: esExacto(equipo) }">
              <span class="serie">{{ equipo.numeroSerie }}</span>
              <span class="celda-doble">
                <span>{{ equipo.marca }} {{ equipo.modelo }}</span>
                <span>{{ equipo.asignacionVigente ? `Asignado a ${nombreCompleto(equipo.asignacionVigente.empleado)} · ${equipo.asignacionVigente.empleado.departamento}` : "Sin asignar" }}</span>
              </span>
              <span v-if="esExacto(equipo)" class="insignia coincidencia">Coincidencia exacta</span>
              <span class="abrir">Abrir ficha <Icono nombre="derecha" :tamano="16" :grosor="2" /></span>
            </RouterLink>
          </li>
        </ul>
        <div v-else-if="sinResultados" class="sin-resultados">
          <span>No hay equipos que coincidan con «{{ texto.trim() }}».</span>
          <RouterLink to="/inventario/nuevo" class="boton boton-secundario">Registrarlo como equipo nuevo</RouterLink>
        </div>
      </section>

      <nav class="accesos" aria-label="Accesos rápidos">
        <RouterLink to="/inventario/nuevo" class="acceso">
          <span class="icono"><Icono nombre="mas" :tamano="22" :grosor="2" /></span>
          <strong>Registrar equipo</strong>
          <span>Da de alta un equipo nuevo en el inventario.</span>
        </RouterLink>
        <RouterLink :to="{ name: 'inventario', query: { asignacion: 'libres' } }" class="acceso">
          <span class="icono"><Icono nombre="inventario" :tamano="22" /></span>
          <strong>Asignar un equipo</strong>
          <span>Revisa los equipos disponibles y entrégalos.</span>
        </RouterLink>
        <RouterLink :to="{ name: 'empleados', query: { nuevo: '1' } }" class="acceso">
          <span class="icono"><Icono nombre="empleados" :tamano="22" /></span>
          <strong>Registrar empleado</strong>
          <span>Agrega a una persona para asignarle equipos.</span>
        </RouterLink>
      </nav>

      <p v-if="errorResumen" class="aviso-error">{{ errorResumen }}</p>
      <nav v-else-if="resumen" class="cifras" aria-label="Resumen del inventario">
        <RouterLink to="/inventario"><strong>{{ resumen.equipos }}</strong><span>Equipos en inventario</span></RouterLink>
        <RouterLink :to="{ name: 'inventario', query: { asignacion: 'asignados' } }"><strong>{{ resumen.asignados }}</strong><span>Asignados</span></RouterLink>
        <RouterLink :to="{ name: 'inventario', query: { asignacion: 'libres' } }"><strong>{{ resumen.sinAsignar }}</strong><span>Sin asignar</span></RouterLink>
        <RouterLink :to="{ name: 'inventario', query: { estado: 'EN_MANTENIMIENTO' } }"><strong>{{ resumen.enMantenimiento }}</strong><span>En mantenimiento</span></RouterLink>
      </nav>
    </div>

    <aside class="tarjeta avisos" aria-labelledby="titulo-avisos">
      <div class="titulo-avisos">
        <h2 id="titulo-avisos">Avisos de mantenimiento</h2>
        <RouterLink to="/mantenimiento" class="ver-todo">Ver calendario</RouterLink>
      </div>
      <p v-if="errorAvisos" class="aviso-error">{{ errorAvisos }}</p>
      <p v-else-if="!avisos" class="subtitulo">Cargando…</p>
      <div v-else-if="avisos.total === 0" class="al-dia">
        <span class="insignia insignia-exito"><Icono nombre="hecho" :tamano="16" :grosor="2" />Todo al día</span>
        <p class="subtitulo">No hay mantenimientos vencidos ni programados para los próximos {{ avisos.diasAviso }} días.</p>
      </div>
      <template v-else>
        <section v-for="grupo in gruposAvisos" :key="grupo.clave" class="grupo-avisos" :aria-label="grupo.titulo">
          <h3 :class="`texto-${grupo.variante}`">{{ grupo.titulo }} <span class="insignia" :class="`insignia-${grupo.variante}`">{{ grupo.lista.length }}</span></h3>
          <ul>
            <li v-for="m in grupo.lista" :key="m.id" :class="`borde-${grupo.variante}`">
              <div class="celda-doble">
                <span>
                  <RouterLink :to="{ name: 'ficha-equipo', params: { id: m.equipo.id } }" class="serie">{{ m.equipo.numeroSerie }}</RouterLink>
                  · {{ ETIQUETAS_TIPO_MANTENIMIENTO[m.tipo] }}
                </span>
                <strong>{{ m.descripcion }}</strong>
                <span :class="`texto-${grupo.variante}`">{{ textoPlazo(m) }}</span>
              </div>
              <AccionesMantenimiento :mantenimiento="m" :equipo="m.equipo" compacto @actualizado="alActualizarMantenimiento" />
            </li>
          </ul>
        </section>
      </template>
    </aside>
  </div>
</template>

<style scoped>
.inicio { display: flex; gap: 24px; align-items: flex-start; }
.principal { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 22px; }
.buscador-grande { display: flex; flex-direction: column; gap: 12px; }
.buscador-grande label { font-size: 17px; font-weight: 700; }
.caja {
  display: flex; align-items: center; gap: 12px; height: 56px; padding: 0 16px;
  border: 2px solid var(--primario); border-radius: 10px; color: var(--primario);
}
.caja:focus-within { box-shadow: 0 0 0 3px var(--primario-suave); }
.caja input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font-family: var(--fuente-mono); font-size: 17px; color: var(--tinta); }
.campo-ayuda, .campo-error { margin: 0; }
.resultados { list-style: none; margin: 0; padding: 0; border: 1px solid var(--borde); border-radius: 10px; overflow: hidden; }
.resultados a {
  display: flex; align-items: center; gap: 14px; min-height: 56px; padding: 8px 16px;
  border-bottom: 1px solid var(--linea); color: var(--tinta); text-decoration: none;
}
.resultados li:last-child a { border-bottom: 0; }
.resultados a:hover, .resultados a.exacto { background: var(--primario-tenue); }
.resultados .serie { width: 150px; flex-shrink: 0; font-size: 14px; }
.resultados .celda-doble { flex: 1; min-width: 0; }
.resultados .celda-doble > span:first-child { font-weight: 600; }
.coincidencia { background: var(--primario); color: #FFFFFF; }
.abrir { display: inline-flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 600; color: var(--primario); }
.sin-resultados {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 12px 16px; background: var(--superficie-suave); border: 1px solid var(--borde); border-radius: 10px;
}
.accesos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.acceso {
  display: flex; flex-direction: column; gap: 8px; padding: 18px 20px;
  background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-tarjeta);
  color: var(--tinta); text-decoration: none;
}
.acceso:hover { border-color: var(--primario); color: var(--tinta); }
.acceso strong { font-size: 16px; }
.acceso > span:last-child { font-size: 14px; color: var(--texto-2); }
.icono { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 10px; background: var(--primario-suave); color: var(--primario); }
.cifras { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.cifras a {
  display: flex; flex-direction: column; gap: 4px; padding: 16px 20px;
  background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-tarjeta);
  color: var(--tinta); text-decoration: none;
}
.cifras a:hover { border-color: var(--primario); color: var(--tinta); }
.cifras strong { font-size: 30px; line-height: 1.1; }
.cifras span { font-size: 14px; color: var(--texto-2); }
.avisos { width: 380px; flex-shrink: 0; }
.avisos { display: flex; flex-direction: column; gap: 14px; }
.titulo-avisos { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.avisos h2 { margin: 0; font-size: 18px; }
.ver-todo { font-size: 14px; font-weight: 600; }
.al-dia { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.grupo-avisos h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; }
.grupo-avisos ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.grupo-avisos li {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px;
  border: 1px solid var(--borde); border-left-width: 4px; border-radius: var(--radio); background: var(--superficie-suave);
}
.grupo-avisos .serie { font-size: 14px; text-decoration: none; }
.grupo-avisos strong { font-size: 14px; }
.borde-peligro { border-left-color: var(--peligro) !important; }
.borde-alerta { border-left-color: var(--alerta) !important; }
.texto-peligro { color: var(--peligro) !important; font-weight: 600; }
.texto-alerta { color: var(--alerta) !important; font-weight: 600; }
@media (max-width: 1200px) {
  .inicio { flex-direction: column; }
  .avisos { width: 100%; }
}
@media (max-width: 800px) {
  .accesos, .cifras { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
