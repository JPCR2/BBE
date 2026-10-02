import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Encabezado from "../src/componentes/Encabezado.vue";
import { crearRouterDePrueba, equipoDemo, simularApi } from "./ayudantes";

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function montar() {
  const router = crearRouterDePrueba();
  router.push("/");
  await router.isReady();
  const envoltura = mount(Encabezado, { global: { plugins: [router] }, attachTo: document.body });
  return { envoltura, router };
}

describe("Encabezado · buscador global", () => {
  it("muestra resultados al escribir, tras una pausa corta", async () => {
    const llamadas = simularApi(() => ({ cuerpo: { datos: [equipoDemo(1, "DEMO-SN-0001")], total: 1, pagina: 1, porPagina: 5, conteos: {} } }));
    const { envoltura } = await montar();
    const entrada = envoltura.find("input");
    await entrada.trigger("focus");
    await entrada.setValue("demo");
    expect(llamadas).toHaveLength(0); // todavía no consulta: espera a que termine de escribir
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(llamadas[0]!.url).toContain("busqueda=demo");
    expect(envoltura.findAll("[role=option]")).toHaveLength(1);
    expect(entrada.attributes("aria-expanded")).toBe("true");
    envoltura.unmount();
  });

  it("con Enter abre la ficha si el número de serie coincide exactamente (lector de código de barras)", async () => {
    simularApi((url) =>
      url.includes("/equipos/serie/")
        ? { cuerpo: equipoDemo(7, "DEMO-SN-0007") }
        : { cuerpo: { datos: [], total: 0, pagina: 1, porPagina: 5, conteos: {} } },
    );
    const { envoltura, router } = await montar();
    const entrada = envoltura.find("input");
    await entrada.trigger("focus");
    await entrada.setValue("demo-sn-0007");
    await entrada.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/inventario/7");
    expect((entrada.element as HTMLInputElement).value).toBe("");
    envoltura.unmount();
  });

  it("con Enter y sin coincidencia exacta lleva al inventario filtrado", async () => {
    simularApi((url) =>
      url.includes("/equipos/serie/")
        ? { estado: 404, cuerpo: { error: { codigo: "NO_ENCONTRADO", mensaje: "No existe" } } }
        : { cuerpo: { datos: [], total: 0, pagina: 1, porPagina: 5, conteos: {} } },
    );
    const { envoltura, router } = await montar();
    const entrada = envoltura.find("input");
    await entrada.trigger("focus");
    await entrada.setValue("latitude");
    await entrada.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/inventario?busqueda=latitude");
    envoltura.unmount();
  });
});
