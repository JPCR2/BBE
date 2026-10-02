<script setup lang="ts">
defineProps<{ titulo: string }>();
</script>

<template>
  <div class="estado-vacio">
    <strong>{{ titulo }}</strong>
    <p>Este módulo se construye en una de las siguientes partes del prototipo.</p>
    <RouterLink to="/" class="boton boton-secundario">Volver a Inicio</RouterLink>
  </div>
</template>
