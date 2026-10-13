<template>
  <div class="estado-vacio">
    <!-- h1 para que los lectores de pantalla anuncien en qué página se está. -->
    <h1 class="titulo">Esta página no existe.</h1>
    <p>Revisa la dirección o regresa a Inicio.</p>
    <RouterLink to="/" class="boton boton-secundario">Volver a Inicio</RouterLink>
  </div>
</template>

<style scoped>
.titulo { margin: 0; font-size: 17px; font-weight: 700; }
</style>
