import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventarioVista from "../src/vistas/InventarioVista.vue";
import { crearRouterDePrueba, equipoDemo, simularApi } from "./ayudantes";

afterEach(() => vi.unstubAllGlobals());

async function montarEn(ruta: string) {
  const router = crearRouterDePrueba();
  router.push(ruta);
  await router.isReady();
  const envoltura = mount(InventarioVista, { global: { plugins: [router] } });
  await flushPromises();
  return { envoltura, router };
}

describe("InventarioVista", () => {
  it("muestra los equipos, a quién están asignados y los conteos de los filtros rápidos", async () => {
    simularApi(() => ({
      cuerpo: {
        datos: [equipoDemo(1, "DEMO-SN-0001"), equipoDemo(5, "DEMO-SN-0005", false)],
        total: 2, pagina: 1, porPagina: 20,
        conteos: { todos: 6, asignados: 4, libres: 2, mantenimiento: 1 },
      },
    }));
    const { envoltura } = await montarEn("/inventario");
    const filas = envoltura.findAll("tbody tr");
    expect(filas).toHaveLength(2);
    expect(filas[0]!.text()).toContain("Laura Méndez Cruz");
    expect(filas[1]!.text()).toContain("Sin asignar");
    const rapidos = envoltura.findAll(".rapido").map((b) => b.text());
    expect(rapidos).toEqual(["Todos6", "Asignados4", "Sin asignar2", "En mantenimiento1"]);
    expect(envoltura.text()).toContain("Mostrando 1–2 de 2 equipos");
  });

  it("un filtro rápido cambia la dirección y vuelve a consultar la API", async () => {
    const llamadas = simularApi(() => ({
      cuerpo: { datos: [], total: 0, pagina: 1, porPagina: 20, conteos: { todos: 0, asignados: 0, libres: 0, mantenimiento: 0 } },
    }));
    const { envoltura, router } = await montarEn("/inventario");
    await envoltura.findAll(".rapido")[2]!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ asignacion: "libres" });
    expect(llamadas.at(-1)!.url).toContain("asignacion=libres");
    expect(envoltura.find(".rapido.activo").text()).toContain("Sin asignar");
  });

  it("si no hay resultados ofrece quitar los filtros", async () => {
    simularApi(() => ({
      cuerpo: { datos: [], total: 0, pagina: 1, porPagina: 20, conteos: { todos: 6, asignados: 4, libres: 2, mantenimiento: 1 } },
    }));
    const { envoltura, router } = await montarEn("/inventario?busqueda=zzz");
    expect(envoltura.text()).toContain("No hay equipos con esos filtros.");
    await envoltura.find(".estado-vacio button").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("si la API no responde muestra el error y permite reintentar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const { envoltura } = await montarEn("/inventario");
    expect(envoltura.text()).toContain("No se pudo conectar con el servidor");
    expect(envoltura.find(".estado-vacio button").text()).toBe("Intentar de nuevo");
  });
});
