<script setup lang="ts">
import { ref } from "vue";
import { ErrorApi } from "../api/cliente";
import type { EquipoResumen, Mantenimiento } from "../api/equipos";
import { cancelarMantenimiento } from "../api/mantenimientos";
import { recargarAvisos } from "../composables/useAvisosMantenimiento";
import { fechaCorta } from "../utilidades/formato";
import DialogoConfirmar from "./DialogoConfirmar.vue";
import DialogoProgramarMantenimiento from "./DialogoProgramarMantenimiento.vue";
import DialogoRealizarMantenimiento from "./DialogoRealizarMantenimiento.vue";
import Icono from "./Icono.vue";

/**
 * Botones para un mantenimiento programado: registrarlo como realizado,
 * reprogramarlo o cancelarlo. Abre sus propios diálogos y avisa con
 * `actualizado` cuando algo cambió. Si ya está realizado o cancelado, no muestra nada.
 */
const props = withDefaults(
  defineProps<{
    mantenimiento: Mantenimiento;
    equipo: Pick<EquipoResumen, "id" | "numeroSerie" | "marca" | "modelo" | "tipo" | "estado">;
    /** Solo el botón principal (para listas estrechas como los avisos de Inicio). */
    compacto?: boolean;
  }>(),
  { compacto: false },
);
const emit = defineEmits<{ actualizado: [mensaje: string] }>();

const abierto = ref<"realizado" | "reprogramar" | "cancelar" | null>(null);
const cancelando = ref(false);
const errorCancelar = ref("");

async function terminar(mensaje: string) {
  abierto.value = null;
  emit("actualizado", mensaje);
  await recargarAvisos();
}

async function confirmarCancelacion() {
  cancelando.value = true;
  errorCancelar.value = "";
  try {
    await cancelarMantenimiento(props.mantenimiento.id);
    await terminar(`Mantenimiento de ${props.equipo.numeroSerie} cancelado.`);
  } catch (e) {
    errorCancelar.value = e instanceof ErrorApi ? e.message : "No se pudo cancelar el mantenimiento.";
  } finally {
    cancelando.value = false;
  }
}

function cerrarCancelacion() {
  abierto.value = null;
  errorCancelar.value = "";
}
</script>

<template>
  <div v-if="mantenimiento.estado === 'PROGRAMADO'" class="acciones" :class="{ compacto }">
    <button
      type="button" class="boton boton-secundario accion-realizado"
      :aria-label="`Marcar como realizado el mantenimiento de ${equipo.numeroSerie}`" @click="abierto = 'realizado'"
    >
      <Icono nombre="hecho" :tamano="18" :grosor="2" />{{ compacto ? "Realizado" : "Marcar realizado" }}
    </button>
    <template v-if="!compacto">
      <button type="button" class="boton-enlace accion-reprogramar" :aria-label="`Reprogramar el mantenimiento de ${equipo.numeroSerie}`" @click="abierto = 'reprogramar'">
        Reprogramar
      </button>
      <button type="button" class="boton-enlace accion-cancelar" :aria-label="`Cancelar el mantenimiento de ${equipo.numeroSerie}`" @click="abierto = 'cancelar'">
        Cancelar
      </button>
    </template>

    <DialogoRealizarMantenimiento
      v-if="abierto === 'realizado'" :mantenimiento="mantenimiento" :numero-serie="equipo.numeroSerie" :estado-equipo="equipo.estado"
      @guardado="terminar" @cerrar="abierto = null"
    />
    <DialogoProgramarMantenimiento
      v-if="abierto === 'reprogramar'" :mantenimiento="{ ...mantenimiento, equipo }"
      @guardado="terminar" @cerrar="abierto = null"
    />
    <DialogoConfirmar
      v-if="abierto === 'cancelar'"
      titulo="¿Cancelar este mantenimiento?"
      :mensaje="`El mantenimiento de ${equipo.numeroSerie} programado para el ${fechaCorta(mantenimiento.fechaProgramada)} se marcará como cancelado. Se conserva en el historial.`"
      texto-confirmar="Sí, cancelarlo" texto-volver="No, conservarlo"
      :enviando="cancelando" :error="errorCancelar"
      @confirmar="confirmarCancelacion" @cerrar="cerrarCancelacion"
    />
  </div>
</template>

<style scoped>
.acciones { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 16px; }
.accion-cancelar { color: var(--peligro); }
.compacto .boton { padding: 0 12px; font-size: 14px; }
</style>
