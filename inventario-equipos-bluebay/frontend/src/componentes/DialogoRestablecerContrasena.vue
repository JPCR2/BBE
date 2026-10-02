<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { ErrorApi } from "../api/cliente";
import { restablecerContrasena, type Usuario } from "../api/usuarios";
import { errorContrasenaNueva, MINIMO_CONTRASENA } from "../utilidades/contrasena";
import CampoContrasena from "./CampoContrasena.vue";
import Icono from "./Icono.vue";

/** Un administrador le pone una contraseña nueva a otro usuario (p. ej. si la olvidó o quedó bloqueado). */
const props = defineProps<{ usuario: Usuario }>();
const emit = defineEmits<{ cerrar: []; guardado: [usuario: Usuario] }>();

const dialogo = ref<HTMLDialogElement>();
const campo = ref<InstanceType<typeof CampoContrasena>>();
const contrasena = ref("");
const errorCampo = ref<string>();
const error = ref("");
const enviando = ref(false);

onMounted(() => {
  dialogo.value?.showModal();
  campo.value?.enfocar();
});
watch(contrasena, () => (errorCampo.value = undefined));

async function guardar() {
  if (enviando.value) return;
  error.value = "";
  errorCampo.value = errorContrasenaNueva(contrasena.value);
  if (errorCampo.value) return campo.value?.enfocar();
  enviando.value = true;
  try {
    emit("guardado", await restablecerContrasena(props.usuario.id, contrasena.value));
  } catch (e) {
    if (e instanceof ErrorApi && e.campos.contrasena) {
      errorCampo.value = e.campos.contrasena;
      campo.value?.enfocar();
    } else {
      error.value = e instanceof ErrorApi ? e.message : "No se pudo restablecer la contraseña.";
    }
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <dialog ref="dialogo" class="dialogo estrecho" aria-labelledby="titulo-restablecer" @close="emit('cerrar')" @cancel="emit('cerrar')">
    <form novalidate @submit.prevent="guardar">
      <div class="dialogo-encabezado">
        <h2 id="titulo-restablecer">Restablecer contraseña</h2>
        <button type="button" class="dialogo-cerrar" aria-label="Cerrar" @click="emit('cerrar')"><Icono nombre="cerrar" /></button>
      </div>
      <p class="mensaje">
        Nueva contraseña para <strong>{{ usuario.nombre }}</strong> (<span class="serie">{{ usuario.usuario }}</span>).
        Se le quitará el bloqueo, si lo tiene, y se cerrarán sus sesiones abiertas.
      </p>
      <CampoContrasena
        id="contrasena-restablecer" ref="campo" v-model="contrasena" etiqueta="Nueva contraseña *" autocomplete="new-password"
        :error="errorCampo" :ayuda="`Mínimo ${MINIMO_CONTRASENA} caracteres. Dásela en persona y pídele que la cambie desde su menú.`"
      />
      <p v-if="error" class="aviso-error" role="alert">{{ error }}</p>
      <div class="dialogo-acciones">
        <button type="button" class="boton boton-secundario" @click="emit('cerrar')">Cancelar</button>
        <button type="submit" class="boton boton-primario" :disabled="enviando">{{ enviando ? "Guardando…" : "Restablecer" }}</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.estrecho { width: min(500px, calc(100vw - 32px)); }
.mensaje { margin: 0; line-height: 1.5; }
</style>
