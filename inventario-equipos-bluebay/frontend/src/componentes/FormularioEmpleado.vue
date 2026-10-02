<script setup lang="ts">
import { nextTick, reactive, ref, watch } from "vue";
import type { Departamento, DatosEmpleado } from "../api/empleados";

const props = withDefaults(
  defineProps<{
    modo: "alta" | "edicion";
    departamentos: Departamento[];
    inicial?: Partial<DatosEmpleado>;
    erroresServidor?: Record<string, string>;
    enviando?: boolean;
  }>(),
  { inicial: () => ({}), erroresServidor: () => ({}), enviando: false },
);
const emit = defineEmits<{ enviar: [datos: DatosEmpleado]; cancelar: [] }>();

const vacio: DatosEmpleado = { numeroEmpleado: "", nombre: "", apellidos: "", puesto: "", departamentoId: "" };
const datos = reactive<DatosEmpleado>({ ...vacio, ...props.inicial });
const errores = ref<Record<string, string>>({});
const formulario = ref<HTMLFormElement>();

watch(() => props.erroresServidor, async (nuevos) => {
  errores.value = { ...nuevos };
  await enfocarPrimerError();
});

for (const campo of Object.keys(vacio) as (keyof DatosEmpleado)[]) {
  watch(() => datos[campo], () => {
    if (errores.value[campo]) {
      const { [campo]: _quitado, ...resto } = errores.value;
      errores.value = resto;
    }
  });
}

async function enfocarPrimerError() {
  await nextTick();
  formulario.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}

/** Mismos mensajes que la API. */
function validar(): Record<string, string> {
  const e: Record<string, string> = {};
  if (datos.numeroEmpleado.trim() === "") e.numeroEmpleado = "Escribe el número de empleado.";
  else if (datos.numeroEmpleado.trim().length > 20) e.numeroEmpleado = "Máximo 20 caracteres.";
  if (datos.nombre.trim() === "") e.nombre = "Escribe el nombre.";
  if (datos.apellidos.trim() === "") e.apellidos = "Escribe los apellidos.";
  if (datos.puesto.trim() === "") e.puesto = "Escribe el puesto.";
  if (datos.departamentoId === "") e.departamentoId = "Selecciona un departamento.";
  return e;
}

async function enviar() {
  errores.value = validar();
  if (Object.keys(errores.value).length > 0) return enfocarPrimerError();
  emit("enviar", { ...datos });
}
</script>

<template>
  <form ref="formulario" class="formulario-empleado" novalidate @submit.prevent="enviar">
    <h2>{{ modo === "alta" ? "Registrar empleado" : "Editar empleado" }}</h2>

    <div class="campo">
      <label for="numeroEmpleado">Número de empleado *</label>
      <input id="numeroEmpleado" v-model="datos.numeroEmpleado" class="entrada entrada-mono" :aria-invalid="!!errores.numeroEmpleado" autocomplete="off">
      <span v-if="errores.numeroEmpleado" class="campo-error">{{ errores.numeroEmpleado }}</span>
    </div>
    <div class="campo">
      <label for="nombreEmpleado">Nombre(s) *</label>
      <input id="nombreEmpleado" v-model="datos.nombre" class="entrada" :aria-invalid="!!errores.nombre">
      <span v-if="errores.nombre" class="campo-error">{{ errores.nombre }}</span>
    </div>
    <div class="campo">
      <label for="apellidosEmpleado">Apellidos *</label>
      <input id="apellidosEmpleado" v-model="datos.apellidos" class="entrada" :aria-invalid="!!errores.apellidos">
      <span v-if="errores.apellidos" class="campo-error">{{ errores.apellidos }}</span>
    </div>
    <div class="campo">
      <label for="puestoEmpleado">Puesto *</label>
      <input id="puestoEmpleado" v-model="datos.puesto" class="entrada" :aria-invalid="!!errores.puesto">
      <span v-if="errores.puesto" class="campo-error">{{ errores.puesto }}</span>
    </div>
    <div class="campo">
      <label for="departamentoEmpleado">Departamento *</label>
      <select id="departamentoEmpleado" v-model="datos.departamentoId" class="entrada" :aria-invalid="!!errores.departamentoId">
        <option value="">Selecciona un departamento</option>
        <option v-for="departamento in departamentos" :key="departamento.id" :value="departamento.id">{{ departamento.nombre }}</option>
      </select>
      <span v-if="errores.departamentoId" class="campo-error">{{ errores.departamentoId }}</span>
    </div>

    <p v-if="errores._" class="aviso-error" role="alert">{{ errores._ }}</p>

    <div class="acciones">
      <button type="button" class="boton boton-secundario" @click="emit('cancelar')">Cancelar</button>
      <button type="submit" class="boton boton-primario" :disabled="enviando">{{ enviando ? "Guardando…" : "Guardar empleado" }}</button>
    </div>
  </form>
</template>

<style scoped>
.formulario-empleado { display: flex; flex-direction: column; gap: 12px; }
.formulario-empleado h2 { margin: 0; font-size: 18px; font-weight: 700; }
.acciones { display: flex; justify-content: flex-end; gap: 10px; padding-top: 6px; }
</style>
