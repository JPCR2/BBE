<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { cambiarContrasena } from "../api/autenticacion";
import { ErrorApi } from "../api/cliente";
import { mostrarAviso } from "../composables/useAvisos";
import { errorContrasenaNueva, MINIMO_CONTRASENA } from "../utilidades/contrasena";
import CampoContrasena from "./CampoContrasena.vue";
import Icono from "./Icono.vue";

const emit = defineEmits<{ cerrar: [] }>();
const dialogo = ref<HTMLDialogElement>();
const campoActual = ref<InstanceType<typeof CampoContrasena>>();
const campoNueva = ref<InstanceType<typeof CampoContrasena>>();
const campoConfirmar = ref<InstanceType<typeof CampoContrasena>>();

const datos = reactive({ actual: "", nueva: "", confirmar: "" });
const errores = ref<Partial<Record<keyof typeof datos, string>>>({});
const error = ref("");
const enviando = ref(false);

onMounted(() => {
  dialogo.value?.showModal();
  campoActual.value?.enfocar();
});
for (const campo of ["actual", "nueva", "confirmar"] as const) watch(() => datos[campo], () => delete errores.value[campo]);

function enfocarPrimerError() {
  if (errores.value.actual) campoActual.value?.enfocar();
  else if (errores.value.nueva) campoNueva.value?.enfocar();
  else if (errores.value.confirmar) campoConfirmar.value?.enfocar();
}

async function guardar() {
  if (enviando.value) return;
  error.value = "";
  const e: typeof errores.value = {};
  if (datos.actual === "") e.actual = "Escribe tu contraseña actual.";
  const nueva = errorContrasenaNueva(datos.nueva);
  if (nueva) e.nueva = nueva;
  else if (datos.nueva === datos.actual) e.nueva = "La nueva contraseña debe ser distinta de la actual.";
  if (!e.nueva && datos.confirmar !== datos.nueva) e.confirmar = "No coincide con la nueva contraseña.";
  errores.value = e;
  if (Object.keys(e).length > 0) return enfocarPrimerError();

  enviando.value = true;
  try {
    await cambiarContrasena(datos.actual, datos.nueva);
    mostrarAviso("Contraseña cambiada. Si tenías la sesión abierta en otra computadora, ahí se cerró.");
    emit("cerrar");
  } catch (err) {
    if (err instanceof ErrorApi && err.codigo === "DATOS_INVALIDOS") {
      errores.value = { actual: err.campos.contrasenaActual, nueva: err.campos.contrasenaNueva };
      enfocarPrimerError();
    } else {
      error.value = err instanceof ErrorApi ? err.message : "No se pudo cambiar la contraseña.";
    }
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <dialog ref="dialogo" class="dialogo estrecho" aria-labelledby="titulo-cambiar-contrasena" @close="emit('cerrar')" @cancel="emit('cerrar')">
    <form novalidate @submit.prevent="guardar">
      <div class="dialogo-encabezado">
        <h2 id="titulo-cambiar-contrasena">Cambiar mi contraseña</h2>
        <button type="button" class="dialogo-cerrar" aria-label="Cerrar" @click="emit('cerrar')"><Icono nombre="cerrar" /></button>
      </div>
      <CampoContrasena id="contrasena-actual" ref="campoActual" v-model="datos.actual" etiqueta="Contraseña actual" autocomplete="current-password" :error="errores.actual" />
      <CampoContrasena
        id="contrasena-nueva" ref="campoNueva" v-model="datos.nueva" etiqueta="Nueva contraseña" autocomplete="new-password"
        :error="errores.nueva" :ayuda="`Mínimo ${MINIMO_CONTRASENA} caracteres. Mejor una frase fácil de recordar.`"
      />
      <CampoContrasena id="contrasena-confirmar" ref="campoConfirmar" v-model="datos.confirmar" etiqueta="Repite la nueva contraseña" autocomplete="new-password" :error="errores.confirmar" />
      <p v-if="error" class="aviso-error" role="alert">{{ error }}</p>
      <div class="dialogo-acciones">
        <button type="button" class="boton boton-secundario" @click="emit('cerrar')">Cancelar</button>
        <button type="submit" class="boton boton-primario" :disabled="enviando">{{ enviando ? "Guardando…" : "Cambiar contraseña" }}</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.estrecho { width: min(480px, calc(100vw - 32px)); }
</style>
