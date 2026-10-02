import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import AccionesMantenimiento from "../src/componentes/AccionesMantenimiento.vue";
import DialogoProgramarMantenimiento from "../src/componentes/DialogoProgramarMantenimiento.vue";
import { equipoDemo, mantenimientoDemo, simularApi } from "./ayudantes";

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

const equipo = equipoDemo(1, "DEMO-SN-0001");
const cuerpoDe = (llamada: { init?: RequestInit }) => JSON.parse(String(llamada.init!.body));

// =============================================================================
describe("DialogoProgramarMantenimiento", () => {
  function montar(props: Record<string, unknown> = { equipo }, responder?: Parameters<typeof simularApi>[0]) {
    const llamadas = simularApi(responder ?? (() => ({ estado: 201, cuerpo: mantenimientoDemo(9, "2026-10-15") })));
    const envoltura = mount(DialogoProgramarMantenimiento, { props: props as never, attachTo: document.body });
    return { envoltura, llamadas };
  }

  it("marca lo que falta sin llamar a la API", async () => {
    const { envoltura, llamadas } = montar();
    await envoltura.find("form").trigger("submit");
    expect(envoltura.text()).toContain("Selecciona si es preventivo o correctivo.");
    expect(envoltura.text()).toContain("Elige la fecha programada.");
    expect(envoltura.text()).toContain("Describe qué se hará o qué se hizo.");
    expect(llamadas).toHaveLength(0);
  });

  it("no deja programar en una fecha pasada y sugiere registrarlo como realizado", async () => {
    const { envoltura, llamadas } = montar();
    await envoltura.find("input[value=PREVENTIVO]").setValue(true);
    await envoltura.find("#fecha-mantenimiento").setValue("2026-09-21");
    await envoltura.find("#descripcion-mantenimiento").setValue("Limpieza");
    await envoltura.find("form").trigger("submit");
    expect(envoltura.text()).toContain("no puede ser anterior a hoy. Si ya se hizo, regístralo como realizado.");
    expect(llamadas).toHaveLength(0);
  });

  it("programa con el equipo de la ficha y avisa con la fecha", async () => {
    const { envoltura, llamadas } = montar();
    expect(envoltura.find("#fecha-mantenimiento").attributes("min")).toBe("2026-09-22");
    await envoltura.find("input[value=PREVENTIVO]").setValue(true);
    await envoltura.find("#fecha-mantenimiento").setValue("2026-10-15");
    await envoltura.find("#responsable-mantenimiento").setValue("  Sistemas ");
    await envoltura.find("#descripcion-mantenimiento").setValue(" Limpieza interna ");
    await envoltura.find("form").trigger("submit");
    await flushPromises();

    expect(llamadas[0]!.url).toBe("/api/mantenimientos");
    expect(cuerpoDe(llamadas[0]!)).toEqual({
      estado: "PROGRAMADO", equipoId: 1, tipo: "PREVENTIVO", descripcion: "Limpieza interna", responsable: "Sistemas", fechaProgramada: "2026-10-15",
    });
    expect(envoltura.emitted("guardado")![0]![0]).toBe("Mantenimiento de DEMO-SN-0001 programado para el 15/10/2026.");
  });

  it("registra un correctivo que ya se hizo: la fecha es hoy y no puede ser futura", async () => {
    const { envoltura, llamadas } = montar();
    await envoltura.find("input[value=REALIZADO]").setValue(true);
    const fecha = envoltura.find("#fecha-mantenimiento");
    expect((fecha.element as HTMLInputElement).value).toBe("2026-09-22");
    expect(fecha.attributes("max")).toBe("2026-09-22");
    await envoltura.find("input[value=CORRECTIVO]").setValue(true);
    await envoltura.find("#descripcion-mantenimiento").setValue("Se cambió el teclado");
    expect(envoltura.find("button[type=submit]").text()).toBe("Registrar como realizado");
    await envoltura.find("form").trigger("submit");
    await flushPromises();
    expect(cuerpoDe(llamadas[0]!)).toMatchObject({ estado: "REALIZADO", tipo: "CORRECTIVO", fechaRealizacion: "2026-09-22" });
    expect(envoltura.emitted("guardado")![0]![0]).toBe("Mantenimiento de DEMO-SN-0001 registrado como realizado.");
  });

  it("sin equipo elegido, pide escogerlo de la lista", async () => {
    const { envoltura, llamadas } = montar({}, (url) =>
      url.startsWith("/api/equipos")
        ? { cuerpo: { datos: [equipoDemo(5, "DEMO-SN-0005", false)], total: 1, pagina: 1, porPagina: 6, conteos: {} } }
        : { estado: 201, cuerpo: mantenimientoDemo(9, "2026-09-25") },
    );
    await flushPromises();
    await envoltura.find("input[value=PREVENTIVO]").setValue(true);
    await envoltura.find("#fecha-mantenimiento").setValue("2026-09-25");
    await envoltura.find("#descripcion-mantenimiento").setValue("Limpieza");
    await envoltura.find("form").trigger("submit");
    expect(envoltura.text()).toContain("Selecciona un equipo.");

    await envoltura.find(".opcion-persona").trigger("click");
    await envoltura.find("form").trigger("submit");
    await flushPromises();
    expect(cuerpoDe(llamadas.at(-1)!)).toMatchObject({ equipoId: 5 });
  });

  it("sugiere el día elegido en el calendario, pero no si ya pasó", () => {
    expect((montar({ equipo, fechaInicial: "2026-09-30" }).envoltura.find("#fecha-mantenimiento").element as HTMLInputElement).value).toBe("2026-09-30");
    expect((montar({ equipo, fechaInicial: "2026-09-01" }).envoltura.find("#fecha-mantenimiento").element as HTMLInputElement).value).toBe("");
  });

  it("muestra junto al campo el error que devuelve la API", async () => {
    const { envoltura } = montar({ equipo }, () => ({
      estado: 409, cuerpo: { error: { codigo: "EQUIPO_DADO_DE_BAJA", mensaje: "El equipo DEMO-SN-0001 está dado de baja y ya no admite mantenimientos nuevos." } },
    }));
    await envoltura.find("input[value=PREVENTIVO]").setValue(true);
    await envoltura.find("#fecha-mantenimiento").setValue("2026-10-01");
    await envoltura.find("#descripcion-mantenimiento").setValue("Limpieza");
    await envoltura.find("form").trigger("submit");
    await flushPromises();
    expect(envoltura.find(".aviso-error").text()).toContain("dado de baja");
    expect(envoltura.emitted("guardado")).toBeUndefined();
  });

  it("al reprogramar solo envía lo que cambió (un vencido se corrige sin moverle la fecha)", async () => {
    const vencido = mantenimientoDemo(3, "2026-09-10", { situacion: "VENCIDO", diasRestantes: -12 });
    const { envoltura, llamadas } = montar({ mantenimiento: { ...vencido, equipo } }, () => ({ cuerpo: vencido }));
    expect(envoltura.find("h2").text()).toBe("Reprogramar o corregir");
    expect(envoltura.find("input[value=REALIZADO]").exists()).toBe(false);

    await envoltura.find("form").trigger("submit");
    expect(envoltura.find(".aviso-error").text()).toBe("No hay cambios que guardar.");
    expect(llamadas).toHaveLength(0);

    await envoltura.find("#descripcion-mantenimiento").setValue("Limpieza y cambio de pasta térmica");
    await envoltura.find("form").trigger("submit");
    await flushPromises();
    expect(llamadas[0]!.init!.method).toBe("PATCH");
    expect(cuerpoDe(llamadas[0]!)).toEqual({ descripcion: "Limpieza y cambio de pasta térmica" });
    expect(envoltura.emitted("guardado")![0]![0]).toBe("Mantenimiento de DEMO-SN-0001 actualizado.");
  });

  it("al mover la fecha avisa que se reprogramó", async () => {
    const m = mantenimientoDemo(3, "2026-09-25");
    const { envoltura, llamadas } = montar({ mantenimiento: { ...m, equipo } }, () => ({ cuerpo: m }));
    await envoltura.find("#fecha-mantenimiento").setValue("2026-10-02");
    await envoltura.find("form").trigger("submit");
    await flushPromises();
    expect(cuerpoDe(llamadas[0]!)).toEqual({ fechaProgramada: "2026-10-02" });
    expect(envoltura.emitted("guardado")![0]![0]).toBe("Mantenimiento de DEMO-SN-0001 reprogramado para el 02/10/2026.");
  });
});

// =============================================================================
describe("AccionesMantenimiento", () => {
  function montar(mantenimiento = mantenimientoDemo(3, "2026-09-25"), responder?: Parameters<typeof simularApi>[0]) {
    const llamadas = simularApi(responder ?? (() => ({ cuerpo: mantenimiento })));
    const envoltura = mount(AccionesMantenimiento, { props: { mantenimiento, equipo } as never, attachTo: document.body });
    return { envoltura, llamadas };
  }

  it("no ofrece acciones para uno ya realizado o cancelado", () => {
    expect(montar(mantenimientoDemo(3, "2026-09-01", { estado: "REALIZADO", situacion: "REALIZADO", diasRestantes: null })).envoltura.find("button").exists()).toBe(false);
    expect(montar(mantenimientoDemo(4, "2026-09-01", { estado: "CANCELADO", situacion: "CANCELADO", diasRestantes: null })).envoltura.find("button").exists()).toBe(false);
  });

  it("marca como realizado con la fecha de hoy y avisa", async () => {
    const { envoltura, llamadas } = montar();
    await envoltura.find(".accion-realizado").trigger("click");
    expect((envoltura.find("#fecha-realizacion").element as HTMLInputElement).value).toBe("2026-09-22");
    await envoltura.find("#responsable-realizado").setValue("Joel");
    await envoltura.find("#titulo-realizado").element.closest("form")!.dispatchEvent(new Event("submit"));
    await flushPromises();
    expect(llamadas[0]!.url).toBe("/api/mantenimientos/3/realizado");
    expect(cuerpoDe(llamadas[0]!)).toEqual({ fechaRealizacion: "2026-09-22", responsable: "Joel" });
    expect(envoltura.emitted("actualizado")![0]![0]).toBe("Mantenimiento de DEMO-SN-0001 registrado como realizado.");
    expect(envoltura.find("#titulo-realizado").exists()).toBe(false);
  });

  it("no deja registrar una fecha de realización futura", async () => {
    const { envoltura, llamadas } = montar();
    await envoltura.find(".accion-realizado").trigger("click");
    await envoltura.find("#fecha-realizacion").setValue("2026-09-23");
    await envoltura.find("#titulo-realizado").element.closest("form")!.dispatchEvent(new Event("submit"));
    await flushPromises();
    expect(envoltura.text()).toContain("La fecha de realización no puede ser futura.");
    expect(llamadas).toHaveLength(0);
  });

  it("pide confirmar antes de cancelar", async () => {
    const { envoltura, llamadas } = montar();
    await envoltura.find(".accion-cancelar").trigger("click");
    expect(envoltura.text()).toContain("¿Cancelar este mantenimiento?");
    expect(envoltura.text()).toContain("programado para el 25/09/2026");
    // El botón para salir no puede decir también "Cancelar": se confundiría con la acción.
    expect(envoltura.findAll("dialog button").map((b) => b.text())).toEqual(["", "No, conservarlo", "Sí, cancelarlo"]);
    expect(llamadas).toHaveLength(0);
    await envoltura.find("#titulo-confirmar").element.closest("form")!.dispatchEvent(new Event("submit"));
    await flushPromises();
    expect(llamadas[0]).toMatchObject({ url: "/api/mantenimientos/3/cancelacion", init: { method: "POST" } });
    expect(envoltura.emitted("actualizado")![0]![0]).toBe("Mantenimiento de DEMO-SN-0001 cancelado.");
  });

  it("si la API rechaza la cancelación, lo explica y no cierra", async () => {
    const { envoltura } = montar(undefined, () => ({
      estado: 409, cuerpo: { error: { codigo: "MANTENIMIENTO_YA_REALIZADO", mensaje: "Este mantenimiento ya está registrado como realizado." } },
    }));
    await envoltura.find(".accion-cancelar").trigger("click");
    await envoltura.find("#titulo-confirmar").element.closest("form")!.dispatchEvent(new Event("submit"));
    await flushPromises();
    expect(envoltura.find(".aviso-error").text()).toBe("Este mantenimiento ya está registrado como realizado.");
    expect(envoltura.emitted("actualizado")).toBeUndefined();
  });

  it("cada botón dice de qué equipo es (en una tabla hay varios iguales)", () => {
    const { envoltura } = montar();
    expect(envoltura.findAll("button").map((b) => b.attributes("aria-label"))).toEqual([
      "Marcar como realizado el mantenimiento de DEMO-SN-0001",
      "Reprogramar el mantenimiento de DEMO-SN-0001",
      "Cancelar el mantenimiento de DEMO-SN-0001",
    ]);
  });

  it("al registrar, recuerda regresar a Activo solo si el equipo está en mantenimiento", async () => {
    simularApi(() => ({ cuerpo: {} }));
    const enTaller = mount(AccionesMantenimiento, {
      props: { mantenimiento: mantenimientoDemo(3, "2026-09-25"), equipo: { ...equipo, estado: "EN_MANTENIMIENTO" } } as never,
      attachTo: document.body,
    });
    await enTaller.find(".accion-realizado").trigger("click");
    expect(enTaller.find(".pie").text()).toContain("regrésalo a Activo");
    enTaller.unmount();

    const activo = mount(AccionesMantenimiento, { props: { mantenimiento: mantenimientoDemo(3, "2026-09-25"), equipo } as never, attachTo: document.body });
    await activo.find(".accion-realizado").trigger("click");
    expect(activo.find(".pie").text()).toBe("");
  });

  it("en modo compacto solo muestra el botón principal", () => {
    const llamadas = simularApi(() => ({ cuerpo: {} }));
    const envoltura = mount(AccionesMantenimiento, { props: { mantenimiento: mantenimientoDemo(3, "2026-09-25"), equipo, compacto: true } as never });
    expect(envoltura.findAll("button").map((b) => b.text())).toEqual(["Realizado"]);
    expect(llamadas).toHaveLength(0);
  });
});
