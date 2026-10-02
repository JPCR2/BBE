import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import DialogoReporteAlta from "../src/componentes/DialogoReporteAlta.vue";
import FichaEquipoVista from "../src/vistas/FichaEquipoVista.vue";
import { crearRouterDePrueba, equipoDemo, simularApi } from "./ayudantes";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close ??= function () { this.removeAttribute("open"); };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const conFactura = (id: number, serie: string, folio: string | null) => ({ ...equipoDemo(id, serie), folioFactura: folio });
const listado = (datos: unknown[]) => ({ cuerpo: { datos, total: datos.length, pagina: 1, porPagina: 50, conteos: {} } });

// =============================================================================
describe("DialogoReporteAlta (varios equipos)", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));

  async function montar(responder: Parameters<typeof simularApi>[0]) {
    const llamadas = simularApi(responder);
    const abrir = vi.fn();
    vi.stubGlobal("open", abrir);
    const envoltura = mount(DialogoReporteAlta, { attachTo: document.body });
    return { envoltura, llamadas, abrir };
  }
  async function escribir(envoltura: Awaited<ReturnType<typeof montar>>["envoltura"], texto: string) {
    await envoltura.find("#buscar-reporte-alta").setValue(texto);
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
  }

  it("no deja generar sin elegir equipos", async () => {
    const { envoltura, llamadas } = await montar(() => listado([]));
    const boton = envoltura.find("button[type=submit]");
    expect(boton.text()).toBe("Elige al menos un equipo");
    expect(boton.attributes("disabled")).toBeDefined();
    expect(llamadas).toHaveLength(0);
  });

  it("busca por folio, marca todos los de la factura y abre el PDF con sus ids", async () => {
    const { envoltura, llamadas, abrir } = await montar(() =>
      listado([conFactura(1, "5CD1234XYZ", "FAC-A-10234"), conFactura(2, "MJ0ABCDE", "FAC-A-10234")]),
    );
    await escribir(envoltura, "FAC-A-10234");
    expect(llamadas[0]!.url).toContain("busqueda=FAC-A-10234");
    expect(envoltura.findAll(".fila:not(.todos)").map((f) => f.text())).toEqual([
      expect.stringContaining("Factura FAC-A-10234"),
      expect.stringContaining("Factura FAC-A-10234"),
    ]);

    await envoltura.find(".todos input").setValue(true);
    expect(envoltura.find(".elegidos").text()).toContain("2 equipos elegidos");
    const boton = envoltura.find("button[type=submit]");
    expect(boton.text()).toBe("Generar reporte (2)");
    await envoltura.find("form").trigger("submit");
    expect(abrir).toHaveBeenCalledWith("/api/reportes/alta?ids=1,2", "_blank", "noopener");
  });

  it("conserva lo elegido entre búsquedas y permite quitar uno", async () => {
    const { envoltura, abrir } = await montar((url) =>
      url.includes("busqueda=FAC-1") ? listado([conFactura(1, "SN-1", "FAC-1")]) : listado([conFactura(7, "SN-7", null)]),
    );
    await escribir(envoltura, "FAC-1");
    await envoltura.find(".fila:not(.todos) input").setValue(true);
    await escribir(envoltura, "SN-7");
    expect(envoltura.find(".fila:not(.todos)").text()).toContain("Factura sin registrar");
    await envoltura.find(".fila:not(.todos) input").setValue(true);
    expect(envoltura.findAll(".chip").map((c) => c.text())).toEqual(["SN-1", "SN-7"]);

    await envoltura.find("[aria-label='Quitar SN-1 del reporte']").trigger("click");
    await envoltura.find("form").trigger("submit");
    expect(abrir).toHaveBeenCalledWith("/api/reportes/alta?ids=7", "_blank", "noopener");
  });

  it("avisa cuando nada coincide", async () => {
    const { envoltura } = await montar(() => listado([]));
    await escribir(envoltura, "NO-EXISTE");
    expect(envoltura.text()).toContain("Ningún equipo coincide con «NO-EXISTE».");
  });

  it("no pasa del máximo de 100 equipos por reporte", async () => {
    const muchos = Array.from({ length: 50 }, (_, i) => conFactura(i + 1, `SN-${i + 1}`, "F"));
    const otros = Array.from({ length: 51 }, (_, i) => conFactura(i + 100, `SN-${i + 100}`, "G"));
    const { envoltura, abrir } = await montar((url) => listado(url.includes("busqueda=F&") ? muchos : otros));
    await escribir(envoltura, "F");
    await envoltura.find(".todos input").setValue(true);
    await escribir(envoltura, "G");
    await envoltura.find(".todos input").setValue(true);
    expect(envoltura.text()).toContain("Máximo 100 equipos por reporte.");
    expect(envoltura.find("button[type=submit]").attributes("disabled")).toBeDefined();
    await envoltura.find("form").trigger("submit");
    expect(abrir).not.toHaveBeenCalled();
  });
});

// =============================================================================
describe("Ficha del equipo · factura y garantía", () => {
  async function montarFicha(cambios: Record<string, unknown>) {
    simularApi(() => ({
      cuerpo: {
        ...equipoDemo(1, "5CD1234XYZ"), especificaciones: null, fechaAdquisicion: "2026-03-15", costo: "21500.00",
        folioFactura: null, fechaVencimientoGarantia: null, garantiaVigente: null,
        tiempoFuncionamiento: { anios: 0, meses: 6 }, creadoEn: "2026-03-15T15:00:00.000Z", asignaciones: [], mantenimientos: [],
        ...cambios,
      },
    }));
    const router = crearRouterDePrueba();
    router.push("/inventario/1");
    await router.isReady();
    const envoltura = mount(FichaEquipoVista, { props: { id: "1" }, global: { plugins: [router] } });
    await flushPromises();
    return envoltura;
  }

  it("muestra el folio y la garantía vigente, con el botón del reporte de alta", async () => {
    const ficha = await montarFicha({ folioFactura: "FAC-A-10234", fechaVencimientoGarantia: "2027-03-15", garantiaVigente: true });
    expect(ficha.text()).toContain("FAC-A-10234");
    expect(ficha.find(".garantia").text()).toBe("Vigente hasta el 15/03/2027");
    expect(ficha.find(".garantia .insignia").classes()).toContain("insignia-exito");
    const enlace = ficha.find("a.imprimir-alta");
    expect(enlace.attributes("href")).toBe("/api/reportes/alta?ids=1");
    expect(enlace.attributes("target")).toBe("_blank");
  });

  it("indica la garantía vencida", async () => {
    const ficha = await montarFicha({ fechaVencimientoGarantia: "2025-03-15", garantiaVigente: false });
    expect(ficha.find(".garantia").text()).toBe("Vencida desde el 15/03/2025");
  });

  it("un equipo antiguo sin datos dice «Sin registrar»", async () => {
    const ficha = await montarFicha({});
    const textos = ficha.findAll(".datos div").map((d) => d.text());
    expect(textos).toContain("Folio de facturaSin registrar");
    expect(textos).toContain("GarantíaSin registrar");
  });
});
