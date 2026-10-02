import { createRouter, createWebHistory } from "vue-router";
import AltaEquipoVista from "./vistas/AltaEquipoVista.vue";
import BajasVista from "./vistas/BajasVista.vue";
import EditarEquipoVista from "./vistas/EditarEquipoVista.vue";
import EmpleadosVista from "./vistas/EmpleadosVista.vue";
import FichaEquipoVista from "./vistas/FichaEquipoVista.vue";
import InicioVista from "./vistas/InicioVista.vue";
import InventarioVista from "./vistas/InventarioVista.vue";
import MantenimientoVista from "./vistas/MantenimientoVista.vue";
import NoEncontradaVista from "./vistas/NoEncontradaVista.vue";
import NuevaBajaVista from "./vistas/NuevaBajaVista.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "inicio", component: InicioVista, meta: { titulo: "Inicio" } },
    { path: "/inventario", name: "inventario", component: InventarioVista, meta: { titulo: "Inventario" } },
    { path: "/inventario/nuevo", name: "alta-equipo", component: AltaEquipoVista, meta: { titulo: "Registrar equipo" } },
    { path: "/inventario/:id(\\d+)", name: "ficha-equipo", component: FichaEquipoVista, props: true, meta: { titulo: "Ficha del equipo" } },
    { path: "/inventario/:id(\\d+)/editar", name: "editar-equipo", component: EditarEquipoVista, props: true, meta: { titulo: "Editar equipo" } },
    { path: "/empleados", name: "empleados", component: EmpleadosVista, meta: { titulo: "Empleados" } },
    { path: "/mantenimiento", name: "mantenimiento", component: MantenimientoVista, meta: { titulo: "Mantenimiento" } },
    { path: "/bajas", name: "bajas", component: BajasVista, meta: { titulo: "Bajas" } },
    { path: "/bajas/nueva", name: "nueva-baja", component: NuevaBajaVista, meta: { titulo: "Registrar baja" } },
    { path: "/:ruta(.*)*", name: "no-encontrada", component: NoEncontradaVista, meta: { titulo: "Página no encontrada" } },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

router.afterEach((destino) => {
  const titulo = typeof destino.meta.titulo === "string" ? destino.meta.titulo : "Inventario";
  document.title = `${titulo} · Inventario de equipos`;
});
