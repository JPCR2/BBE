<script setup lang="ts">
import { onMounted, ref } from "vue";
import { registrarDevolucion } from "../api/asignaciones";
import { ErrorApi } from "../api/cliente";
import type { EquipoResumen } from "../api/equipos";
import { nombreCompleto } from "../utilidades/formato";
import Icono from "./Icono.vue";

const props = defineProps<{ equipo: EquipoResumen }>();
const emit = defineEmits<{ devuelto: [mensaje: string]; cerrar: [] }>();

const dialogo = ref<HTMLDialogElement>();
const observaciones = ref("");
const error = ref("");
const enviando = ref(false);

onMounted(() => dialogo.value?.showModal());

async function confirmar() {
  const vigente = props.equipo.asignacionVigente;
  if (!vigente) return emit("cerrar");
  enviando.value = true;
  error.value = "";
  try {
    await registrarDevolucion(vigente.id, observaciones.value.trim() || undefined);
    emit("devuelto", `${props.equipo.numeroSerie} quedó disponible.`);
  } catch (e) {
    error.value = e instanceof ErrorApi ? e.message : "No se pudo registrar la devolución.";
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <dialog ref="dialogo" class="dialogo" aria-labelledby="titulo-devolucion" @close="emit('cerrar')" @cancel="emit('cerrar')">
    <form @submit.prevent="confirmar">
      <div class="dialogo-encabezado">
        <h2 id="titulo-devolucion">¿Registrar la devolución?</h2>
        <button type="button" class="dialogo-cerrar" aria-label="Cerrar" @click="emit('cerrar')"><Icono nombre="cerrar" /></button>
      </div>

      <p v-if="equipo.asignacionVigente" class="mensaje">
        {{ nombreCompleto(equipo.asignacionVigente.empleado) }} entrega el equipo
        <span class="serie">{{ equipo.numeroSerie }}</span> ({{ equipo.marca }} {{ equipo.modelo }}).
        Quedará disponible para asignarse a otra persona.
      </p>

      <div class="campo">
        <label for="observaciones-devolucion">Observaciones de la devolución</label>
        <input id="observaciones-devolucion" v-model="observaciones" class="entrada" maxlength="255" placeholder="Ej. Regresa con cargador; pantalla sin daños">
      </div>

      <p v-if="error" class="aviso-error" role="alert">{{ error }}</p>

      <div class="dialogo-acciones">
        <span class="campo-ayuda pie">La fecha y hora se registran solas.</span>
        <button type="button" class="boton boton-secundario" @click="emit('cerrar')">Cancelar</button>
        <button type="submit" class="boton boton-primario" :disabled="enviando">
          {{ enviando ? "Guardando…" : "Registrar devolución" }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.mensaje { margin: 0; line-height: 1.5; }
.pie { margin-right: auto; align-self: center; }
</style>
