import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import EmpleadosVista from "../src/vistas/EmpleadosVista.vue";
import { crearRouterDePrueba, simularApi } from "./ayudantes";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close ??= function () { this.removeAttribute("open"); };
});
afterEach(() => vi.unstubAllGlobals());

const laura = { id: 1, numeroEmpleado: "DEMO-001", nombre: "Laura", apellidos: "Méndez Cruz", puesto: "Recepcionista", activo: true, departamento: { id: 1, nombre: "Recepción" }, equiposAsignados: 1 };
const sofia = { id: 5, numeroEmpleado: "DEMO-005", nombre: "Sofía", apellidos: "Díaz Herrera", puesto: "Analista", activo: true, departamento: { id: 2, nombre: "Recursos Humanos" }, equiposAsignados: 0 };

const fichaDe = (empleado: typeof laura, conEquipo: boolean) => ({
  ...empleado,
  creadoEn: "2026-09-01T10:00:00.000Z",
  equiposVigentes: conEquipo
    ? [{ id: 1, fechaAsignacion: "2025-08-14T15:00:00.000Z", fechaDevolucion: null, observaciones: null, observacionesDevolucion: null, equipo: { id: 1, numeroSerie: "DEMO-SN-0001", tipo: "LAPTOP", marca: "Dell", modelo: "Latitude 5440", estado: "ACTIVO" } }]
    : [],
  historial: [],
});

function respuestaEstandar(url: string) {
  if (url.startsWith("/api/departamentos")) {
    return { cuerpo: { datos: [{ id: 1, nombre: "Recepción", empleadosActivos: 1 }, { id: 2, nombre: "Recursos Humanos", empleadosActivos: 1 }] } };
  }
  if (url.startsWith("/api/empleados/1")) return { cuerpo: fichaDe(laura, true) };
  if (url.startsWith("/api/empleados/5")) return { cuerpo: fichaDe(sofia, false) };
  return { cuerpo: { datos: [laura, sofia], total: 2, pagina: 1, porPagina: 50, conteos: { activos: 2, inactivos: 0 } } };
}

async function montar(respuesta: (url: string, init?: RequestInit) => { estado?: number; cuerpo: unknown } = respuestaEstandar) {
  const llamadas = simularApi(respuesta);
  const router = crearRouterDePrueba();
  router.push("/empleados");
  await router.isReady();
  const envoltura = mount(EmpleadosVista, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  await flushPromises();
  return { envoltura, llamadas, router };
}

describe("EmpleadosVista", () => {
  it("lista a los empleados con sus equipos y abre la ficha del primero", async () => {
    const { envoltura } = await montar();
    const filas = envoltura.findAll("tbody tr");
    expect(filas).toHaveLength(2);
    expect(filas[0]!.text()).toContain("Laura Méndez Cruz");
    expect(filas[0]!.text()).toContain("1 equipo");
    expect(filas[1]!.text()).toContain("Ninguno");
    expect(envoltura.find(".lateral").text()).toContain("DEMO-SN-0001");
    envoltura.unmount();
  });

  it("no deja desactivar a quien tiene equipos y sí a quien no tiene", async () => {
    const { envoltura } = await montar();
    expect(envoltura.find(".lateral").text()).toContain("Primero registra la devolución de sus equipos.");

    await envoltura.findAll("tbody tr")[1]!.find("button").trigger("click");
    await flushPromises();
    const lateral = envoltura.find(".lateral");
    expect(lateral.text()).toContain("Sofía Díaz Herrera");
    expect(lateral.text()).toContain("No tiene equipos asignados.");
    const desactivar = lateral.findAll("button").find((b) => b.text() === "Desactivar empleado");
    expect(desactivar).toBeDefined();
    await desactivar!.trigger("click");
    expect(document.body.textContent).toContain("¿Desactivar al empleado?");
    envoltura.unmount();
  });

  it("registra un empleado nuevo y muestra los errores de la API", async () => {
    const { envoltura, llamadas } = await montar((url, init) => {
      if (init?.method === "POST" && url === "/api/empleados") {
        return { estado: 409, cuerpo: { error: { codigo: "NUMERO_EMPLEADO_DUPLICADO", mensaje: "Ya existe", campos: { numeroEmpleado: "Ya existe un empleado con el número DEMO-001." } } } };
      }
      return respuestaEstandar(url);
    });
    await envoltura.find(".encabezado-pagina button").trigger("click");
    await flushPromises();
    await envoltura.find("#numeroEmpleado").setValue("DEMO-001");
    await envoltura.find("#nombreEmpleado").setValue("Ana");
    await envoltura.find("#apellidosEmpleado").setValue("Pool");
    await envoltura.find("#puestoEmpleado").setValue("Auxiliar");
    await envoltura.find("#departamentoEmpleado").setValue("1");
    await envoltura.find(".formulario-empleado").trigger("submit");
    await flushPromises();

    expect(JSON.parse(String(llamadas.at(-1)!.init!.body))).toMatchObject({ numeroEmpleado: "DEMO-001", departamentoId: 1 });
    expect(envoltura.find(".campo-error").text()).toBe("Ya existe un empleado con el número DEMO-001.");
    envoltura.unmount();
  });

  it("el formulario avisa de los campos obligatorios antes de llamar a la API", async () => {
    const { envoltura, llamadas } = await montar();
    const antes = llamadas.length;
    await envoltura.find(".encabezado-pagina button").trigger("click");
    await envoltura.find(".formulario-empleado").trigger("submit");
    await flushPromises();
    expect(llamadas.length).toBe(antes);
    expect(envoltura.findAll(".campo-error").map((e) => e.text())).toEqual([
      "Escribe el número de empleado.", "Escribe el nombre.", "Escribe los apellidos.", "Escribe el puesto.", "Selecciona un departamento.",
    ]);
    envoltura.unmount();
  });

  it("en la pestaña de departamentos muestra el catálogo y rechaza nombres repetidos", async () => {
    const { envoltura } = await montar((url, init) => {
      if (init?.method === "POST" && url === "/api/departamentos") {
        return { estado: 409, cuerpo: { error: { codigo: "DEPARTAMENTO_DUPLICADO", mensaje: "Ya existe el departamento «Recepción».", campos: { nombre: "Ya existe el departamento «Recepción»." } } } };
      }
      return respuestaEstandar(url);
    });
    await envoltura.findAll(".pestanas button")[1]!.trigger("click");
    await flushPromises();
    expect(envoltura.find("tbody").text()).toContain("Recepción");
    await envoltura.find("#nuevoDepartamento").setValue("RECEPCION");
    await envoltura.find(".lateral form").trigger("submit");
    await flushPromises();
    expect(envoltura.find(".campo-error").text()).toBe("Ya existe el departamento «Recepción».");
    envoltura.unmount();
  });
});
