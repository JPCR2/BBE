import { createRouter, createWebHistory, type RouteLocationNormalized } from "vue-router";
import { cuandoSePierdaLaSesion } from "./api/cliente";
import { mostrarAviso } from "./composables/useAvisos";
import { destinoSeguro, establecerUsuario, revisarSesion, sesion } from "./composables/useSesion";
import AltaEquipoVista from "./vistas/AltaEquipoVista.vue";
import BajasVista from "./vistas/BajasVista.vue";
import EditarEquipoVista from "./vistas/EditarEquipoVista.vue";
import EmpleadosVista from "./vistas/EmpleadosVista.vue";
import FichaEquipoVista from "./vistas/FichaEquipoVista.vue";
import InicioVista from "./vistas/InicioVista.vue";
import InventarioVista from "./vistas/InventarioVista.vue";
import LoginVista from "./vistas/LoginVista.vue";
import MantenimientoVista from "./vistas/MantenimientoVista.vue";
import NoEncontradaVista from "./vistas/NoEncontradaVista.vue";
import NuevaBajaVista from "./vistas/NuevaBajaVista.vue";
import UsuariosVista from "./vistas/UsuariosVista.vue";

declare module "vue-router" {
  interface RouteMeta {
    titulo?: string;
    /** Se ve sin iniciar sesión (solo la pantalla de inicio de sesión). */
    publica?: boolean;
    soloAdmin?: boolean;
  }
}

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
    { path: "/usuarios", name: "usuarios", component: UsuariosVista, meta: { titulo: "Usuarios", soloAdmin: true } },
    { path: "/iniciar-sesion", name: "iniciar-sesion", component: LoginVista, meta: { titulo: "Iniciar sesión", publica: true } },
    { path: "/:ruta(.*)*", name: "no-encontrada", component: NoEncontradaVista, meta: { titulo: "Página no encontrada" } },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

export async function protegerRuta(destino: RouteLocationNormalized) {
  let usuario;
  try {
    usuario = await revisarSesion();
  } catch {
    // La API no responde: se muestra la pantalla de inicio de sesión con el aviso de conexión.
    usuario = null;
  }
  if (destino.meta.publica) return usuario ? destinoSeguro(destino.query.redirigir) : true;
  if (!usuario) {
    return { name: "iniciar-sesion", query: destino.fullPath === "/" ? {} : { redirigir: destino.fullPath } };
  }
  if (destino.meta.soloAdmin && usuario.rol !== "ADMIN") {
    mostrarAviso("Esa sección es solo para administradores.", "error");
    return { name: "inicio" };
  }
  return true;
}

router.beforeEach(protegerRuta);

// Si la sesión se pierde a mitad del trabajo, se vuelve a pedir el inicio de sesión.
cuandoSePierdaLaSesion(() => {
  if (!sesion.usuario) return;
  establecerUsuario(null);
  const actual = router.currentRoute.value;
  if (actual.meta.publica) return;
  mostrarAviso("Tu sesión terminó. Vuelve a iniciar sesión para continuar.", "error");
  router.push({ name: "iniciar-sesion", query: { redirigir: actual.fullPath } });
});

router.afterEach((destino) => {
  const titulo = typeof destino.meta.titulo === "string" ? destino.meta.titulo : "Inventario";
  document.title = `${titulo} · Inventario de equipos`;
});
