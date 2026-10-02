import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { avisos as avisosFlotantes } from "../src/composables/useAvisos";
import { articuloVacio, resumenRenglones, validarBaja } from "../src/utilidades/bajas";
import BajasVista from "../src/vistas/BajasVista.vue";
import FichaEquipoVista from "../src/vistas/FichaEquipoVista.vue";
import NuevaBajaVista from "../src/vistas/NuevaBajaVista.vue";
import { crearRouterDePrueba, equipoDemo, simularApi } from "./ayudantes";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close ??= function () { this.removeAttribute("open"); };
});
// "Hoy" en el hotel: martes 29 de septiembre de 2026.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-09-29T16:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  avisosFlotantes.splice(0);
  document.body.innerHTML = "";
});

const libre = (id: number, serie: string) => ({ ...equipoDemo(id, serie, false), folioFactura: null, baja: null });
const asignado = (id: number, serie: string) => ({ ...equipoDemo(id, serie, true), folioFactura: null, baja: null });
const listado = (datos: unknown[]) => ({ cuerpo: { datos, total: datos.length, pagina: 1, porPagina: 20, conteos: {} } });

const bajaDemo = (cambios: Record<string, unknown> = {}) => ({
  id: 7, folio: "BAJA-2026-0003", fechaBaja: "2026-09-29", elaboro: "Joel Polanco",
  creadoEn: "2026-09-29T16:00:00.000Z", costoTotal: "50000.00",
  equipos: [{ id: 1, numeroSerie: "SN-1", tipo: "LAPTOP", marca: "Dell", modelo: "Latitude", fechaAdquisicion: "2023-03-15", costo: "21500.00", tiempoFuncionamiento: { anios: 3, meses: 6 }, observaciones: "No enciende" }],
  articulos: [{ id: 1, descripcion: "Baterías UPS no-break", cantidad: 19, costo: "28500.00", aniosUso: 10, observaciones: "No retienen carga" }],
  ...cambios,
});

type Envoltura = Awaited<ReturnType<typeof montar>>["envoltura"];

async function montar(componente: unknown, ruta: string, responder: Parameters<typeof simularApi>[0], opciones?: { avisos?: boolean; props?: Record<string, unknown> }) {
  const llamadas = simularApi(responder, opciones);
  const router = crearRouterDePrueba();
  router.push(ruta);
  await router.isReady();
  const envoltura = mount(componente as never, { props: opciones?.props as never, global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return { envoltura, router, llamadas };
}

// =============================================================================
describe("validarBaja", () => {
  const completos = () => ({
    equipos: [{ id: 1, observaciones: "No enciende" }],
    articulos: [{ ...articuloVacio(), descripcion: "Tóners", cantidad: "13", observaciones: "Usados" }],
    fechaBaja: "2026-09-29",
    elaboro: "Joel",
  });

  it("acepta datos completos (costo y años de uso son opcionales)", () => {
    expect(validarBaja(completos(), "2026-09-29")).toEqual({});
  });

  it("pide al menos un equipo o un artículo, y quién captura", () => {
    expect(validarBaja({ equipos: [], articulos: [], fechaBaja: "", elaboro: " " }, "2026-09-29")).toEqual({
      equipos: "Agrega al menos un equipo o un artículo.",
      fechaBaja: "Elige la fecha de la baja.",
      elaboro: "Escribe el nombre de quien captura la baja.",
    });
  });

  it("marca cada renglón con los mismos nombres de campo que la API", () => {
    const datos = completos();
    datos.equipos.push({ id: 2, observaciones: "  " });
    datos.articulos.push({ descripcion: "", cantidad: "0", costo: "-5", aniosUso: "2.5", observaciones: "" });
    expect(validarBaja(datos, "2026-09-29")).toEqual({
      "equipos.1.observaciones": "Escribe el motivo de la baja y las condiciones.",
      "articulos.1.descripcion": "Describe el artículo, por ejemplo «Baterías de UPS».",
      "articulos.1.cantidad": "La cantidad debe ser mayor que cero.",
      "articulos.1.costo": "El costo no puede ser negativo.",
      "articulos.1.aniosUso": "Escribe los años de uso sin decimales (0 si es menos de un año).",
      "articulos.1.observaciones": "Escribe el motivo de la baja y las condiciones.",
    });
  });

  it.each([
    ["cantidad con letras", { cantidad: "diez" }, "cantidad", "Escribe la cantidad como número."],
    ["cantidad con decimales", { cantidad: "1.5" }, "cantidad", "La cantidad debe ser un número entero."],
    ["costo mal escrito", { costo: "12.345" }, "costo", "hasta 8 enteros y 2 decimales"],
    ["años negativos", { aniosUso: "-1" }, "aniosUso", "no pueden ser negativos"],
    ["demasiados años", { aniosUso: "150" }, "aniosUso", "Revisa los años de uso."],
  ])("rechaza %s", (_caso, cambios, campo, mensaje) => {
    const datos = completos();
    Object.assign(datos.articulos[0]!, cambios);
    expect(validarBaja(datos, "2026-09-29")[`articulos.0.${campo}`]).toContain(mensaje);
  });

  it("acepta un costo con comas y signo de pesos, y 0 años de uso", () => {
    const datos = completos();
    Object.assign(datos.articulos[0]!, { costo: "$28,500.00", aniosUso: "0" });
    expect(validarBaja(datos, "2026-09-29")).toEqual({});
  });

  it("rechaza una fecha futura", () => {
    expect(validarBaja({ ...completos(), fechaBaja: "2026-09-30" }, "2026-09-29").fechaBaja).toBe("La fecha de la baja no puede ser futura.");
  });

  it("resume lo que se da de baja", () => {
    expect(resumenRenglones(1, 0)).toBe("1 equipo");
    expect(resumenRenglones(3, 2)).toBe("3 equipos y 2 artículos");
    expect(resumenRenglones(0, 1)).toBe("1 artículo");
  });
});

// =============================================================================
describe("Registrar baja", () => {
  async function buscar(envoltura: Envoltura, texto: string) {
    await envoltura.find("#buscar-baja").setValue(texto);
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
  }
  async function capturar(envoltura: Envoltura) {
    await envoltura.find("#elaboro").setValue("Joel Polanco");
  }
  async function enviarYConfirmar() {
    document.querySelector("dialog[open] form")!.dispatchEvent(new Event("submit"));
    await flushPromises();
  }

  it("sin nada no pide confirmación: marca los errores y enfoca el primero", async () => {
    const { envoltura, llamadas } = await montar(NuevaBajaVista, "/bajas/nueva", () => listado([]));
    expect((envoltura.find("#fechaBaja").element as HTMLInputElement).value).toBe("2026-09-29");
    await envoltura.find("form").trigger("submit");
    await flushPromises();
    expect(envoltura.findAll(".campo-error").map((e) => e.text())).toEqual([
      "Agrega al menos un equipo o un artículo.",
      "Escribe el nombre de quien captura la baja.",
    ]);
    expect(document.activeElement?.id).toBe("buscar-baja");
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(llamadas).toHaveLength(0);
  });

  it("un equipo asignado no se puede marcar y explica por qué", async () => {
    const { envoltura } = await montar(NuevaBajaVista, "/bajas/nueva", () => listado([asignado(2, "SN-ASIGNADO"), libre(3, "SN-LIBRE")]));
    await buscar(envoltura, "SN");
    const filas = envoltura.findAll(".fila");
    expect(filas[0]!.find("input").attributes("disabled")).toBeDefined();
    expect(filas[0]!.text()).toContain("Asignado a Laura Méndez Cruz: registra la devolución primero");
    expect(filas[1]!.find("input").attributes("disabled")).toBeUndefined();
  });

  it("cada equipo elegido pide su motivo, y se puede copiar el primero a los demás", async () => {
    const { envoltura } = await montar(NuevaBajaVista, "/bajas/nueva", () => listado([libre(1, "SN-1"), libre(3, "SN-3")]));
    await buscar(envoltura, "SN");
    await envoltura.findAll(".fila input")[0]!.setValue(true);
    await envoltura.findAll(".fila input")[1]!.setValue(true);
    expect(envoltura.findAll(".renglon-equipo .serie").map((s) => s.text())).toEqual(["SN-1", "SN-3"]);

    await capturar(envoltura);
    await envoltura.find("form").trigger("submit");
    await flushPromises();
    expect(envoltura.find("#error-equipos-0-observaciones").text()).toBe("Escribe el motivo de la baja y las condiciones.");
    expect(document.activeElement?.id).toBe("equipo-0-observaciones");

    await envoltura.find("#equipo-0-observaciones").setValue("No enciende");
    expect(envoltura.find("#error-equipos-0-observaciones").exists()).toBe(false);
    await envoltura.findAll(".renglones-titulo button")[0]!.trigger("click");
    expect((envoltura.find("#equipo-1-observaciones").element as HTMLInputElement).value).toBe("No enciende");
    expect(envoltura.find("#error-equipos-1-observaciones").exists()).toBe(false);
  });

  it("registra equipos y artículos, confirma y muestra el folio con el botón para imprimir", async () => {
    let cuerpoEnviado: unknown;
    const { envoltura, llamadas } = await montar(
      NuevaBajaVista,
      "/bajas/nueva?equipo=1",
      (_url, init) => {
        if (init?.method === "POST") {
          cuerpoEnviado = JSON.parse(String(init.body));
          return { estado: 201, cuerpo: { ...bajaDemo(), mantenimientosCancelados: 2 } };
        }
        return { cuerpo: libre(1, "SN-1") };
      },
      { avisos: true },
    );
    await envoltura.find("#equipo-0-observaciones").setValue("No enciende");
    await envoltura.findAll("button").find((b) => b.text().includes("Agregar artículo"))!.trigger("click");
    await flushPromises();
    expect(document.activeElement?.id).toBe("articulo-0-descripcion");
    await envoltura.find("#articulo-0-descripcion").setValue("Baterías UPS no-break");
    await envoltura.find("#articulo-0-cantidad").setValue("19");
    await envoltura.find("#articulo-0-costo").setValue("28,500");
    await envoltura.find("#articulo-0-aniosUso").setValue("10");
    await envoltura.find("#articulo-0-observaciones").setValue("No retienen carga");
    await capturar(envoltura);
    expect(envoltura.find("button[type=submit]").text()).toBe("Dar de baja 1 equipo y 1 artículo");

    await envoltura.find("form").trigger("submit");
    await flushPromises();
    const dialogo = document.querySelector("dialog[open]")!;
    expect(dialogo.querySelector("h2")!.textContent).toBe("¿Dar de baja 1 equipo y 1 artículo?");
    expect(dialogo.textContent).toContain("El equipo SN-1 saldrá del inventario y ya no se podrá editar, asignar ni darle mantenimiento.");
    expect(dialogo.textContent).toContain("También se registra 1 artículo sin número de serie.");
    expect(dialogo.textContent).toContain("Esta acción no se puede deshacer.");
    expect(dialogo.querySelector("button[type=submit]")!.className).toContain("boton-peligro-solido");

    await enviarYConfirmar();
    expect(cuerpoEnviado).toEqual({
      equipos: [{ id: 1, observaciones: "No enciende" }],
      articulos: [{ descripcion: "Baterías UPS no-break", cantidad: "19", costo: "28,500", aniosUso: "10", observaciones: "No retienen carga" }],
      fechaBaja: "2026-09-29",
      elaboro: "Joel Polanco",
    });
    const exito = envoltura.find(".exito");
    expect(exito.text()).toContain("Baja registrada · BAJA-2026-0003");
    expect(exito.text()).toContain("Se registraron 1 equipo y 1 artículo. El equipo ya aparece como dado de baja.");
    expect(exito.text()).toContain("Se cancelaron 2 mantenimientos programados.");
    expect(exito.find("a[target=_blank]").attributes("href")).toBe("/api/reportes/baja/7");
    expect(avisosFlotantes.map((a) => a.texto)).toContain("Baja registrada con el folio BAJA-2026-0003.");
    expect(llamadas.some((l) => l.url.startsWith("/api/mantenimientos/avisos"))).toBe(true);
  });

  it("permite un acta solo de artículos y marca el renglón con error", async () => {
    const { envoltura } = await montar(NuevaBajaVista, "/bajas/nueva", () => listado([]));
    const agregar = () => envoltura.findAll("button").find((b) => b.text().includes("Agregar artículo"))!.trigger("click");
    await agregar();
    await agregar();
    await envoltura.find("#articulo-0-descripcion").setValue("Tóners");
    await envoltura.find("#articulo-0-observaciones").setValue("Usados");
    await envoltura.find("#articulo-1-cantidad").setValue("0");
    await capturar(envoltura);
    await envoltura.find("form").trigger("submit");
    await flushPromises();
    expect(envoltura.find("#error-articulos-1-descripcion").exists()).toBe(true);
    expect(envoltura.find("#error-articulos-1-cantidad").text()).toBe("La cantidad debe ser mayor que cero.");
    expect(document.activeElement?.id).toBe("articulo-1-descripcion");

    // Al quitar el renglón con errores, ya se puede confirmar.
    await envoltura.find("[aria-label='Quitar el artículo 2']").trigger("click");
    await envoltura.find("form").trigger("submit");
    await flushPromises();
    expect(document.querySelector("dialog[open] h2")!.textContent).toBe("¿Dar de baja 1 artículo?");
  });

  it("«No, revisar» cierra la confirmación sin enviar nada", async () => {
    const { envoltura, llamadas } = await montar(NuevaBajaVista, "/bajas/nueva?equipo=1", () => ({ cuerpo: libre(1, "SN-1") }));
    await envoltura.find("#equipo-0-observaciones").setValue("No enciende");
    await capturar(envoltura);
    await envoltura.find("form").trigger("submit");
    await flushPromises();
    ([...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent === "No, revisar") as HTMLButtonElement).click();
    await flushPromises();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(llamadas.filter((l) => l.init?.method === "POST")).toHaveLength(0);
  });

  it.each([
    ["asignado", asignado(2, "SN-2"), "SN-2 está asignado a Laura Méndez Cruz. Registra la devolución antes de darlo de baja."],
    ["ya dado de baja", { ...libre(2, "SN-2"), estado: "BAJA", baja: { id: 1, folio: "BAJA-2026-0001", fechaBaja: "2026-09-01", observaciones: "Rota" } }, "El equipo SN-2 ya está dado de baja (folio BAJA-2026-0001)."],
  ])("si el equipo de la ficha está %s, avisa y no lo elige", async (_caso, equipo, mensaje) => {
    const { envoltura } = await montar(NuevaBajaVista, "/bajas/nueva?equipo=2", () => ({ cuerpo: equipo }));
    expect(envoltura.find(".aviso-alerta").text()).toContain(mensaje);
    expect(envoltura.find(".aviso-alerta a").exists()).toBe(true);
    expect(envoltura.findAll(".renglon-equipo")).toHaveLength(0);
  });

  it("si la API rechaza un equipo (alguien lo asignó mientras tanto), cierra la confirmación y lo marca", async () => {
    const mensaje = "Registra primero la devolución de este equipo: SN-1 (Laura Méndez Cruz).";
    const { envoltura } = await montar(NuevaBajaVista, "/bajas/nueva?equipo=1", (_url, init) =>
      init?.method === "POST"
        ? { estado: 409, cuerpo: { error: { codigo: "EQUIPO_ASIGNADO", mensaje, campos: { equipos: mensaje } } } }
        : { cuerpo: libre(1, "SN-1") },
    );
    await envoltura.find("#equipo-0-observaciones").setValue("No enciende");
    await capturar(envoltura);
    await envoltura.find("form").trigger("submit");
    await flushPromises();
    await enviarYConfirmar();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(envoltura.find("#error-equipos").text()).toBe(mensaje);
    expect(document.activeElement?.id).toBe("buscar-baja");
  });

  it("si el servidor falla, lo dice dentro de la confirmación para reintentar", async () => {
    const { envoltura } = await montar(NuevaBajaVista, "/bajas/nueva?equipo=1", (_url, init) =>
      init?.method === "POST"
        ? { estado: 500, cuerpo: { error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado en el servidor." } } }
        : { cuerpo: libre(1, "SN-1") },
    );
    await envoltura.find("#equipo-0-observaciones").setValue("No enciende");
    await capturar(envoltura);
    await envoltura.find("form").trigger("submit");
    await flushPromises();
    await enviarYConfirmar();
    expect(document.querySelector("dialog[open] .aviso-error")!.textContent).toBe("Ocurrió un error inesperado en el servidor.");
    expect(envoltura.find(".exito").exists()).toBe(false);
  });

  it("«Registrar otra baja» limpia el formulario pero conserva quién captura", async () => {
    const { envoltura } = await montar(NuevaBajaVista, "/bajas/nueva?equipo=1", (_url, init) =>
      init?.method === "POST" ? { estado: 201, cuerpo: { ...bajaDemo({ articulos: [] }), mantenimientosCancelados: 0 } } : { cuerpo: libre(1, "SN-1") },
    );
    await envoltura.find("#equipo-0-observaciones").setValue("No enciende");
    await capturar(envoltura);
    await envoltura.find("form").trigger("submit");
    await flushPromises();
    await enviarYConfirmar();
    expect(envoltura.find(".exito").text()).not.toContain("Se cancel");
    await envoltura.findAll(".exito button").find((b) => b.text() === "Registrar otra baja")!.trigger("click");
    expect(envoltura.findAll(".renglon-equipo")).toHaveLength(0);
    expect((envoltura.find("#elaboro").element as HTMLInputElement).value).toBe("Joel Polanco");
  });
});

// =============================================================================
describe("Lista de bajas", () => {
  it("muestra cada acta con sus equipos, sus artículos, el costo y el enlace al reporte", async () => {
    const varios = Array.from({ length: 5 }, (_, i) => ({ ...bajaDemo().equipos[0], id: i + 1, numeroSerie: `SN-${i + 1}` }));
    const { envoltura } = await montar(BajasVista, "/bajas", () => ({ cuerpo: { datos: [bajaDemo({ equipos: varios })], total: 1, pagina: 1, porPagina: 20 } }));
    const fila = envoltura.find("tbody tr");
    expect(fila.text()).toContain("BAJA-2026-0003");
    expect(fila.text()).toContain("29/09/2026");
    expect(fila.findAll(".series a").map((a) => a.text())).toEqual(["SN-1", "SN-2", "SN-3"]);
    expect(fila.text()).toContain("+2 más");
    expect(fila.find(".articulos").text()).toBe("Baterías UPS no-break (19)");
    expect(fila.text()).toContain("$50,000.00 MXN");
    expect(fila.find("a[target=_blank]").attributes("href")).toBe("/api/reportes/baja/7");
  });

  it("sin bajas invita a registrar la primera", async () => {
    const { envoltura } = await montar(BajasVista, "/bajas", () => ({ cuerpo: { datos: [], total: 0, pagina: 1, porPagina: 20 } }));
    expect(envoltura.text()).toContain("Todavía no hay bajas registradas.");
  });

  it("la búsqueda va en la dirección", async () => {
    const { envoltura, router, llamadas } = await montar(BajasVista, "/bajas", () => ({ cuerpo: { datos: [], total: 0, pagina: 1, porPagina: 20 } }));
    await envoltura.find("input[type=search]").setValue(" tóners ");
    await vi.advanceTimersByTimeAsync(350);
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ busqueda: "tóners" });
    expect(llamadas.at(-1)!.url).toBe("/api/bajas?busqueda=t%C3%B3ners&pagina=1&porPagina=20");
    expect(envoltura.text()).toContain("Ninguna baja coincide con «tóners».");
  });

  it("si la API falla, permite reintentar", async () => {
    let intentos = 0;
    const { envoltura } = await montar(BajasVista, "/bajas", () =>
      ++intentos === 1
        ? { estado: 500, cuerpo: { error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado en el servidor." } } }
        : { cuerpo: { datos: [bajaDemo()], total: 1, pagina: 1, porPagina: 20 } },
    );
    expect(envoltura.text()).toContain("Ocurrió un error inesperado en el servidor.");
    await envoltura.findAll("button").find((b) => b.text() === "Intentar de nuevo")!.trigger("click");
    await flushPromises();
    expect(envoltura.find("tbody tr").text()).toContain("BAJA-2026-0003");
  });
});

// =============================================================================
describe("Ficha del equipo y la baja", () => {
  const ficha = (cambios: Record<string, unknown>) => ({
    cuerpo: {
      ...libre(1, "SN-1"), especificaciones: null, fechaAdquisicion: "2023-03-15", costo: "21500.00",
      fechaVencimientoGarantia: null, garantiaVigente: null, tiempoFuncionamiento: { anios: 3, meses: 6 },
      creadoEn: "2026-03-15T15:00:00.000Z", asignaciones: [], mantenimientos: [], ...cambios,
    },
  });

  it("un equipo activo ofrece «Dar de baja» con el equipo ya elegido", async () => {
    const { envoltura } = await montar(FichaEquipoVista, "/inventario/1", () => ficha({}), { props: { id: "1" } });
    expect(envoltura.find("a.dar-de-baja").attributes("href")).toBe("/bajas/nueva?equipo=1");
    expect(envoltura.find(".aviso-baja").exists()).toBe(false);
  });

  it("un equipo dado de baja muestra su acta y su motivo, y ya no ofrece editar, dar de baja ni programar", async () => {
    const { envoltura } = await montar(
      FichaEquipoVista,
      "/inventario/1",
      () => ficha({ estado: "BAJA", baja: { id: 7, folio: "BAJA-2026-0003", fechaBaja: "2026-09-29", observaciones: "No enciende" } }),
      { props: { id: "1" } },
    );
    const aviso = envoltura.find(".aviso-baja");
    expect(aviso.text()).toContain("Dado de baja el 29/09/2026");
    expect(aviso.text()).toContain("BAJA-2026-0003 · Motivo: No enciende.");
    expect(aviso.find("a.imprimir-baja").attributes("href")).toBe("/api/reportes/baja/7");
    expect(envoltura.find("a.dar-de-baja").exists()).toBe(false);
    expect(envoltura.text()).not.toContain("Editar datos");
    expect(envoltura.findAll("button").some((b) => b.text().includes("Programar"))).toBe(false);
  });
});
