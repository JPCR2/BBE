import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import DialogoAsignar from "../src/componentes/DialogoAsignar.vue";
import { equipoDemo, simularApi } from "./ayudantes";

beforeAll(() => {
  // happy-dom no siempre implementa los diálogos nativos.
  HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close ??= function () { this.removeAttribute("open"); };
});
afterEach(() => vi.unstubAllGlobals());

const empleados = (datos: unknown[]) => ({ cuerpo: { datos, total: datos.length, pagina: 1, porPagina: 6, conteos: { activos: datos.length, inactivos: 0 } } });
const laura = { id: 1, numeroEmpleado: "DEMO-001", nombre: "Laura", apellidos: "Méndez Cruz", puesto: "Recepcionista", activo: true, departamento: { id: 1, nombre: "Recepción" }, equiposAsignados: 1 };

async function montar(respuesta?: Parameters<typeof simularApi>[0]) {
  const llamadas = simularApi(respuesta ?? ((url) => (url.includes("/empleados") ? empleados([laura]) : { cuerpo: {} })));
  const envoltura = mount(DialogoAsignar, { props: { equipo: equipoDemo(5, "DEMO-SN-0005", false) as never }, attachTo: document.body });
  await flushPromises();
  return { envoltura, llamadas };
}

describe("DialogoAsignar (desde la ficha del equipo)", () => {
  it("pide elegir un empleado antes de permitir asignar", async () => {
    const { envoltura } = await montar();
    const boton = envoltura.find("button[type=submit]");
    expect(boton.text()).toBe("Elige a un empleado");
    expect(boton.attributes("disabled")).toBeDefined();
    envoltura.unmount();
  });

  it("asigna el equipo al empleado elegido y avisa del resultado", async () => {
    const { envoltura, llamadas } = await montar((url) =>
      url.includes("/asignaciones")
        ? { estado: 201, cuerpo: { asignacion: { id: 9, fechaAsignacion: "2026-09-20T01:00:00.000Z" }, equipo: equipoDemo(5, "DEMO-SN-0005") } }
        : empleados([laura]),
    );
    await envoltura.find(".opcion-persona").trigger("click");
    const boton = envoltura.find("button[type=submit]");
    expect(boton.text()).toBe("Asignar a Laura");
    await envoltura.find("#observaciones-asignacion").setValue("Incluye cable USB");
    await envoltura.find("form").trigger("submit");
    await flushPromises();

    const peticion = llamadas.at(-1)!;
    expect(peticion.url).toBe("/api/asignaciones");
    expect(JSON.parse(String(peticion.init!.body))).toEqual({ equipoId: 5, empleadoId: 1, observaciones: "Incluye cable USB" });
    expect(envoltura.emitted("asignado")?.[0]?.[0]).toBe("DEMO-SN-0005 quedó asignado a Laura Méndez Cruz.");
    envoltura.unmount();
  });

  it("muestra el mensaje de la API si el equipo ya está asignado", async () => {
    const { envoltura } = await montar((url) =>
      url.includes("/asignaciones")
        ? { estado: 409, cuerpo: { error: { codigo: "ASIGNACION_VIGENTE", mensaje: "El equipo DEMO-SN-0005 ya está asignado a Jorge Ramírez Soto. Registra la devolución antes de reasignarlo." } } }
        : empleados([laura]),
    );
    await envoltura.find(".opcion-persona").trigger("click");
    await envoltura.find("form").trigger("submit");
    await flushPromises();
    expect(envoltura.find(".aviso-error").text()).toContain("ya está asignado a Jorge Ramírez Soto");
    expect(envoltura.emitted("asignado")).toBeUndefined();
    envoltura.unmount();
  });

  it("avisa cuando no hay empleados activos que coincidan", async () => {
    const { envoltura } = await montar(() => empleados([]));
    expect(envoltura.text()).toContain("Ningún empleado activo coincide con la búsqueda.");
    envoltura.unmount();
  });
});
