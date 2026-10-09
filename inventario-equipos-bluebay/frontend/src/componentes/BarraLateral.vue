<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import logoBlueBay from "../activos/logo-blue-bay.png";
import { esAdmin } from "../composables/useSesion";
import { modoDemo } from "../utilidades/modo";
import Icono, { type NombreIcono } from "./Icono.vue";

interface Seccion { nombre: string; ruta: string; icono: NombreIcono; disponible: boolean; soloAdmin?: boolean }

const todas: Seccion[] = [
  { nombre: "Inicio", ruta: "/", icono: "inicio", disponible: true },
  { nombre: "Inventario", ruta: "/inventario", icono: "inventario", disponible: true },
  { nombre: "Empleados", ruta: "/empleados", icono: "empleados", disponible: true },
  { nombre: "Mantenimiento", ruta: "/mantenimiento", icono: "calendario", disponible: true },
  { nombre: "Bajas", ruta: "/bajas", icono: "bajas", disponible: true },
  { nombre: "Usuarios", ruta: "/usuarios", icono: "llave", disponible: true, soloAdmin: true },
];
// Los técnicos no ven la sección de usuarios.
const secciones = computed(() => todas.filter((s) => !s.soloAdmin || esAdmin.value));

const ruta = useRoute();
const actual = computed(() => {
  const coincidencias = secciones.value.filter((s) => (s.ruta === "/" ? ruta.path === "/" : ruta.path.startsWith(s.ruta)));
  return coincidencias[0]?.ruta;
});
</script>

<template>
  <nav class="barra-lateral" aria-label="Navegación principal">
    <RouterLink to="/" class="marca">
      <img :src="logoBlueBay" alt="Blue Bay Grand Esmeralda" class="logo" width="360" height="137">
      <span>Sistemas · Equipos de cómputo</span>
      <span v-if="modoDemo" class="demo" title="Versión de demostración con datos ficticios">Demo · datos ficticios</span>
    </RouterLink>
    <ul class="secciones">
      <li v-for="seccion in secciones" :key="seccion.ruta">
        <RouterLink
          v-if="seccion.disponible"
          :to="seccion.ruta"
          class="enlace"
          :class="{ activo: actual === seccion.ruta }"
          :aria-current="actual === seccion.ruta ? 'page' : undefined"
        >
          <Icono :nombre="seccion.icono" />{{ seccion.nombre }}
        </RouterLink>
        <span v-else class="enlace pendiente" aria-disabled="true">
          <Icono :nombre="seccion.icono" />{{ seccion.nombre }}<small>Próximamente</small>
        </span>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.barra-lateral {
  display: flex; flex-direction: column; gap: 28px;
  min-height: 100vh; padding: 24px 16px;
  background: var(--lateral); color: #E8EEF2;
  position: sticky; top: 0; align-self: start;
}
.marca {
  display: flex; flex-direction: column; gap: 10px; padding: 4px 8px 0;
  text-decoration: none; color: inherit;
}
.logo { width: 100%; max-width: 196px; height: auto; }
.marca span { font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--lateral-tenue); }
.marca .demo { align-self: flex-start; padding: 2px 8px; border-radius: 10px; background: var(--alerta-fondo); color: var(--alerta); letter-spacing: 0.04em; }
.secciones { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.enlace {
  display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 12px;
  border-radius: var(--radio); color: var(--lateral-texto); text-decoration: none; font-size: 15px; font-weight: 500;
}
a.enlace:hover { background: #16334A; color: #FFFFFF; }
.enlace.activo { background: var(--lateral-activo); color: #FFFFFF; font-weight: 600; }
.enlace.pendiente { color: #7F97A8; cursor: default; }
.enlace small { margin-left: auto; font-size: 11px; color: #7F97A8; }
.enlace:focus-visible { outline-color: #FFFFFF; }

@media (max-width: 900px) {
  .barra-lateral { min-height: auto; position: static; flex-direction: row; align-items: center; gap: 16px; padding: 12px 16px; overflow-x: auto; }
  .marca { flex-direction: row; align-items: center; gap: 10px; padding: 0; }
  .marca .logo { width: 120px; }
  .marca span { display: none; }
  .secciones { flex-direction: row; }
  .enlace small { display: none; }
}
</style>
