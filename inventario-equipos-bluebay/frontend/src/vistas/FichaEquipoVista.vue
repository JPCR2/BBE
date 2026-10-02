<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ErrorApi } from "../api/cliente";
import { urlReporteBaja } from "../api/bajas";
import { obtenerEquipo, urlReporteAlta, type FichaEquipo } from "../api/equipos";
import AccionesMantenimiento from "../componentes/AccionesMantenimiento.vue";
import DialogoAsignar from "../componentes/DialogoAsignar.vue";
import DialogoDevolucion from "../componentes/DialogoDevolucion.vue";
import DialogoProgramarMantenimiento from "../componentes/DialogoProgramarMantenimiento.vue";
import Icono from "../componentes/Icono.vue";
import InsigniaEstado from "../componentes/InsigniaEstado.vue";
import { mostrarAviso } from "../composables/useAvisos";
import { recargarAvisos } from "../composables/useAvisosMantenimiento";
import { ETIQUETAS_TIPO, duracion, fechaCorta, iniciales, moneda, nombreCompleto, tiempoDesde } from "../utilidades/formato";
import { ETIQUETAS_SITUACION, ETIQUETAS_TIPO_MANTENIMIENTO, VARIANTE_SITUACION, textoPlazo } from "../utilidades/mantenimiento";

const props = defineProps<{ id: string }>();
const equipo = ref<FichaEquipo | null>(null);
const error = ref<{ estado: number; mensaje: string } | null>(null);

async function cargar() {
  equipo.value = null;
  error.value = null;
  try {
    equipo.value = await obtenerEquipo(Number(props.id));
  } catch (e) {
    error.value = e instanceof ErrorApi ? { estado: e.estado, mensaje: e.message } : { estado: 0, mensaje: "No se pudo cargar el equipo." };
  }
}
watch(() => props.id, cargar, { immediate: true });

const vigente = computed(() => equipo.value?.asignacionVigente ?? null);
const asignando = ref(false);
const devolviendo = ref(false);
const programando = ref(false);

async function alTerminar(mensaje: string) {
  asignando.value = false;
  devolviendo.value = false;
  mostrarAviso(mensaje);
  await cargar();
}

async function alProgramar(mensaje: string) {
  programando.value = false;
  await Promise.all([alTerminar(mensaje), recargarAvisos()]);
}
</script>

<template>
  <div v-if="error" class="estado-vacio">
    <strong>{{ error.estado === 404 ? "No encontramos ese equipo." : error.mensaje }}</strong>
    <p v-if="error.estado === 404">Puede que el enlace esté incompleto. Búscalo por su número de serie en el inventario.</p>
    <RouterLink to="/inventario" class="boton boton-secundario">Ir al inventario</RouterLink>
  </div>

  <p v-else-if="!equipo" class="subtitulo">Cargando…</p>

  <div v-else class="vista">
    <nav class="ruta" aria-label="Ruta de navegación">
      <RouterLink to="/inventario">Inventario</RouterLink><span aria-hidden="true">/</span><span class="serie">{{ equipo.numeroSerie }}</span>
    </nav>

    <div class="encabezado-pagina">
      <div>
        <div class="etiquetas">
          <span class="chip-serie">{{ equipo.numeroSerie }}</span>
          <InsigniaEstado :estado="equipo.estado" />
        </div>
        <h1 class="titulo-pagina">{{ equipo.marca }} {{ equipo.modelo }}</h1>
        <p class="subtitulo">{{ ETIQUETAS_TIPO[equipo.tipo] }}<template v-if="equipo.ubicacion"> · {{ equipo.ubicacion }}</template></p>
      </div>
      <div class="acciones-encabezado">
        <a :href="urlReporteAlta([equipo.id])" target="_blank" rel="noopener" class="boton boton-secundario imprimir-alta">
          <Icono nombre="imprimir" :tamano="18" />Reporte de alta
        </a>
        <RouterLink v-if="equipo.estado !== 'BAJA'" :to="{ name: 'editar-equipo', params: { id } }" class="boton boton-secundario">
          <Icono nombre="editar" :tamano="18" />Editar datos
        </RouterLink>
        <RouterLink v-if="equipo.estado !== 'BAJA'" :to="{ name: 'nueva-baja', query: { equipo: id } }" class="boton boton-peligro dar-de-baja">
          <Icono nombre="bajas" :tamano="18" />Dar de baja
        </RouterLink>
      </div>
    </div>

    <section v-if="equipo.baja" class="aviso-baja" aria-labelledby="titulo-baja">
      <div>
        <h2 id="titulo-baja">Dado de baja el {{ fechaCorta(equipo.baja.fechaBaja) }}</h2>
        <p>Folio <span class="serie">{{ equipo.baja.folio }}</span> · Motivo: {{ equipo.baja.observaciones }}.</p>
        <p>Ya no se puede editar, asignar ni darle mantenimiento; su historial se conserva.</p>
      </div>
      <a :href="urlReporteBaja(equipo.baja.id)" target="_blank" rel="noopener" class="boton boton-secundario imprimir-baja">
        <Icono nombre="imprimir" :tamano="18" />Reporte de baja
      </a>
    </section>

    <div class="rejilla">
      <section class="tarjeta" aria-labelledby="titulo-datos">
        <h2 id="titulo-datos">Datos del equipo</h2>
        <dl class="datos">
          <div><dt>Marca</dt><dd>{{ equipo.marca }}</dd></div>
          <div><dt>Modelo</dt><dd>{{ equipo.modelo }}</dd></div>
          <div><dt>Fecha de adquisición</dt><dd>{{ fechaCorta(equipo.fechaAdquisicion) }}</dd></div>
          <div><dt>Tiempo de funcionamiento</dt><dd>{{ duracion(equipo.tiempoFuncionamiento) }}</dd></div>
          <div><dt>Costo</dt><dd>{{ moneda(equipo.costo) }}</dd></div>
          <div><dt>Folio de factura</dt><dd class="mono" :class="{ tenue: !equipo.folioFactura }">{{ equipo.folioFactura ?? "Sin registrar" }}</dd></div>
          <div>
            <dt>Garantía</dt>
            <dd v-if="equipo.fechaVencimientoGarantia" class="garantia">
              <span class="insignia" :class="equipo.garantiaVigente ? 'insignia-exito' : 'insignia-neutra'">{{ equipo.garantiaVigente ? "Vigente" : "Vencida" }}</span>
              {{ equipo.garantiaVigente ? "hasta el" : "desde el" }} {{ fechaCorta(equipo.fechaVencimientoGarantia) }}
            </dd>
            <dd v-else class="tenue">Sin registrar</dd>
          </div>
          <div><dt>Registrado en el sistema</dt><dd>{{ fechaCorta(equipo.creadoEn) }}</dd></div>
          <div class="completo">
            <dt>Especificaciones</dt>
            <dd :class="{ tenue: !equipo.especificaciones }">{{ equipo.especificaciones ?? "Sin especificaciones registradas" }}</dd>
          </div>
        </dl>
      </section>

      <section class="tarjeta" aria-labelledby="titulo-asignacion">
        <h2 id="titulo-asignacion">Asignación vigente</h2>
        <div v-if="vigente" class="asignado">
          <div class="persona">
            <span class="avatar" aria-hidden="true">{{ iniciales(vigente.empleado) }}</span>
            <div class="celda-doble">
              <strong>{{ nombreCompleto(vigente.empleado) }}</strong>
              <span>{{ vigente.empleado.puesto }} · {{ vigente.empleado.departamento }}</span>
              <span class="mono">No. de empleado {{ vigente.empleado.numeroEmpleado }}</span>
            </div>
          </div>
          <dl class="datos">
            <div>
              <dt>Asignado desde</dt>
              <dd>{{ fechaCorta(vigente.fechaAsignacion) }} · hace {{ duracion(tiempoDesde(vigente.fechaAsignacion)).toLowerCase() }}</dd>
            </div>
          </dl>
          <div class="acciones-asignacion">
            <button type="button" class="boton boton-secundario" @click="devolviendo = true">
              <Icono nombre="devolver" :tamano="18" />Registrar devolución
            </button>
            <span class="campo-ayuda">Para reasignarlo, primero registra la devolución.</span>
          </div>
        </div>
        <div v-else class="libre">
          <span class="insignia insignia-neutra">Sin asignar</span>
          <p class="subtitulo">Este equipo no está asignado a ningún empleado.</p>
          <button v-if="equipo.estado === 'ACTIVO'" type="button" class="boton boton-primario" @click="asignando = true">
            <Icono nombre="mas" :tamano="18" :grosor="2" />Asignar equipo
          </button>
          <p v-else-if="equipo.estado === 'EN_MANTENIMIENTO'" class="campo-ayuda">
            Está en mantenimiento. Cámbialo a Activo desde «Editar datos» para poder asignarlo.
          </p>
        </div>
      </section>
    </div>

    <div class="rejilla">
      <section class="tarjeta" aria-labelledby="titulo-historial">
        <h2 id="titulo-historial">Historial de asignaciones</h2>
        <table v-if="equipo.asignaciones.length > 0" class="tabla compacta" aria-labelledby="titulo-historial">
          <thead><tr><th scope="col">Empleado</th><th scope="col">Desde</th><th scope="col">Hasta</th></tr></thead>
          <tbody>
            <tr v-for="a in equipo.asignaciones" :key="a.id">
              <td><span class="celda-doble"><span>{{ nombreCompleto(a.empleado) }}</span><span>{{ a.empleado.departamento }}</span></span></td>
              <td>{{ fechaCorta(a.fechaAsignacion) }}</td>
              <td>
                <span v-if="!a.fechaDevolucion" class="insignia insignia-primaria">Vigente</span>
                <template v-else>{{ fechaCorta(a.fechaDevolucion) }}</template>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="subtitulo">Este equipo todavía no se ha asignado a nadie.</p>
      </section>

      <section class="tarjeta" aria-labelledby="titulo-mantenimientos">
        <div class="titulo-seccion">
          <h2 id="titulo-mantenimientos">Mantenimientos</h2>
          <button v-if="equipo.estado !== 'BAJA'" type="button" class="boton boton-secundario" @click="programando = true">
            <Icono nombre="mas" :tamano="18" :grosor="2" />Programar
          </button>
        </div>
        <ul v-if="equipo.mantenimientos.length > 0" class="mantenimientos">
          <li v-for="m in equipo.mantenimientos" :key="m.id">
            <div class="fila-mantenimiento">
              <div class="celda-doble">
                <strong>{{ m.descripcion }}</strong>
                <span>
                  {{ ETIQUETAS_TIPO_MANTENIMIENTO[m.tipo] }} · {{ textoPlazo(m) }}<template v-if="m.responsable"> · {{ m.responsable }}</template>
                </span>
              </div>
              <span class="insignia" :class="`insignia-${VARIANTE_SITUACION[m.situacion]}`">{{ ETIQUETAS_SITUACION[m.situacion] }}</span>
            </div>
            <AccionesMantenimiento :mantenimiento="m" :equipo="equipo" @actualizado="alTerminar" />
          </li>
        </ul>
        <p v-else class="subtitulo">Sin mantenimientos registrados.</p>
      </section>
    </div>

    <DialogoAsignar v-if="asignando" :equipo="equipo" @asignado="alTerminar" @cerrar="asignando = false" />
    <DialogoDevolucion v-if="devolviendo" :equipo="equipo" @devuelto="alTerminar" @cerrar="devolviendo = false" />
    <DialogoProgramarMantenimiento v-if="programando" :equipo="equipo" @guardado="alProgramar" @cerrar="programando = false" />
  </div>
</template>

<style scoped>
.vista { display: flex; flex-direction: column; gap: 18px; }
.etiquetas { display: flex; align-items: center; gap: 10px; }
.acciones-encabezado { display: flex; flex-wrap: wrap; gap: 10px; }
.aviso-baja {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px 20px;
  padding: 16px 20px; border-radius: var(--radio-tarjeta); background: var(--neutro-fondo); border: 1px solid var(--borde);
}
.aviso-baja h2 { margin: 0 0 4px; font-size: 17px; font-weight: 700; }
.aviso-baja p { margin: 0; color: var(--texto-2); }
.garantia { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.chip-serie { padding: 4px 10px; border-radius: 6px; background: var(--primario-suave); color: var(--primario); font-family: var(--fuente-mono); font-size: 14px; font-weight: 500; }
.rejilla { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.datos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 24px; margin: 0; }
.datos div { display: flex; flex-direction: column; gap: 3px; }
.datos .completo { grid-column: 1 / -1; }
.datos dt { font-size: 13px; font-weight: 600; color: var(--texto-2); }
.datos dd { margin: 0; }
.tenue { color: var(--texto-2); }
.asignado, .libre { display: flex; flex-direction: column; gap: 16px; align-items: flex-start; }
.acciones-asignacion { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.persona { display: flex; align-items: center; gap: 14px; }
.persona strong { font-size: 17px; }
.avatar { width: 48px; height: 48px; flex-shrink: 0; border-radius: 24px; display: flex; align-items: center; justify-content: center; background: var(--primario-suave); color: var(--primario); font-weight: 700; }
.mono { font-family: var(--fuente-mono); }
.compacta th, .compacta td { padding-left: 0; }
.mantenimientos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.mantenimientos li { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; background: var(--superficie-suave); border: 1px solid var(--borde); border-radius: 10px; }
.fila-mantenimiento { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.titulo-seccion { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.titulo-seccion h2 { margin: 0; font-size: 17px; font-weight: 700; }
@media (max-width: 1100px) { .rejilla { grid-template-columns: 1fr; } }
</style>
