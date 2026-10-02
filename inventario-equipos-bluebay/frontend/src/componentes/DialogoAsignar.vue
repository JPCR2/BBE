<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { asignarEquipo } from "../api/asignaciones";
import { ErrorApi } from "../api/cliente";
import type { Empleado } from "../api/empleados";
import { listarEquipos, type EquipoResumen } from "../api/equipos";
import { useBusquedaEmpleados } from "../composables/useBusquedaEmpleados";
import { ETIQUETAS_TIPO, iniciales, nombreCompleto } from "../utilidades/formato";
import Icono from "./Icono.vue";

/**
 * Diálogo de asignación. Desde la ficha de un equipo se elige al empleado;
 * desde la ficha de un empleado se elige el equipo disponible.
 */
const props = defineProps<{ equipo?: EquipoResumen; empleado?: Empleado }>();
const emit = defineEmits<{ asignado: [mensaje: string]; cerrar: [] }>();

const dialogo = ref<HTMLDialogElement>();
const observaciones = ref("");
const error = ref("");
const enviando = ref(false);

const eligeEmpleado = computed(() => !!props.equipo);
const empleadoElegido = ref<Empleado | null>(props.empleado ?? null);
const equipoElegido = ref<EquipoResumen | null>(props.equipo ?? null);

const busquedaEmpleados = useBusquedaEmpleados();
const equiposLibres = ref<EquipoResumen[]>([]);
const textoEquipos = ref("");
const cargandoEquipos = ref(false);

async function buscarEquiposLibres() {
  cargandoEquipos.value = true;
  try {
    const respuesta = await listarEquipos({ busqueda: textoEquipos.value.trim(), asignacion: "libres", estado: "ACTIVO", porPagina: 6 });
    equiposLibres.value = respuesta.datos;
  } catch (e) {
    error.value = e instanceof ErrorApi ? e.message : "No se pudieron cargar los equipos disponibles.";
  }
  cargandoEquipos.value = false;
}

onMounted(async () => {
  dialogo.value?.showModal();
  if (eligeEmpleado.value) await busquedaEmpleados.consultar();
  else await buscarEquiposLibres();
});

const listo = computed(() => !!empleadoElegido.value && !!equipoElegido.value);

async function asignar() {
  if (!listo.value) return;
  enviando.value = true;
  error.value = "";
  try {
    await asignarEquipo({
      equipoId: equipoElegido.value!.id,
      empleadoId: empleadoElegido.value!.id,
      observaciones: observaciones.value.trim() || undefined,
    });
    emit(
      "asignado",
      `${equipoElegido.value!.numeroSerie} quedó asignado a ${nombreCompleto(empleadoElegido.value!)}.`,
    );
  } catch (e) {
    error.value = e instanceof ErrorApi ? e.message : "No se pudo asignar el equipo.";
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <dialog ref="dialogo" class="dialogo" aria-labelledby="titulo-asignar" @close="emit('cerrar')" @cancel="emit('cerrar')">
    <form @submit.prevent="asignar">
      <div class="dialogo-encabezado">
        <h2 id="titulo-asignar">Asignar equipo</h2>
        <button type="button" class="dialogo-cerrar" aria-label="Cerrar" @click="emit('cerrar')"><Icono nombre="cerrar" /></button>
      </div>

      <div v-if="equipoElegido" class="resumen-equipo">
        <Icono nombre="inventario" :tamano="22" />
        <span class="celda-doble">
          <span class="serie">{{ equipoElegido.numeroSerie }}</span>
          <span>{{ equipoElegido.marca }} {{ equipoElegido.modelo }} · {{ ETIQUETAS_TIPO[equipoElegido.tipo] }}</span>
        </span>
      </div>

      <!-- Desde el equipo: se elige a la persona -->
      <div v-if="eligeEmpleado" class="campo">
        <label for="buscar-empleado">¿A quién se le entrega? *</label>
        <input id="buscar-empleado" v-model="busquedaEmpleados.texto.value" class="entrada" type="search" placeholder="Nombre, número de empleado o puesto" autocomplete="off">
        <div class="lista-opciones">
          <button
            v-for="persona in busquedaEmpleados.resultados.value" :key="persona.id" type="button"
            class="opcion-persona" :aria-pressed="empleadoElegido?.id === persona.id" @click="empleadoElegido = persona"
          >
            <span class="avatar" aria-hidden="true">{{ empleadoElegido?.id === persona.id ? "✓" : iniciales(persona) }}</span>
            <span class="celda-doble">
              <span><strong>{{ nombreCompleto(persona) }}</strong></span>
              <span>{{ persona.puesto }} · {{ persona.departamento.nombre }} · {{ persona.equiposAsignados === 0 ? "sin equipos" : `${persona.equiposAsignados} equipo(s)` }}</span>
            </span>
            <span class="serie">{{ persona.numeroEmpleado }}</span>
          </button>
          <p v-if="!busquedaEmpleados.cargando.value && busquedaEmpleados.resultados.value.length === 0" class="campo-ayuda sin-datos">
            Ningún empleado activo coincide con la búsqueda.
          </p>
        </div>
        <span class="campo-ayuda">Solo aparecen empleados activos.</span>
      </div>

      <!-- Desde el empleado: se elige el equipo disponible -->
      <div v-else class="campo">
        <label for="buscar-equipo">¿Qué equipo se le entrega? *</label>
        <input id="buscar-equipo" v-model="textoEquipos" class="entrada entrada-mono" type="search" placeholder="Número de serie, marca o modelo" autocomplete="off" @input="buscarEquiposLibres">
        <div class="lista-opciones">
          <button
            v-for="disponible in equiposLibres" :key="disponible.id" type="button"
            class="opcion-persona" :aria-pressed="equipoElegido?.id === disponible.id" @click="equipoElegido = disponible"
          >
            <span class="avatar" aria-hidden="true"><Icono v-if="equipoElegido?.id !== disponible.id" nombre="inventario" :tamano="18" /><template v-else>✓</template></span>
            <span class="celda-doble">
              <span class="serie">{{ disponible.numeroSerie }}</span>
              <span>{{ disponible.marca }} {{ disponible.modelo }} · {{ ETIQUETAS_TIPO[disponible.tipo] }}</span>
            </span>
          </button>
          <p v-if="!cargandoEquipos && equiposLibres.length === 0" class="campo-ayuda sin-datos">
            No hay equipos activos disponibles para asignar.
          </p>
        </div>
        <span class="campo-ayuda">Solo aparecen equipos activos que no están asignados.</span>
      </div>

      <div class="campo">
        <label for="observaciones-asignacion">Observaciones</label>
        <input id="observaciones-asignacion" v-model="observaciones" class="entrada" maxlength="255" placeholder="Ej. Se entrega con cable USB y cable de corriente">
      </div>

      <p v-if="error" class="aviso-error" role="alert">{{ error }}</p>

      <div class="dialogo-acciones">
        <span class="campo-ayuda pie">La fecha y hora se registran solas.</span>
        <button type="button" class="boton boton-secundario" @click="emit('cerrar')">Cancelar</button>
        <button type="submit" class="boton boton-primario" :disabled="!listo || enviando">
          {{ enviando ? "Asignando…" : listo ? `Asignar a ${empleadoElegido!.nombre}` : "Elige a un empleado" }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.sin-datos { padding: 16px; margin: 0; }
.pie { margin-right: auto; align-self: center; }
</style>
