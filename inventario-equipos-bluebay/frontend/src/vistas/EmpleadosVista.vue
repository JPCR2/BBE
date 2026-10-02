<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ErrorApi } from "../api/cliente";
import {
  editarEmpleado, listarDepartamentos, listarEmpleados, obtenerEmpleado, registrarDepartamento, registrarEmpleado,
  type Departamento, type DatosEmpleado, type Empleado, type FichaEmpleado, type ListadoEmpleados,
} from "../api/empleados";
import DialogoAsignar from "../componentes/DialogoAsignar.vue";
import DialogoConfirmar from "../componentes/DialogoConfirmar.vue";
import FormularioEmpleado from "../componentes/FormularioEmpleado.vue";
import Icono from "../componentes/Icono.vue";
import { mostrarAviso } from "../composables/useAvisos";
import { ETIQUETAS_TIPO, fechaCorta, iniciales, nombreCompleto } from "../utilidades/formato";

type Pestana = "empleados" | "departamentos";
type Panel = "ficha" | "alta" | "edicion";

const ruta = useRoute();
const pestana = ref<Pestana>("empleados");
const panel = ref<Panel>("ficha");

const listado = ref<ListadoEmpleados | null>(null);
const departamentos = ref<Departamento[]>([]);
const seleccionado = ref<FichaEmpleado | null>(null);
const cargando = ref(true);
const error = ref("");

const busqueda = ref("");
const departamentoId = ref<number | "">("");
const estado = ref<"activos" | "inactivos" | "todos">("activos");

const enviando = ref(false);
const erroresServidor = ref<Record<string, string>>({});
const nombreDepartamento = ref("");
const errorDepartamento = ref("");
const asignando = ref(false);
const confirmandoDesactivar = ref(false);
const errorDesactivar = ref("");

let controlador: AbortController | undefined;
let pausa: ReturnType<typeof setTimeout> | undefined;

async function cargarEmpleados(seleccionarId?: number) {
  controlador?.abort();
  controlador = new AbortController();
  cargando.value = true;
  error.value = "";
  try {
    listado.value = await listarEmpleados(
      { busqueda: busqueda.value.trim(), departamentoId: departamentoId.value, estado: estado.value, porPagina: 50 },
      controlador.signal,
    );
    const id = seleccionarId ?? seleccionado.value?.id ?? listado.value.datos[0]?.id;
    if (id) await verFicha(id);
    else seleccionado.value = null;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    error.value = e instanceof ErrorApi ? e.message : "No se pudo cargar la lista de empleados.";
  }
  cargando.value = false;
}

async function cargarDepartamentos() {
  try {
    departamentos.value = (await listarDepartamentos()).datos;
  } catch (e) {
    error.value = e instanceof ErrorApi ? e.message : "No se pudieron cargar los departamentos.";
  }
}

async function verFicha(id: number) {
  try {
    seleccionado.value = await obtenerEmpleado(id);
    panel.value = "ficha";
  } catch {
    seleccionado.value = null;
  }
}

onMounted(async () => {
  await cargarDepartamentos();
  await cargarEmpleados();
  if (ruta.query.nuevo === "1") abrirAlta();
});

watch(busqueda, () => {
  clearTimeout(pausa);
  pausa = setTimeout(() => cargarEmpleados(), 300);
});
watch([departamentoId, estado], () => cargarEmpleados());
onBeforeUnmount(() => {
  clearTimeout(pausa);
  controlador?.abort();
});

function abrirAlta() {
  erroresServidor.value = {};
  panel.value = "alta";
  pestana.value = "empleados";
}

const inicialFormulario = computed<Partial<DatosEmpleado>>(() =>
  panel.value === "edicion" && seleccionado.value
    ? {
        numeroEmpleado: seleccionado.value.numeroEmpleado,
        nombre: seleccionado.value.nombre,
        apellidos: seleccionado.value.apellidos,
        puesto: seleccionado.value.puesto,
        departamentoId: seleccionado.value.departamento.id,
      }
    : {},
);

async function guardarEmpleado(datos: DatosEmpleado) {
  enviando.value = true;
  erroresServidor.value = {};
  try {
    const guardado =
      panel.value === "alta"
        ? await registrarEmpleado(datos)
        : await editarEmpleado(seleccionado.value!.id, datos);
    mostrarAviso(panel.value === "alta" ? `Empleado registrado: ${nombreCompleto(guardado)}.` : "Cambios guardados.");
    panel.value = "ficha";
    await cargarDepartamentos();
    await cargarEmpleados(guardado.id);
  } catch (e) {
    erroresServidor.value =
      e instanceof ErrorApi && Object.keys(e.campos).length > 0
        ? e.campos
        : { _: e instanceof Error ? e.message : "No se pudo guardar el empleado." };
  } finally {
    enviando.value = false;
  }
}

async function desactivar() {
  if (!seleccionado.value) return;
  enviando.value = true;
  errorDesactivar.value = "";
  try {
    await editarEmpleado(seleccionado.value.id, { activo: false });
    mostrarAviso(`${nombreCompleto(seleccionado.value)} quedó como inactivo.`);
    confirmandoDesactivar.value = false;
    await cargarEmpleados(seleccionado.value.id);
  } catch (e) {
    errorDesactivar.value = e instanceof ErrorApi ? e.message : "No se pudo desactivar al empleado.";
  } finally {
    enviando.value = false;
  }
}

async function reactivar() {
  if (!seleccionado.value) return;
  try {
    await editarEmpleado(seleccionado.value.id, { activo: true });
    mostrarAviso(`${nombreCompleto(seleccionado.value)} quedó como activo.`);
    await cargarEmpleados(seleccionado.value.id);
  } catch (e) {
    mostrarAviso(e instanceof ErrorApi ? e.message : "No se pudo activar al empleado.", "error");
  }
}

async function agregarDepartamento() {
  errorDepartamento.value = "";
  const nombre = nombreDepartamento.value.trim();
  if (nombre === "") {
    errorDepartamento.value = "Escribe el nombre del departamento.";
    return;
  }
  try {
    await registrarDepartamento(nombre);
    mostrarAviso(`Departamento agregado: ${nombre}.`);
    nombreDepartamento.value = "";
    await cargarDepartamentos();
  } catch (e) {
    errorDepartamento.value = e instanceof ErrorApi ? e.message : "No se pudo agregar el departamento.";
  }
}

async function alAsignar(mensaje: string) {
  asignando.value = false;
  mostrarAviso(mensaje);
  await cargarEmpleados(seleccionado.value?.id);
}

const empleadoParaDialogo = computed<Empleado | undefined>(() => seleccionado.value ?? undefined);
</script>

<template>
  <div class="vista">
    <div class="encabezado-pagina">
      <div>
        <h1 class="titulo-pagina">Empleados</h1>
        <p class="subtitulo">Personas a las que se les pueden asignar equipos.</p>
      </div>
      <button type="button" class="boton boton-primario" @click="abrirAlta">
        <Icono nombre="mas" :tamano="18" :grosor="2" />Registrar empleado
      </button>
    </div>

    <div class="pestanas" role="tablist" aria-label="Secciones de empleados">
      <button type="button" role="tab" :aria-selected="pestana === 'empleados'" :class="{ activa: pestana === 'empleados' }" @click="pestana = 'empleados'">
        Empleados<template v-if="listado"> ({{ listado.conteos.activos }})</template>
      </button>
      <button type="button" role="tab" :aria-selected="pestana === 'departamentos'" :class="{ activa: pestana === 'departamentos' }" @click="pestana = 'departamentos'">
        Departamentos ({{ departamentos.length }})
      </button>
    </div>

    <p v-if="error" class="aviso-error">{{ error }}</p>

    <!-- ------------------------------------------------------- Empleados -->
    <div v-if="pestana === 'empleados'" class="columnas">
      <div class="principal">
        <div class="filtros">
          <div class="caja-busqueda">
            <Icono nombre="buscar" :tamano="18" />
            <input v-model="busqueda" type="search" aria-label="Buscar por nombre, número de empleado o puesto" placeholder="Nombre, número de empleado o puesto">
          </div>
          <select v-model="departamentoId" class="entrada angosta" aria-label="Departamento">
            <option value="">Todos los departamentos</option>
            <option v-for="departamento in departamentos" :key="departamento.id" :value="departamento.id">{{ departamento.nombre }}</option>
          </select>
          <select v-model="estado" class="entrada angosta" aria-label="Estado del empleado">
            <option value="activos">Activos</option>
            <option value="inactivos">Inactivos</option>
            <option value="todos">Todos</option>
          </select>
        </div>

        <div class="contenedor-tabla">
          <table class="tabla" aria-label="Empleados" :aria-busy="cargando">
            <thead>
              <tr>
                <th scope="col">No. empleado</th>
                <th scope="col">Nombre</th>
                <th scope="col">Puesto</th>
                <th scope="col">Departamento</th>
                <th scope="col">Equipos</th>
              </tr>
            </thead>
            <tbody v-if="listado && listado.datos.length > 0">
              <tr v-for="persona in listado.datos" :key="persona.id" :class="{ elegida: seleccionado?.id === persona.id && panel === 'ficha' }">
                <td class="serie">{{ persona.numeroEmpleado }}</td>
                <td>
                  <button type="button" class="boton-enlace" :aria-pressed="seleccionado?.id === persona.id" @click="verFicha(persona.id)">
                    {{ nombreCompleto(persona) }}
                  </button>
                  <span v-if="!persona.activo" class="insignia insignia-neutra inactivo">Inactivo</span>
                </td>
                <td class="tenue">{{ persona.puesto }}</td>
                <td class="tenue">{{ persona.departamento.nombre }}</td>
                <td>
                  <span class="insignia" :class="persona.equiposAsignados > 0 ? 'insignia-primaria' : 'insignia-neutra'">
                    {{ persona.equiposAsignados === 0 ? "Ninguno" : persona.equiposAsignados === 1 ? "1 equipo" : `${persona.equiposAsignados} equipos` }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="cargando && !listado" class="estado-vacio">Cargando empleados…</p>
          <div v-else-if="listado && listado.datos.length === 0" class="estado-vacio">
            <strong>Ningún empleado coincide con la búsqueda.</strong>
            <p>Prueba con otro nombre o cambia los filtros.</p>
          </div>
          <div v-if="listado && listado.datos.length > 0" class="pie-tabla">
            <span>Mostrando {{ listado.datos.length }} de {{ listado.total }} · haz clic en un nombre para ver su ficha</span>
          </div>
        </div>
      </div>

      <aside class="tarjeta lateral">
        <!-- Alta o edición -->
        <FormularioEmpleado
          v-if="panel !== 'ficha'"
          :modo="panel === 'alta' ? 'alta' : 'edicion'"
          :departamentos="departamentos"
          :inicial="inicialFormulario"
          :errores-servidor="erroresServidor"
          :enviando="enviando"
          @enviar="guardarEmpleado"
          @cancelar="panel = 'ficha'"
        />

        <!-- Ficha rápida -->
        <div v-else-if="seleccionado" class="ficha">
          <div class="persona">
            <span class="avatar" aria-hidden="true">{{ iniciales(seleccionado) }}</span>
            <div class="celda-doble">
              <h2>{{ nombreCompleto(seleccionado) }}</h2>
              <span>{{ seleccionado.puesto }} · {{ seleccionado.departamento.nombre }}</span>
              <span class="serie">No. de empleado {{ seleccionado.numeroEmpleado }}</span>
            </div>
          </div>
          <span class="insignia" :class="seleccionado.activo ? 'insignia-exito' : 'insignia-neutra'">
            {{ seleccionado.activo ? "Activo" : "Inactivo" }}
          </span>

          <div class="bloque">
            <h3>Equipos asignados</h3>
            <RouterLink
              v-for="linea in seleccionado.equiposVigentes" :key="linea.id"
              :to="{ name: 'ficha-equipo', params: { id: linea.equipo.id } }" class="equipo"
            >
              <span class="serie">{{ linea.equipo.numeroSerie }}</span>
              <span>{{ linea.equipo.marca }} {{ linea.equipo.modelo }} · {{ ETIQUETAS_TIPO[linea.equipo.tipo] }}</span>
              <span class="tenue">Desde el {{ fechaCorta(linea.fechaAsignacion) }}</span>
            </RouterLink>
            <p v-if="seleccionado.equiposVigentes.length === 0" class="subtitulo">No tiene equipos asignados.</p>
            <button v-if="seleccionado.activo" type="button" class="boton boton-secundario" @click="asignando = true">
              <Icono nombre="mas" :tamano="18" :grosor="2" />Asignarle un equipo
            </button>
          </div>

          <div class="bloque">
            <h3>Historial</h3>
            <p v-if="seleccionado.historial.length === 0" class="subtitulo">Sin movimientos todavía.</p>
            <ul v-else class="historial">
              <li v-for="linea in seleccionado.historial" :key="linea.id">
                <span class="serie">{{ linea.equipo.numeroSerie }}</span>
                <span class="tenue">
                  {{ fechaCorta(linea.fechaAsignacion) }} → {{ linea.fechaDevolucion ? fechaCorta(linea.fechaDevolucion) : "vigente" }}
                </span>
              </li>
            </ul>
          </div>

          <div class="bloque acciones-ficha">
            <button type="button" class="boton-enlace" @click="panel = 'edicion'">Editar datos del empleado</button>
            <template v-if="seleccionado.activo">
              <button
                v-if="seleccionado.equiposVigentes.length === 0" type="button" class="boton-enlace peligro"
                @click="errorDesactivar = ''; confirmandoDesactivar = true"
              >
                Desactivar empleado
              </button>
              <template v-else>
                <span class="boton-enlace deshabilitado" aria-disabled="true">Desactivar empleado</span>
                <span class="campo-ayuda">Primero registra la devolución de sus equipos.</span>
              </template>
            </template>
            <button v-else type="button" class="boton-enlace" @click="reactivar">Volver a activar</button>
          </div>
        </div>

        <p v-else class="subtitulo">Elige un empleado de la lista para ver su ficha.</p>
      </aside>
    </div>

    <!-- --------------------------------------------------- Departamentos -->
    <div v-else class="columnas">
      <div class="contenedor-tabla principal">
        <table class="tabla" aria-label="Departamentos">
          <thead><tr><th scope="col">Departamento</th><th scope="col">Empleados activos</th></tr></thead>
          <tbody>
            <tr v-for="departamento in departamentos" :key="departamento.id">
              <td><strong>{{ departamento.nombre }}</strong></td>
              <td class="tenue">{{ departamento.empleadosActivos === 0 ? "Sin empleados" : departamento.empleadosActivos }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <aside class="tarjeta lateral">
        <h2 class="titulo-lateral">Agregar departamento</h2>
        <form class="campo" @submit.prevent="agregarDepartamento">
          <label for="nuevoDepartamento">Nombre *</label>
          <input id="nuevoDepartamento" v-model="nombreDepartamento" class="entrada" placeholder="Ej. Mantenimiento" :aria-invalid="!!errorDepartamento" maxlength="100">
          <span v-if="errorDepartamento" class="campo-error">{{ errorDepartamento }}</span>
          <span class="campo-ayuda">No se permiten nombres repetidos, aunque cambien acentos o mayúsculas.</span>
          <button type="submit" class="boton boton-primario">Agregar departamento</button>
        </form>
      </aside>
    </div>

    <DialogoAsignar v-if="asignando" :empleado="empleadoParaDialogo" @asignado="alAsignar" @cerrar="asignando = false" />
    <DialogoConfirmar
      v-if="confirmandoDesactivar && seleccionado"
      titulo="¿Desactivar al empleado?"
      :mensaje="`${nombreCompleto(seleccionado)} dejará de aparecer para asignarle equipos. Su historial se conserva y puedes volver a activarlo cuando quieras.`"
      texto-confirmar="Desactivar empleado"
      :enviando="enviando"
      :error="errorDesactivar"
      @confirmar="desactivar"
      @cerrar="confirmandoDesactivar = false"
    />
  </div>
</template>

<style scoped>
.vista { display: flex; flex-direction: column; gap: 18px; }
.pestanas { display: flex; gap: 28px; border-bottom: 1px solid var(--borde); }
.pestanas button {
  min-height: 44px; padding: 0 2px; margin-bottom: -1px;
  border: 0; border-bottom: 3px solid transparent; background: transparent;
  font: inherit; font-weight: 600; color: var(--texto-2); cursor: pointer;
}
.pestanas button.activa { color: var(--tinta); border-bottom-color: var(--primario); }
.columnas { display: flex; gap: 20px; align-items: flex-start; }
.principal { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 14px; }
.filtros { display: flex; flex-wrap: wrap; gap: 12px; }
.caja-busqueda {
  display: flex; align-items: center; gap: 10px; flex: 1; min-width: 240px; min-height: 44px; padding: 0 12px;
  border: 1px solid var(--borde-fuerte); border-radius: var(--radio); background: var(--superficie); color: var(--texto-2);
}
.caja-busqueda:focus-within { outline: 3px solid var(--primario); outline-offset: 2px; }
.caja-busqueda input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font: inherit; color: var(--tinta); }
.angosta { width: auto; }
.tabla tr.elegida { background: var(--primario-tenue); }
.tenue { color: var(--texto-2); }
.inactivo { margin-left: 8px; }
.lateral { width: 350px; flex-shrink: 0; }
.titulo-lateral { margin: 0 0 12px; font-size: 17px; font-weight: 700; }
.ficha { display: flex; flex-direction: column; gap: 14px; align-items: flex-start; }
.ficha h2 { margin: 0; font-size: 17px; font-weight: 700; }
.persona { display: flex; align-items: center; gap: 14px; }
.persona .avatar { width: 48px; height: 48px; border-radius: 24px; font-size: 16px; }
.bloque { width: 100%; display: flex; flex-direction: column; gap: 10px; padding-top: 14px; border-top: 1px solid var(--linea); }
.bloque h3 { margin: 0; font-size: 14px; font-weight: 700; }
.equipo {
  display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; text-decoration: none; color: var(--tinta);
  background: var(--superficie-suave); border: 1px solid var(--borde); border-radius: 10px; font-size: 14px;
}
.equipo:hover { border-color: var(--primario); color: var(--tinta); }
.historial { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
.historial li { display: flex; justify-content: space-between; gap: 10px; }
.acciones-ficha { align-items: flex-start; gap: 4px; }
.peligro { color: var(--peligro); }
.deshabilitado { color: var(--texto-3); }
@media (max-width: 1100px) {
  .columnas { flex-direction: column; align-items: stretch; }
  .lateral { width: 100%; }
}
</style>
