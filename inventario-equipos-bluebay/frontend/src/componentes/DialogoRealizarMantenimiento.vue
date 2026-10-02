<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ErrorApi } from "../api/cliente";
import type { EstadoEquipo, Mantenimiento } from "../api/equipos";
import { registrarRealizado } from "../api/mantenimientos";
import { hoyEnElHotel } from "../utilidades/formato";
import { ETIQUETAS_TIPO_MANTENIMIENTO, textoPlazo } from "../utilidades/mantenimiento";
import Icono from "./Icono.vue";

const props = defineProps<{ mantenimiento: Mantenimiento; numeroSerie: string; estadoEquipo?: EstadoEquipo }>();
const emit = defineEmits<{ guardado: [mensaje: string]; cerrar: [] }>();

const hoy = hoyEnElHotel();
const dialogo = ref<HTMLDialogElement>();
const formulario = reactive({
  fechaRealizacion: hoy,
  responsable: props.mantenimiento.responsable ?? "",
  descripcion: props.mantenimiento.descripcion,
});
const errores = ref<Record<string, string>>({});
const errorGeneral = ref("");
const enviando = ref(false);

onMounted(() => dialogo.value?.showModal());

async function guardar() {
  const e: Record<string, string> = {};
  if (!formulario.fechaRealizacion) e.fechaRealizacion = "Elige la fecha en que se realizó.";
  else if (formulario.fechaRealizacion > hoy) e.fechaRealizacion = "La fecha de realización no puede ser futura.";
  if (formulario.descripcion.trim() === "") e.descripcion = "Describe qué se hizo.";
  errores.value = e;
  if (Object.keys(e).length > 0) return;

  enviando.value = true;
  errorGeneral.value = "";
  try {
    const descripcion = formulario.descripcion.trim();
    await registrarRealizado(props.mantenimiento.id, {
      fechaRealizacion: formulario.fechaRealizacion,
      responsable: formulario.responsable.trim(),
      ...(descripcion !== props.mantenimiento.descripcion ? { descripcion } : {}),
    });
    emit("guardado", `Mantenimiento de ${props.numeroSerie} registrado como realizado.`);
  } catch (err) {
    if (err instanceof ErrorApi) {
      errores.value = { ...err.campos };
      if (Object.keys(err.campos).length === 0) errorGeneral.value = err.message;
    } else {
      errorGeneral.value = "No se pudo registrar el mantenimiento.";
    }
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <dialog ref="dialogo" class="dialogo" aria-labelledby="titulo-realizado" @close="emit('cerrar')" @cancel="emit('cerrar')">
    <form novalidate @submit.prevent="guardar">
      <div class="dialogo-encabezado">
        <h2 id="titulo-realizado">Registrar como realizado</h2>
        <button type="button" class="dialogo-cerrar" aria-label="Cerrar" @click="emit('cerrar')"><Icono nombre="cerrar" /></button>
      </div>

      <div class="resumen-equipo">
        <Icono nombre="herramienta" :tamano="22" />
        <span class="celda-doble">
          <span><span class="serie">{{ numeroSerie }}</span> · {{ ETIQUETAS_TIPO_MANTENIMIENTO[mantenimiento.tipo] }}</span>
          <span>{{ textoPlazo(mantenimiento) }}</span>
        </span>
      </div>

      <div class="fila">
        <div class="campo">
          <label for="fecha-realizacion">Fecha en que se realizó *</label>
          <input
            id="fecha-realizacion" v-model="formulario.fechaRealizacion" class="entrada" type="date" :max="hoy"
            :aria-invalid="!!errores.fechaRealizacion" @input="errores.fechaRealizacion = ''"
          >
          <span v-if="errores.fechaRealizacion" class="campo-error">{{ errores.fechaRealizacion }}</span>
        </div>
        <div class="campo">
          <label for="responsable-realizado">¿Quién lo realizó?</label>
          <input id="responsable-realizado" v-model="formulario.responsable" class="entrada" maxlength="100" placeholder="Nombre de quien lo hizo">
        </div>
      </div>

      <div class="campo">
        <label for="descripcion-realizado">¿Qué se hizo? *</label>
        <textarea
          id="descripcion-realizado" v-model="formulario.descripcion" class="entrada" rows="3" maxlength="2000"
          :aria-invalid="!!errores.descripcion" @input="errores.descripcion = ''"
        />
        <span v-if="errores.descripcion" class="campo-error">{{ errores.descripcion }}</span>
        <span v-else class="campo-ayuda">Ajusta el texto si se hizo algo distinto a lo planeado.</span>
      </div>

      <p v-if="errorGeneral" class="aviso-error" role="alert">{{ errorGeneral }}</p>

      <div class="dialogo-acciones">
        <span v-if="estadoEquipo === 'EN_MANTENIMIENTO'" class="campo-ayuda pie">El equipo sigue «En mantenimiento»: cuando esté listo, regrésalo a Activo desde «Editar datos».</span>
        <span v-else class="pie" />        <button type="button" class="boton boton-secundario" @click="emit('cerrar')">Cancelar</button>
        <button type="submit" class="boton boton-primario" :disabled="enviando">{{ enviando ? "Guardando…" : "Registrar" }}</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.fila { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.pie { margin-right: auto; align-self: center; max-width: 260px; }
.dialogo-acciones { flex-wrap: wrap; }
@media (max-width: 600px) { .fila { grid-template-columns: 1fr; } }
</style>
