<script setup lang="ts">
import AvisosFlotantes from "./componentes/AvisosFlotantes.vue";
import BarraLateral from "./componentes/BarraLateral.vue";
import Encabezado from "./componentes/Encabezado.vue";
</script>

<template>
  <a href="#contenido" class="saltar">Saltar al contenido</a>
  <div class="marco">
    <BarraLateral />
    <div class="columna">
      <Encabezado />
      <main id="contenido" class="pagina" tabindex="-1">
        <RouterView />
      </main>
    </div>
  </div>
  <AvisosFlotantes />
</template>

<style>
.marco { display: grid; grid-template-columns: 248px minmax(0, 1fr); min-height: 100vh; }
.columna { display: flex; flex-direction: column; min-width: 0; }
.pagina { padding: 28px 40px 48px; outline: none; }
.saltar { position: absolute; left: 12px; top: -60px; z-index: 100; padding: 10px 14px; background: var(--primario); color: #FFFFFF; border-radius: var(--radio); }
.saltar:focus { top: 12px; color: #FFFFFF; }
@media (max-width: 900px) {
  .marco { grid-template-columns: 1fr; }
  .pagina { padding: 20px 16px 40px; }
}
</style>
