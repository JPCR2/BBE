import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Encabezado from "../src/componentes/Encabezado.vue";
import InicioVista from "../src/vistas/InicioVista.vue";
import InventarioVista from "../src/vistas/InventarioVista.vue";
import MantenimientoVista from "../src/vistas/MantenimientoVista.vue";
import { crearRouterDePrueba, equipoDemo, mantenimientoDemo, simularApi, sinAvisos } from "./ayudantes";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close ??= function () { this.removeAttribute("open"); };
});
// "Hoy" en el hotel: martes 22 de septiembre de 2026.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-22T16:30:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const vencido = mantenimientoDemo(1, "2026-09-17", { situacion: "VENCIDO", diasRestantes: -5 });
const deHoy = mantenimientoDemo(2, "2026-09-22", { situacion: "PROXIMO", diasRestantes: 0, descripcion: "Actualizar sistema operativo", equipo: { ...mantenimientoDemo(0, "").equipo, id: 2, numeroSerie: "DEMO-SN-0002" } });
const realizado = mantenimientoDemo(3, "2026-09-03", { estado: "REALIZADO", situacion: "REALIZADO", diasRestantes: null, fechaProgramada: null, fechaRealizacion: "2026-09-03", tipo: "CORRECTIVO", descripcion: "Cambio de teclado" });

async function montar(componente: unknown, ruta: string, responder: Parameters<typeof simularApi>[0], opciones?: { avisos?: boolean }) {
  const llamadas = simularApi(responder, opciones);
  const router = crearRouterDePrueba();
  router.push(ruta);
  await router.isReady();
  const envoltura = mount(componente as never, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return { envoltura, router, llamadas };
}

const calendario = (datos: unknown[], mes = "2026-09") => ({ cuerpo: { mes, hoy: "2026-09-22", datos } });

// =============================================================================
describe("MantenimientoVista · calendario", () => {
  it("coloca cada mantenimiento en su día y muestra hoy seleccionado", async () => {
    const { envoltura, llamadas } = await montar(MantenimientoVista, "/mantenimiento", () => calendario([realizado, vencido, deHoy]));
    expect(llamadas[0]!.url).toBe("/api/mantenimientos/calendario?mes=2026-09");
    expect(envoltura.find(".nombre-mes").text()).toBe("Septiembre de 2026");

    const dia17 = envoltura.find("[aria-label^='jueves 17 de septiembre']");
    expect(dia17.attributes("aria-label")).toBe("jueves 17 de septiembre, 1 mantenimiento");
    expect(dia17.find(".marca-peligro").text()).toBe("DEMO-SN-0001");
    expect(envoltura.find("[aria-label^='jueves 3 de septiembre'] .marca-exito").exists()).toBe(true);

    const hoy = envoltura.find(".dia.hoy");
    expect(hoy.attributes("aria-label")).toBe("martes 22 de septiembre (hoy), 1 mantenimiento");
    expect(hoy.attributes("aria-pressed")).toBe("true");
    expect(envoltura.find("#titulo-dia").text()).toContain("Martes 22 de septiembre");
    expect(envoltura.find(".dia-elegido").text()).toContain("Actualizar sistema operativo");
    expect(envoltura.find(".dia-elegido").text()).toContain("Hoy");
  });

  it("al elegir otro día muestra sus mantenimientos y sus acciones", async () => {
    const { envoltura, router } = await montar(MantenimientoVista, "/mantenimiento", () => calendario([realizado, vencido, deHoy]));
    await envoltura.find("[aria-label^='jueves 17 de septiembre']").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ dia: "2026-09-17" });
    const panel = envoltura.find(".dia-elegido");
    expect(panel.text()).toContain("Vencido hace 5 días");
    expect(panel.find(".accion-realizado").exists()).toBe(true);

    await envoltura.find("[aria-label^='jueves 3 de septiembre']").trigger("click");
    await flushPromises();
    expect(envoltura.find(".dia-elegido").text()).toContain("Realizado el 03/09/2026");
    expect(envoltura.find(".dia-elegido .accion-realizado").exists()).toBe(false);
  });

  it("un día futuro sin nada ofrece programar para ese día", async () => {
    const { envoltura } = await montar(MantenimientoVista, "/mantenimiento?dia=2026-09-30", () => calendario([]));
    expect(envoltura.find(".dia-elegido").text()).toContain("No hay mantenimientos este día.");
    await envoltura.find(".dia-elegido button").trigger("click");
    expect((document.querySelector("#fecha-mantenimiento") as HTMLInputElement).value).toBe("2026-09-30");
  });

  it("un día pasado sin nada no ofrece programar", async () => {
    const { envoltura } = await montar(MantenimientoVista, "/mantenimiento?dia=2026-09-10", () => calendario([]));
    expect(envoltura.find(".dia-elegido button").exists()).toBe(false);
  });

  it("cambia de mes con las flechas y regresa a hoy", async () => {
    const { envoltura, router, llamadas } = await montar(MantenimientoVista, "/mantenimiento", (url) =>
      calendario([], new URL(url, "http://x").searchParams.get("mes")!),
    );
    await envoltura.find("[aria-label='Mes siguiente']").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ mes: "2026-10" });
    expect(llamadas.at(-1)!.url).toBe("/api/mantenimientos/calendario?mes=2026-10");
    expect(envoltura.find(".nombre-mes").text()).toBe("Octubre de 2026");

    await envoltura.findAll(".barra-mes .boton").at(-1)!.trigger("click"); // Hoy
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({});
    expect(envoltura.find(".nombre-mes").text()).toBe("Septiembre de 2026");
  });

  it("muestra lo de los días del mes siguiente que se ven en la cuadrícula", async () => {
    const deOctubre = mantenimientoDemo(4, "2026-10-01", { situacion: "PROGRAMADO", diasRestantes: 9 });
    const { envoltura } = await montar(MantenimientoVista, "/mantenimiento", () => calendario([deHoy, deOctubre]));
    const dia1 = envoltura.find("[aria-label^='jueves 1 de octubre']");
    expect(dia1.attributes("aria-label")).toBe("jueves 1 de octubre, 1 mantenimiento");
    expect(dia1.text()).toContain("DEMO-SN-0001");
  });

  it("en otro mes elige el primer día con mantenimientos de ese mes, no del vecino", async () => {
    const finDeSeptiembre = mantenimientoDemo(5, "2026-09-28", { situacion: "PROGRAMADO", diasRestantes: 6, descripcion: "Del mes anterior" });
    const deOctubre = mantenimientoDemo(6, "2026-10-14", { situacion: "PROGRAMADO", diasRestantes: 22, descripcion: "Revisión de octubre" });
    const { envoltura } = await montar(MantenimientoVista, "/mantenimiento?mes=2026-10", () => calendario([finDeSeptiembre, deOctubre], "2026-10"));
    expect(envoltura.find("#titulo-dia").text()).toContain("Miércoles 14 de octubre");
    expect(envoltura.find(".dia-elegido").text()).toContain("Revisión de octubre");
  });

  it("ignora un mes inválido en la dirección y muestra el actual", async () => {
    const { envoltura, llamadas } = await montar(MantenimientoVista, "/mantenimiento?mes=2026-13", () => calendario([]));
    expect(llamadas[0]!.url).toBe("/api/mantenimientos/calendario?mes=2026-09");
    expect(envoltura.find(".nombre-mes").text()).toBe("Septiembre de 2026");
  });

  it("si la API falla, lo dice y permite reintentar", async () => {
    let intentos = 0;
    const { envoltura } = await montar(MantenimientoVista, "/mantenimiento", () =>
      ++intentos === 1 ? { estado: 500, cuerpo: { error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado en el servidor." } } } : calendario([vencido]),
    );
    expect(envoltura.find(".aviso-error").text()).toContain("Ocurrió un error inesperado en el servidor.");
    await envoltura.find(".aviso-error button").trigger("click");
    await flushPromises();
    expect(envoltura.find(".aviso-error").exists()).toBe(false);
    expect(envoltura.find(".marca-peligro").exists()).toBe(true);
  });
});

// =============================================================================
describe("MantenimientoVista · historial", () => {
  const listado = (datos: unknown[]) => ({ cuerpo: { datos, total: datos.length, pagina: 1, porPagina: 20 } });

  it("la pestaña Historial lista los mantenimientos con su situación", async () => {
    const { envoltura, router, llamadas } = await montar(MantenimientoVista, "/mantenimiento", (url) =>
      url.includes("/calendario") ? calendario([]) : listado([vencido, realizado]),
    );
    await envoltura.find("#pestana-historial").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ vista: "historial" });
    expect(llamadas.at(-1)!.url).toBe("/api/mantenimientos?pagina=1&porPagina=20");
    const filas = envoltura.findAll("tbody tr");
    expect(filas).toHaveLength(2);
    expect(filas[0]!.text()).toContain("Vencido");
    expect(filas[0]!.text()).toContain("Vencido hace 5 días");
    expect(filas[1]!.text()).toContain("Correctivo");
    expect(filas[1]!.find(".accion-realizado").exists()).toBe(false);
    expect(envoltura.find("#pestana-historial").attributes("aria-selected")).toBe("true");
  });

  it("filtrar por estado cambia la dirección y vuelve a consultar", async () => {
    const { envoltura, router, llamadas } = await montar(MantenimientoVista, "/mantenimiento?vista=historial", () => listado([]));
    await envoltura.find("select[aria-label=Estado]").setValue("REALIZADO");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ vista: "historial", estado: "REALIZADO" });
    expect(llamadas.at(-1)!.url).toContain("estado=REALIZADO");
    expect(envoltura.text()).toContain("No hay mantenimientos con esos filtros.");
    await envoltura.find(".estado-vacio button").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ vista: "historial" });
  });
});

// =============================================================================
describe("Avisos de mantenimiento en Inicio, en la campana y en el inventario", () => {
  const avisos = { ...sinAvisos, total: 2, vencidos: [vencido], proximos: [deHoy] };
  const resumen = { cuerpo: { equipos: 6, asignados: 4, sinAsignar: 2, enMantenimiento: 1 } };

  it("Inicio separa vencidos y próximos, con acceso directo a registrar", async () => {
    const { envoltura } = await montar(InicioVista, "/", (url) => (url.includes("/avisos") ? { cuerpo: avisos } : resumen), { avisos: true });
    const tarjeta = envoltura.find(".avisos");
    const grupos = tarjeta.findAll(".grupo-avisos");
    expect(grupos.map((g) => g.find("h3").text())).toEqual(["Vencidos 1", "Próximos 7 días 1"]);
    expect(grupos[0]!.text()).toContain("DEMO-SN-0001");
    expect(grupos[0]!.text()).toContain("Vencido hace 5 días");
    expect(grupos[1]!.text()).toContain("Hoy");
    expect(tarjeta.findAll(".accion-realizado")).toHaveLength(2);
  });

  it("Inicio dice «Todo al día» cuando no hay pendientes", async () => {
    const { envoltura } = await montar(InicioVista, "/", (url) => (url.includes("/avisos") ? { cuerpo: sinAvisos } : resumen), { avisos: true });
    expect(envoltura.find(".avisos").text()).toContain("Todo al día");
    expect(envoltura.find(".avisos").text()).toContain("No hay mantenimientos vencidos ni programados para los próximos 7 días.");
  });

  it("la campana muestra cuántos avisos hay y lleva a Mantenimiento", async () => {
    const { envoltura } = await montar(Encabezado, "/", () => ({ cuerpo: avisos }), { avisos: true });
    const campana = envoltura.find(".campana");
    expect(campana.find(".contador").text()).toBe("2");
    expect(campana.classes()).toContain("urgente");
    expect(campana.attributes("aria-label")).toBe("Mantenimiento: 1 vencidos y 1 próximos");
    expect(campana.attributes("href")).toBe("/mantenimiento");
  });

  it("la campana no muestra contador si todo está al día", async () => {
    const { envoltura } = await montar(Encabezado, "/", () => ({ cuerpo: sinAvisos }), { avisos: true });
    expect(envoltura.find(".contador").exists()).toBe(false);
    expect(envoltura.find(".campana").attributes("aria-label")).toBe("Mantenimiento: sin avisos pendientes");
  });

  it("el inventario muestra el aviso bajo el estado del equipo", async () => {
    const { envoltura } = await montar(InventarioVista, "/inventario", () => ({
      cuerpo: {
        datos: [
          { ...equipoDemo(1, "DEMO-SN-0001"), avisoMantenimiento: { situacion: "VENCIDO", fecha: "2026-09-17" } },
          { ...equipoDemo(2, "DEMO-SN-0002"), avisoMantenimiento: { situacion: "PROXIMO", fecha: "2026-09-22" } },
          { ...equipoDemo(3, "DEMO-SN-0003"), avisoMantenimiento: { situacion: "PROXIMO", fecha: "2026-09-25" } },
          { ...equipoDemo(4, "DEMO-SN-0004"), avisoMantenimiento: null },
          { ...equipoDemo(5, "DEMO-SN-0005"), avisoMantenimiento: { situacion: "PROXIMO", fecha: "2026-09-23" } },
        ],
        total: 5, pagina: 1, porPagina: 20, conteos: { todos: 4, asignados: 4, libres: 0, mantenimiento: 0 },
      },
    }));
    const avisosFila = envoltura.findAll("tbody tr").map((fila) => fila.find(".aviso-mantenimiento"));
    expect(avisosFila[0]!.text()).toBe("Mantenimiento vencido");
    expect(avisosFila[0]!.classes()).toContain("vencido");
    expect(avisosFila[1]!.text()).toBe("Mantenimiento hoy");
    expect(avisosFila[2]!.text()).toBe("Mantenimiento el 25/09/2026");
    expect(avisosFila[3]!.exists()).toBe(false);
    expect(avisosFila[4]!.text()).toBe("Mantenimiento mañana");
  });
});
