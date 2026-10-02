<script setup lang="ts">
import type { EstadoEquipo } from "../api/equipos";
import { ETIQUETAS_ESTADO, VARIANTE_ESTADO } from "../utilidades/formato";

defineProps<{ estado: EstadoEquipo }>();
</script>

<template>
  <span class="insignia" :class="`insignia-${VARIANTE_ESTADO[estado]}`">{{ ETIQUETAS_ESTADO[estado] }}</span>
</template>
