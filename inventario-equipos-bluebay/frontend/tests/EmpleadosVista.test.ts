import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Empleado } from "../src/api/empleados";
import EmpleadosVista from "../src/vistas/EmpleadosVista.vue";
import { crearRouterDePrueba, simularApi } from "./ayudantes";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close ??= function () { this.removeAttribute("open"); };
});
afterEach(() => vi.unstubAllGlobals());

const laura: Empleado = { id: 1, numeroEmpleado: "DEMO-001", nombre: "Laura", apellidos: "Méndez Cruz", puesto: "Recepcionista", activo: true, departamento: { id: 1, nombre: "Recepción" }, equiposAsignados: 1, salida: null, anonimizado: false };
const sofia: Empleado = { id: 5, numeroEmpleado: "DEMO-005", nombre: "Sofía", apellidos: "Díaz Herrera", puesto: "Analista", activo: true, departamento: { id: 2, nombre: "Recursos Humanos" }, equiposAsignados: 0, salida: null, anonimizado: false };

const fichaDe = (empleado: Empleado, conEquipo: boolean) => ({
  ...empleado,
  creadoEn: "2026-09-01T10:00:00.000Z",
  equiposVigentes: conEquipo
    ? [{ id: 1, fechaAsignacion: "2025-08-14T15:00:00.000Z", fechaDevolucion: null, observaciones: null, observacionesDevolucion: null, equipo: { id: 1, numeroSerie: "DEMO-SN-0001", tipo: "LAPTOP", marca: "Dell", modelo: "Latitude 5440", estado: "ACTIVO" } }]
    : [],
  historial: [],
  // Laura tiene historial (no se puede borrar); Sofía nunca tuvo equipos.
  puedeEliminar: !conEquipo,
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

  it("no deja dar de baja a quien tiene equipos, y sí a quien no tiene", async () => {
    const { envoltura } = await montar();
    const lateral = () => envoltura.find(".lateral");
    expect(lateral().text()).toContain("Primero registra la devolución de sus equipos.");
    expect(lateral().find("[aria-disabled=true]").text()).toBe("Dar de baja (renuncia, despido…)");
    // Laura tiene historial: no se ofrece eliminarla.
    expect(lateral().text()).not.toContain("Eliminar registro");

    await envoltura.findAll("tbody tr")[1]!.find("button").trigger("click");
    await flushPromises();
    expect(lateral().text()).toContain("Sofía Díaz Herrera");
    const baja = lateral().findAll("button").find((b) => b.text().startsWith("Dar de baja"));
    expect(baja).toBeDefined();
    await baja!.trigger("click");
    expect(document.body.textContent).toContain("Dar de baja a Sofía Díaz Herrera");
    expect(document.body.textContent).toContain("Esta acción no se puede deshacer.");
    envoltura.unmount();
  });

  it("dar de baja: pide motivo, no acepta fecha futura y manda fecha, motivo y notas", async () => {
    const anonimizada = { ...fichaDe(sofia, false), nombre: "Ex empleado", apellidos: "#5", numeroEmpleado: "EX-5", activo: false, anonimizado: true,
      salida: { fecha: "2026-10-01", motivo: "RENUNCIA", observaciones: "Se cambió de ciudad" }, puedeEliminar: false };
    const { envoltura, llamadas } = await montar((url, init) =>
      init?.method === "POST" && url === "/api/empleados/5/baja" ? { cuerpo: anonimizada } : respuestaEstandar(url),
    );
    await envoltura.findAll("tbody tr")[1]!.find("button").trigger("click");
    await flushPromises();
    await envoltura.find(".lateral").findAll("button").find((b) => b.text().startsWith("Dar de baja"))!.trigger("click");

    const dialogo = () => envoltura.find("dialog");
    expect(document.activeElement?.id).toBe("motivo-salida");
    await dialogo().find("#fecha-salida").setValue("2999-01-01");
    await dialogo().find("form").trigger("submit");
    await flushPromises();
    expect(dialogo().find("#error-motivo-salida").text()).toBe("Elige el motivo de la salida.");
    expect(dialogo().find("#error-fecha-salida").text()).toBe("La fecha de salida no puede ser futura.");
    expect(llamadas.filter((l) => l.init?.method === "POST")).toHaveLength(0);

    await dialogo().find("#motivo-salida").setValue("RENUNCIA");
    await dialogo().find("#fecha-salida").setValue("2026-10-01");
    await dialogo().find("#observaciones-salida").setValue("Se cambió de ciudad");
    await dialogo().find("form").trigger("submit");
    await flushPromises();
    const post = llamadas.find((l) => l.init?.method === "POST")!;
    expect(JSON.parse(post.init!.body as string)).toEqual({ fechaSalida: "2026-10-01", motivo: "RENUNCIA", observaciones: "Se cambió de ciudad" });
    expect(envoltura.find("dialog").exists()).toBe(false);
    envoltura.unmount();
  });

  it("la ficha de alguien dado de baja muestra su salida y ya no deja editar ni asignar", async () => {
    const exEmpleado = { ...sofia, id: 9, nombre: "Ex empleado", apellidos: "#9", numeroEmpleado: "EX-9", activo: false, anonimizado: true,
      salida: { fecha: "2026-09-15", motivo: "DESPIDO" as const, observaciones: null } };
    const { envoltura } = await montar((url) => {
      if (url.startsWith("/api/empleados/9")) return { cuerpo: { ...fichaDe(exEmpleado, false), puedeEliminar: false } };
      if (url.startsWith("/api/empleados?") || url === "/api/empleados") return { cuerpo: { datos: [exEmpleado], total: 1, pagina: 1, porPagina: 50, conteos: { activos: 0, inactivos: 1 } } };
      return respuestaEstandar(url);
    });
    const lateral = envoltura.find(".lateral").text();
    expect(envoltura.find("tbody tr").text()).toContain("Baja");
    expect(lateral).toContain("Ex empleado #9");
    expect(lateral).toContain("Dado de baja");
    expect(lateral).toContain("Despido · 15/09/2026");
    expect(lateral).toContain("Sus datos personales se borraron");
    for (const texto of ["Editar datos del empleado", "Asignarle un equipo", "Volver a activar", "Dar de baja", "Eliminar registro"]) {
      expect(lateral, texto).not.toContain(texto);
    }
    envoltura.unmount();
  });

  it("elimina a quien se registró por error (nunca tuvo equipos), tras confirmar", async () => {
    const { envoltura, llamadas } = await montar((url, init) =>
      init?.method === "DELETE" ? { estado: 204, cuerpo: null } : respuestaEstandar(url),
    );
    await envoltura.findAll("tbody tr")[1]!.find("button").trigger("click");
    await flushPromises();
    expect(envoltura.find(".lateral").text()).toContain("Solo si se registró por error");
    await envoltura.find(".lateral").findAll("button").find((b) => b.text() === "Eliminar registro")!.trigger("click");
    expect(document.body.textContent).toContain("Se borrará por completo a Sofía Díaz Herrera (DEMO-005)");
    await envoltura.find("dialog form").trigger("submit");
    await flushPromises();
    const borrar = llamadas.find((l) => l.init?.method === "DELETE")!;
    expect(borrar.url).toBe("/api/empleados/5");
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

  it("al abrir el formulario (alta o edición) deja el cursor en el primer campo", async () => {
    const { envoltura } = await montar();
    await envoltura.findAll("button").find((b) => b.text().includes("Registrar empleado"))!.trigger("click");
    await flushPromises();
    expect(envoltura.find(".lateral h2").text()).toBe("Registrar empleado");
    expect(document.activeElement?.id).toBe("numeroEmpleado");

    await envoltura.findAll("button").find((b) => b.text() === "Cancelar")!.trigger("click");
    (document.activeElement as HTMLElement | null)?.blur();
    await envoltura.findAll("button").find((b) => b.text().includes("Editar datos del empleado"))!.trigger("click");
    await flushPromises();
    expect(envoltura.find(".lateral h2").text()).toBe("Editar empleado");
    expect(document.activeElement?.id).toBe("numeroEmpleado");
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
