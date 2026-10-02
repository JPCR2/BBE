<script setup lang="ts">
import { onMounted, ref } from "vue";
import Icono from "./Icono.vue";

withDefaults(defineProps<{
  titulo: string;
  mensaje: string;
  textoConfirmar?: string;
  textoVolver?: string;
  enviando?: boolean;
  error?: string;
  /** Acción que no se puede deshacer: el botón de confirmar va en rojo. */
  peligro?: boolean;
}>(), {
  textoConfirmar: "Confirmar",
  textoVolver: "Cancelar",
  enviando: false,
  error: "",
  peligro: false,
});
const emit = defineEmits<{ confirmar: []; cerrar: [] }>();
const dialogo = ref<HTMLDialogElement>();
onMounted(() => dialogo.value?.showModal());
</script>

<template>
  <dialog ref="dialogo" class="dialogo estrecho" aria-labelledby="titulo-confirmar" @close="emit('cerrar')" @cancel="emit('cerrar')">
    <form @submit.prevent="emit('confirmar')">
      <div class="dialogo-encabezado">
        <h2 id="titulo-confirmar">{{ titulo }}</h2>
        <button type="button" class="dialogo-cerrar" aria-label="Cerrar" @click="emit('cerrar')"><Icono nombre="cerrar" /></button>
      </div>
      <p class="mensaje">{{ mensaje }}</p>
      <p v-if="error" class="aviso-error" role="alert">{{ error }}</p>
      <div class="dialogo-acciones">
        <button type="button" class="boton boton-secundario" @click="emit('cerrar')">{{ textoVolver }}</button>
        <button type="submit" class="boton" :class="peligro ? 'boton-peligro-solido' : 'boton-primario'" :disabled="enviando">{{ enviando ? "Guardando…" : textoConfirmar }}</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.estrecho { width: min(480px, calc(100vw - 32px)); }
.mensaje { margin: 0; line-height: 1.5; }
</style>
