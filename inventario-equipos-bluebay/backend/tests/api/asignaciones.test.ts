import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { crearApp } from "../../src/app.ts";
import { crearEmpleado, crearEquipo, db, limpiarTablas } from "../helpers/contexto.ts";

const app = crearApp({ db });
const api = () => request(app);

beforeEach(limpiarTablas);
afterAll(() => db.$disconnect());

// =============================================================================
describe("POST /api/asignaciones (entregar un equipo)", () => {
  it("asigna el equipo y lo deja con su asignación vigente", async () => {
    const equipo = await crearEquipo({ numeroSerie: "DEMO-SN-0005" });
    const empleado = await crearEmpleado({ nombre: "Laura", apellidos: "Méndez Cruz" });

    const res = await api()
      .post("/api/asignaciones")
      .send({ equipoId: equipo.id, empleadoId: empleado.id, observaciones: "Se entrega con cable USB" });
    expect(res.status).toBe(201);
    expect(res.body.asignacion).toMatchObject({ observaciones: "Se entrega con cable USB" });
    expect(res.body.equipo.asignacionVigente.empleado).toMatchObject({ id: empleado.id, nombre: "Laura" });

    const ficha = await api().get(`/api/equipos/${equipo.id}`);
    expect(ficha.body.asignacionVigente.empleado.apellidos).toBe("Méndez Cruz");
    expect(ficha.body.asignaciones).toHaveLength(1);
  });

  it("rechaza asignar un equipo que ya está asignado y dice quién lo tiene", async () => {
    const equipo = await crearEquipo({ numeroSerie: "OCUPADO-1" });
    const primera = await crearEmpleado({ nombre: "Laura", apellidos: "Méndez Cruz" });
    const segunda = await crearEmpleado({ nombre: "Jorge", apellidos: "Ramírez Soto" });
    await api().post("/api/asignaciones").send({ equipoId: equipo.id, empleadoId: primera.id }).expect(201);

    const res = await api().post("/api/asignaciones").send({ equipoId: equipo.id, empleadoId: segunda.id });
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("ASIGNACION_VIGENTE");
    expect(res.body.error.mensaje).toBe(
      "El equipo OCUPADO-1 ya está asignado a Laura Méndez Cruz. Registra la devolución antes de reasignarlo.",
    );
  });

  it.each([
    ["EN_MANTENIMIENTO", "Este equipo está en mantenimiento. Cámbialo a Activo para poder asignarlo."],
    ["BAJA", "Este equipo está dado de baja y ya no se puede asignar."],
  ])("no asigna un equipo en estado %s", async (estado, mensaje) => {
    const equipo = await crearEquipo();
    await db.equipo.update({ where: { id: equipo.id }, data: { estado: estado as "BAJA" } });
    const empleado = await crearEmpleado();

    const res = await api().post("/api/asignaciones").send({ equipoId: equipo.id, empleadoId: empleado.id });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ codigo: "EQUIPO_NO_ASIGNABLE", mensaje });
  });

  it("no asigna equipos a un empleado desactivado", async () => {
    const empleado = await crearEmpleado({ nombre: "Sofía", apellidos: "Díaz Herrera" });
    await db.empleado.update({ where: { id: empleado.id }, data: { activo: false } });
    const res = await api().post("/api/asignaciones").send({ equipoId: (await crearEquipo()).id, empleadoId: empleado.id });
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("EMPLEADO_INACTIVO");
    expect(res.body.error.mensaje).toBe("El registro de Sofía Díaz Herrera está inactivo. Actívalo antes de asignarle un equipo.");
  });

  it("un empleado puede tener varios equipos a la vez", async () => {
    const empleado = await crearEmpleado();
    for (const serie of ["MULTI-1", "MULTI-2", "MULTI-3"]) {
      const equipo = await crearEquipo({ numeroSerie: serie });
      await api().post("/api/asignaciones").send({ equipoId: equipo.id, empleadoId: empleado.id }).expect(201);
    }
    const ficha = await api().get(`/api/empleados/${empleado.id}`);
    expect(ficha.body.equiposAsignados).toBe(3);
  });

  it("valida los datos de entrada", async () => {
    const equipo = await crearEquipo();
    const empleado = await crearEmpleado();
    const faltantes = await api().post("/api/asignaciones").send({});
    expect(faltantes.status).toBe(400);
    expect(faltantes.body.error.campos).toMatchObject({
      equipoId: "Selecciona un equipo.",
      empleadoId: "Selecciona un empleado.",
    });
    const largas = await api()
      .post("/api/asignaciones")
      .send({ equipoId: equipo.id, empleadoId: empleado.id, observaciones: "x".repeat(256) });
    expect(largas.body.error.campos.observaciones).toBe("Máximo 255 caracteres.");
    expect((await api().post("/api/asignaciones").send({ equipoId: 999999, empleadoId: empleado.id })).status).toBe(404);
    expect((await api().post("/api/asignaciones").send({ equipoId: equipo.id, empleadoId: 999999 })).status).toBe(404);
  });
});

// =============================================================================
describe("POST /api/asignaciones/:id/devolucion", () => {
  async function asignar(serie = "DEV-1") {
    const equipo = await crearEquipo({ numeroSerie: serie });
    const empleado = await crearEmpleado();
    const res = await api().post("/api/asignaciones").send({ equipoId: equipo.id, empleadoId: empleado.id }).expect(201);
    return { equipo, empleado, asignacionId: res.body.asignacion.id as number };
  }

  it("registra la devolución, guarda las observaciones y deja el equipo disponible", async () => {
    const { equipo, asignacionId } = await asignar();
    const res = await api()
      .post(`/api/asignaciones/${asignacionId}/devolucion`)
      .send({ observaciones: "Regresa con cargador; pantalla sin daños" });

    expect(res.status).toBe(200);
    expect(res.body.asignacion.observacionesDevolucion).toBe("Regresa con cargador; pantalla sin daños");
    expect(res.body.equipo.asignacionVigente).toBeNull();

    const ficha = await api().get(`/api/equipos/${equipo.id}`);
    expect(ficha.body.asignacionVigente).toBeNull();
    expect(ficha.body.asignaciones[0].fechaDevolucion).not.toBeNull();
  });

  it("la devolución nunca queda antes de la entrega", async () => {
    const { asignacionId } = await asignar("FECHAS-1");
    const res = await api().post(`/api/asignaciones/${asignacionId}/devolucion`).send({});
    const { fechaAsignacion, fechaDevolucion } = res.body.asignacion;
    expect(new Date(fechaDevolucion).getTime()).toBeGreaterThanOrEqual(new Date(fechaAsignacion).getTime());
  });

  it("rechaza devolver dos veces la misma asignación", async () => {
    const { asignacionId } = await asignar("DOBLE-1");
    await api().post(`/api/asignaciones/${asignacionId}/devolucion`).send({}).expect(200);
    const res = await api().post(`/api/asignaciones/${asignacionId}/devolucion`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("ASIGNACION_YA_DEVUELTA");
  });

  it("permite reasignar el equipo después de la devolución y conserva el historial", async () => {
    const { equipo, asignacionId } = await asignar("REASIGNA-1");
    await api().post(`/api/asignaciones/${asignacionId}/devolucion`).send({}).expect(200);
    const nuevo = await crearEmpleado({ nombre: "Mariana", apellidos: "Uc Tzab" });
    await api().post("/api/asignaciones").send({ equipoId: equipo.id, empleadoId: nuevo.id }).expect(201);

    const ficha = await api().get(`/api/equipos/${equipo.id}`);
    expect(ficha.body.asignacionVigente.empleado.nombre).toBe("Mariana");
    expect(ficha.body.asignaciones).toHaveLength(2);
    expect(ficha.body.asignaciones.filter((a: { fechaDevolucion: string | null }) => a.fechaDevolucion === null)).toHaveLength(1);
  });

  it("responde 404 si la asignación no existe", async () => {
    expect((await api().post("/api/asignaciones/999999/devolucion").send({})).status).toBe(404);
  });
});
