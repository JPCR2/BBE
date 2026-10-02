<script setup lang="ts">
import { avisos, cerrarAviso } from "../composables/useAvisos";
import Icono from "./Icono.vue";
</script>

<template>
  <div class="avisos" role="status" aria-live="polite">
    <div v-for="aviso in avisos" :key="aviso.id" class="aviso" :class="aviso.tipo">
      <Icono :nombre="aviso.tipo === 'exito' ? 'hecho' : 'cerrar'" :grosor="2.25" />
      <span>{{ aviso.texto }}</span>
      <button type="button" class="cerrar" aria-label="Cerrar aviso" @click="cerrarAviso(aviso.id)">
        <Icono nombre="cerrar" :tamano="18" :grosor="2" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.avisos { position: fixed; top: 88px; right: 40px; z-index: 50; display: flex; flex-direction: column; gap: 10px; }
.aviso {
  display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 16px;
  background: var(--tinta); color: #FFFFFF; border-radius: 10px; box-shadow: var(--sombra-flotante);
  font-weight: 500;
}
.aviso.exito > svg:first-child { color: #9FD8B4; }
.aviso.error > svg:first-child { color: #F4A58A; }
.cerrar {
  width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
  border: 0; border-radius: var(--radio); background: transparent; color: #FFFFFF; cursor: pointer;
}
.cerrar:focus-visible { outline-color: #FFFFFF; }
</style>
