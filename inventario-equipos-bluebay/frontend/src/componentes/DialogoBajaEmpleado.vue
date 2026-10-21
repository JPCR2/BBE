<script setup lang="ts">
import { nextTick, onMounted, reactive, ref, watch } from "vue";
import { ErrorApi } from "../api/cliente";
import { darDeBajaEmpleado, ETIQUETAS_MOTIVO_SALIDA, type FichaEmpleado, type MotivoSalida } from "../api/empleados";
import { hoyEnElHotel, nombreCompleto } from "../utilidades/formato";
import Icono from "./Icono.vue";

/** Renuncia, despido…: registra la salida y borra los datos personales. */
const props = defineProps<{ empleado: FichaEmpleado }>();
const emit = defineEmits<{ cerrar: []; guardado: [ficha: FichaEmpleado] }>();

const hoy = hoyEnElHotel();
const dialogo = ref<HTMLDialogElement>();
const formulario = ref<HTMLFormElement>();
const datos = reactive({ fechaSalida: hoy, motivo: "" as MotivoSalida | "", observaciones: "" });
const errores = ref<Record<string, string | undefined>>({});
const error = ref("");
const enviando = ref(false);
const nombre = nombreCompleto(props.empleado);

onMounted(() => {
  dialogo.value?.showModal();
  formulario.value?.querySelector<HTMLElement>("#motivo-salida")?.focus();
});
for (const campo of ["fechaSalida", "motivo", "observaciones"] as const) watch(() => datos[campo], () => delete errores.value[campo]);

async function enfocarPrimerError() {
  await nextTick();
  formulario.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}

async function guardar() {
  if (enviando.value) return;
  error.value = "";
  const e: Record<string, string> = {};
  if (datos.motivo === "") e.motivo = "Elige el motivo de la salida.";
  if (datos.fechaSalida === "") e.fechaSalida = "Elige la fecha de salida.";
  else if (datos.fechaSalida > hoy) e.fechaSalida = "La fecha de salida no puede ser futura.";
  if (datos.observaciones.trim().length > 255) e.observaciones = "Máximo 255 caracteres.";
  errores.value = e;
  if (Object.keys(e).length > 0) return enfocarPrimerError();

  enviando.value = true;
  try {
    const ficha = await darDeBajaEmpleado(props.empleado.id, {
      fechaSalida: datos.fechaSalida, motivo: datos.motivo as MotivoSalida, observaciones: datos.observaciones,
    });
    emit("guardado", ficha);
  } catch (err) {
    if (err instanceof ErrorApi && Object.keys(err.campos).some((c) => c !== "_")) {
      errores.value = { ...err.campos };
      await enfocarPrimerError();
    } else {
      error.value = err instanceof ErrorApi ? err.message : "No se pudo dar de baja al empleado.";
    }
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <dialog ref="dialogo" class="dialogo" aria-labelledby="titulo-baja-empleado" @close="emit('cerrar')" @cancel="emit('cerrar')">
    <form ref="formulario" novalidate @submit.prevent="guardar">
      <div class="dialogo-encabezado">
        <h2 id="titulo-baja-empleado">Dar de baja a {{ nombre }}</h2>
        <button type="button" class="dialogo-cerrar" aria-label="Cerrar" @click="emit('cerrar')"><Icono nombre="cerrar" /></button>
      </div>

      <div class="advertencia" role="note">
        <strong>Esta acción no se puede deshacer.</strong>
        <ul>
          <li>Se <strong>borran</strong> su nombre, apellidos y número de empleado: quedará como «Ex empleado #{{ empleado.id }}».</li>
          <li>Se <strong>conservan</strong> su puesto, departamento, la fecha y el motivo de salida, y el historial de equipos que tuvo.</li>
          <li>Si regresa al hotel, se registra como empleado nuevo.</li>
        </ul>
      </div>

      <div class="fila">
        <div class="campo">
          <label for="motivo-salida">Motivo *</label>
          <select id="motivo-salida" v-model="datos.motivo" class="entrada" :aria-invalid="!!errores.motivo" :aria-describedby="errores.motivo ? 'error-motivo-salida' : undefined">
            <option value="">Elige el motivo</option>
            <option v-for="(etiqueta, valor) in ETIQUETAS_MOTIVO_SALIDA" :key="valor" :value="valor">{{ etiqueta }}</option>
          </select>
          <span v-if="errores.motivo" id="error-motivo-salida" class="campo-error">{{ errores.motivo }}</span>
        </div>
        <div class="campo">
          <label for="fecha-salida">Fecha de salida *</label>
          <input id="fecha-salida" v-model="datos.fechaSalida" type="date" class="entrada" :max="hoy" :aria-invalid="!!errores.fechaSalida" :aria-describedby="errores.fechaSalida ? 'error-fecha-salida' : undefined">
          <span v-if="errores.fechaSalida" id="error-fecha-salida" class="campo-error">{{ errores.fechaSalida }}</span>
        </div>
      </div>

      <div class="campo">
        <label for="observaciones-salida">Observaciones</label>
        <textarea id="observaciones-salida" v-model="datos.observaciones" class="entrada" rows="2" maxlength="255" placeholder="Opcional. Sin datos personales (p. ej. «Se cambió de ciudad»)." :aria-invalid="!!errores.observaciones" />
        <span v-if="errores.observaciones" class="campo-error">{{ errores.observaciones }}</span>
      </div>

      <p v-if="error" class="aviso-error" role="alert">{{ error }}</p>
      <div class="dialogo-acciones">
        <button type="button" class="boton boton-secundario" @click="emit('cerrar')">Cancelar</button>
        <button type="submit" class="boton boton-peligro-solido" :disabled="enviando">{{ enviando ? "Guardando…" : "Dar de baja" }}</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.advertencia {
  padding: 12px 16px; border-radius: var(--radio);
  background: var(--peligro-fondo); border: 1px solid #F0C9B8; color: var(--tinta); font-size: 14px;
}
.advertencia > strong { color: var(--peligro); }
.advertencia ul { margin: 6px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.fila { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
textarea.entrada { resize: vertical; min-height: 64px; padding-top: 10px; font: inherit; }
@media (max-width: 560px) { .fila { grid-template-columns: 1fr; } }
</style>
