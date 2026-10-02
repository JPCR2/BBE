<script setup lang="ts">
import { ref } from "vue";
import Icono from "./Icono.vue";

/** Campo de contraseña con botón para mostrarla u ocultarla. */
defineProps<{ id: string; etiqueta: string; error?: string; ayuda?: string; autocomplete: "current-password" | "new-password" }>();
const valor = defineModel<string>({ required: true });
const visible = ref(false);
const entrada = ref<HTMLInputElement>();
defineExpose({ enfocar: () => entrada.value?.focus() });
</script>

<template>
  <div class="campo">
    <label :for="id">{{ etiqueta }}</label>
    <div class="con-boton">
      <input
        :id="id"
        ref="entrada"
        v-model="valor"
        class="entrada"
        :type="visible ? 'text' : 'password'"
        :autocomplete="autocomplete"
        maxlength="200"
        :aria-invalid="!!error"
        :aria-describedby="error ? `${id}-error` : ayuda ? `${id}-ayuda` : undefined"
      >
      <button
        type="button"
        class="ver"
        :aria-pressed="visible"
        :aria-label="visible ? 'Ocultar contraseña' : 'Mostrar contraseña'"
        :title="visible ? 'Ocultar contraseña' : 'Mostrar contraseña'"
        @click="visible = !visible"
      >
        <Icono :nombre="visible ? 'ojo-cerrado' : 'ojo'" />
      </button>
    </div>
    <span v-if="error" :id="`${id}-error`" class="campo-error">{{ error }}</span>
    <span v-else-if="ayuda" :id="`${id}-ayuda`" class="campo-ayuda">{{ ayuda }}</span>
  </div>
</template>

<style scoped>
.con-boton { position: relative; display: flex; }
.con-boton .entrada { flex: 1; padding-right: 52px; }
.ver {
  position: absolute; right: 2px; top: 50%; transform: translateY(-50%);
  width: 44px; height: 40px; display: flex; align-items: center; justify-content: center;
  border: 0; border-radius: var(--radio); background: transparent; color: var(--texto-2); cursor: pointer;
}
.ver:hover { color: var(--tinta); }
</style>
