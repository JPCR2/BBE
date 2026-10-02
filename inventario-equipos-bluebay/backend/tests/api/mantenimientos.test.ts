import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { crearApp } from "../../src/app.ts";
import { fechaDesdeTexto } from "../../src/lib/fechas.ts";
import { crearEquipo, db, limpiarTablas } from "../helpers/contexto.ts";

// "Ahora" fijo: 22 de septiembre de 2026 a las 11:30 de la mañana en Playa del Carmen.
let ahora = new Date("2026-09-22T16:30:00Z");
const app = crearApp({ db, reloj: () => ahora });
const api = () => request(app);

beforeEach(async () => {
  ahora = new Date("2026-09-22T16:30:00Z");
  await limpiarTablas();
});
afterAll(() => db.$disconnect());

/** Crea un mantenimiento directo en la base (sin pasar por las reglas de la API). */
async function mantenimientoEnBase(
  equipoId: number,
  datos: Partial<{ estado: "PROGRAMADO" | "REALIZADO" | "CANCELADO"; tipo: "PREVENTIVO" | "CORRECTIVO"; fechaProgramada: string; fechaRealizacion: string; descripcion: string }>,
) {
  const { fechaProgramada, fechaRealizacion, ...resto } = datos;
  return db.mantenimiento.create({
    data: {
      equipoId,
      tipo: "PREVENTIVO",
      descripcion: "Limpieza interna",
      ...resto,
      fechaProgramada: fechaProgramada ? fechaDesdeTexto(fechaProgramada) : null,
      fechaRealizacion: fechaRealizacion ? fechaDesdeTexto(fechaRealizacion) : null,
    },
  });
}

// =============================================================================
describe("POST /api/mantenimientos (programar)", () => {
  it("programa un mantenimiento y lo devuelve con su situación", async () => {
    const equipo = await crearEquipo({ numeroSerie: "DEMO-SN-0001" });
    const res = await api().post("/api/mantenimientos").send({
      equipoId: equipo.id,
      tipo: "PREVENTIVO",
      fechaProgramada: "2026-10-15",
      descripcion: "  Limpieza interna y revisión de ventiladores  ",
      responsable: "Sistemas",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      estado: "PROGRAMADO",
      situacion: "PROGRAMADO",
      fechaProgramada: "2026-10-15",
      fechaRealizacion: null,
      fecha: "2026-10-15",
      diasRestantes: 23,
      descripcion: "Limpieza interna y revisión de ventiladores",
      responsable: "Sistemas",
      equipo: { id: equipo.id, numeroSerie: "DEMO-SN-0001" },
    });
  });

  it("si no se indica el estado, lo programa", async () => {
    const equipo = await crearEquipo();
    const res = await api().post("/api/mantenimientos").send({ equipoId: equipo.id, tipo: "CORRECTIVO", fechaProgramada: "2026-09-25", descripcion: "Cambio de teclado" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ estado: "PROGRAMADO", situacion: "PROXIMO", diasRestantes: 3, responsable: null });
  });

  it("acepta programarlo para hoy (queda como próximo, faltan 0 días)", async () => {
    const equipo = await crearEquipo();
    const res = await api().post("/api/mantenimientos").send({ equipoId: equipo.id, tipo: "PREVENTIVO", fechaProgramada: "2026-09-22", descripcion: "Hoy" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ situacion: "PROXIMO", diasRestantes: 0 });
  });

  it("marca los campos que faltan", async () => {
    const res = await api().post("/api/mantenimientos").send({});
    expect(res.status).toBe(400);
    expect(res.body.error.campos).toMatchObject({
      equipoId: "Selecciona un equipo.",
      tipo: "Selecciona si es preventivo o correctivo.",
      descripcion: "Describe qué se hará o qué se hizo.",
      fechaProgramada: "Elige la fecha programada.",
    });
  });

  it.each([
    ["descripción solo con espacios", { descripcion: "   " }, "descripcion", "Describe qué se hará o qué se hizo."],
    ["30 de febrero", { fechaProgramada: "2027-02-30" }, "fechaProgramada", "ese día no existe en el calendario"],
    ["fecha con otro formato", { fechaProgramada: "15/10/2026" }, "fechaProgramada", "se esperaba el formato AAAA-MM-DD"],
    ["fecha pasada", { fechaProgramada: "2026-09-21" }, "fechaProgramada", "no puede ser anterior a hoy"],
    ["tipo inválido", { tipo: "URGENTE" }, "tipo", "Selecciona si es preventivo o correctivo."],
    ["estado que no se puede crear", { estado: "CANCELADO" }, "estado", "PROGRAMADO"],
    ["descripción demasiado larga", { descripcion: "x".repeat(2001) }, "descripcion", "Máximo 2000 caracteres."],
    ["campo desconocido", { costo: 500 }, "costo", "Este campo no se puede enviar aquí."],
    ["fecha de realización al programar", { fechaRealizacion: "2026-09-01" }, "fechaRealizacion", "Este campo no se puede enviar aquí."],
  ])("rechaza %s", async (_caso, cambios, campo, mensaje) => {
    const equipo = await crearEquipo();
    const res = await api()
      .post("/api/mantenimientos")
      .send({ equipoId: equipo.id, tipo: "PREVENTIVO", fechaProgramada: "2026-10-01", descripcion: "Limpieza", ...cambios });
    expect(res.status).toBe(400);
    expect(res.body.error.campos[campo]).toContain(mensaje);
    expect(await db.mantenimiento.count()).toBe(0);
  });

  it("responde 404 si el equipo no existe", async () => {
    const res = await api().post("/api/mantenimientos").send({ equipoId: 999999, tipo: "PREVENTIVO", fechaProgramada: "2026-10-01", descripcion: "X" });
    expect(res.status).toBe(404);
  });

  it("no admite mantenimientos nuevos para un equipo dado de baja", async () => {
    const equipo = await crearEquipo({ numeroSerie: "VIEJO-1" });
    await db.equipo.update({ where: { id: equipo.id }, data: { estado: "BAJA" } });
    const res = await api().post("/api/mantenimientos").send({ equipoId: equipo.id, tipo: "PREVENTIVO", fechaProgramada: "2026-10-01", descripcion: "X" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      codigo: "EQUIPO_DADO_DE_BAJA",
      mensaje: "El equipo VIEJO-1 está dado de baja y ya no admite mantenimientos nuevos.",
    });
  });

  it("programar no cambia el estado del equipo (se cambia a mano)", async () => {
    const equipo = await crearEquipo();
    await api().post("/api/mantenimientos").send({ equipoId: equipo.id, tipo: "CORRECTIVO", fechaProgramada: "2026-09-22", descripcion: "X" }).expect(201);
    expect((await db.equipo.findUniqueOrThrow({ where: { id: equipo.id } })).estado).toBe("ACTIVO");
  });
});

// =============================================================================
describe("POST /api/mantenimientos con estado REALIZADO (registrar uno que ya se hizo)", () => {
  it("registra un correctivo que se atendió en el momento, sin fecha programada", async () => {
    const equipo = await crearEquipo();
    const res = await api().post("/api/mantenimientos").send({
      estado: "REALIZADO", equipoId: equipo.id, tipo: "CORRECTIVO", fechaRealizacion: "2026-09-22", descripcion: "Se reemplazó el cable de red", responsable: "Joel",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ estado: "REALIZADO", situacion: "REALIZADO", fechaProgramada: null, fechaRealizacion: "2026-09-22", fecha: "2026-09-22", diasRestantes: null });
  });

  it.each([
    ["fecha futura", { fechaRealizacion: "2026-09-23" }, "fechaRealizacion", "no puede ser futura"],
    ["sin fecha", { fechaRealizacion: undefined }, "fechaRealizacion", "Elige la fecha en que se realizó."],
    ["fecha inexistente", { fechaRealizacion: "2026-04-31" }, "fechaRealizacion", "ese día no existe"],
    ["con fecha programada", { fechaProgramada: "2026-09-01" }, "fechaProgramada", "Este campo no se puede enviar aquí."],
  ])("rechaza %s", async (_caso, cambios, campo, mensaje) => {
    const equipo = await crearEquipo();
    const res = await api()
      .post("/api/mantenimientos")
      .send({ estado: "REALIZADO", equipoId: equipo.id, tipo: "CORRECTIVO", fechaRealizacion: "2026-09-20", descripcion: "X", ...cambios });
    expect(res.status).toBe(400);
    expect(res.body.error.campos[campo]).toContain(mensaje);
  });
});

// =============================================================================
describe("GET /api/mantenimientos/avisos (dashboard)", () => {
  it("separa vencidos y próximos con el límite exacto de 7 días", async () => {
    const equipo = await crearEquipo();
    const otro = await crearEquipo();
    const ayer = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-21", descripcion: "Ayer" });
    const hace30 = await mantenimientoEnBase(otro.id, { estado: "PROGRAMADO", fechaProgramada: "2026-08-23", descripcion: "Hace 30 días" });
    const hoy = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-22", descripcion: "Hoy" });
    const dia7 = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-29", descripcion: "Día 7" });
    await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-30", descripcion: "Día 8: todavía no avisa" });
    await mantenimientoEnBase(equipo.id, { estado: "REALIZADO", fechaProgramada: "2026-09-20", fechaRealizacion: "2026-09-20", descripcion: "Ya hecho" });
    await mantenimientoEnBase(equipo.id, { estado: "CANCELADO", fechaProgramada: "2026-09-20", descripcion: "Cancelado" });

    const res = await api().get("/api/mantenimientos/avisos");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hoy: "2026-09-22", diasAviso: 7, total: 4 });
    expect(res.body.vencidos.map((m: { id: number }) => m.id)).toEqual([hace30.id, ayer.id]);
    expect(res.body.vencidos[0].diasRestantes).toBe(-30);
    expect(res.body.proximos.map((m: { id: number }) => m.id)).toEqual([hoy.id, dia7.id]);
    expect(res.body.proximos[1].diasRestantes).toBe(7);
  });

  it("no avisa de equipos dados de baja", async () => {
    const equipo = await crearEquipo();
    await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-10" });
    await db.equipo.update({ where: { id: equipo.id }, data: { estado: "BAJA" } });
    const res = await api().get("/api/mantenimientos/avisos");
    expect(res.body.total).toBe(0);
  });

  it("usa el día de Quintana Roo: a las 23:30 del día 22 aún no vence lo del 22", async () => {
    const equipo = await crearEquipo();
    await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-22" });

    ahora = new Date("2026-09-23T04:30:00Z"); // en UTC ya es 23, en el hotel son las 23:30 del 22
    let res = await api().get("/api/mantenimientos/avisos");
    expect(res.body.hoy).toBe("2026-09-22");
    expect(res.body.proximos).toHaveLength(1);
    expect(res.body.vencidos).toHaveLength(0);

    ahora = new Date("2026-09-23T05:00:00Z"); // medianoche en el hotel
    res = await api().get("/api/mantenimientos/avisos");
    expect(res.body.hoy).toBe("2026-09-23");
    expect(res.body.vencidos).toHaveLength(1);
    expect(res.body.vencidos[0].diasRestantes).toBe(-1);
  });
});

// =============================================================================
describe("GET /api/mantenimientos/calendario", () => {
  it("devuelve lo del mes ordenado por la fecha con que aparece", async () => {
    const equipo = await crearEquipo();
    const programado = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-28" });
    const correctivo = await mantenimientoEnBase(equipo.id, { estado: "REALIZADO", tipo: "CORRECTIVO", fechaRealizacion: "2026-09-03" });
    // Estaba programado para agosto pero se hizo en septiembre: aparece el día que se hizo.
    const atrasado = await mantenimientoEnBase(equipo.id, { estado: "REALIZADO", fechaProgramada: "2026-08-30", fechaRealizacion: "2026-09-02" });
    const cancelado = await mantenimientoEnBase(equipo.id, { estado: "CANCELADO", fechaProgramada: "2026-09-15" });
    // Fuera de la cuadrícula (31/08 al 04/10): no aparecen.
    await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-10-05" });
    await mantenimientoEnBase(equipo.id, { estado: "REALIZADO", fechaProgramada: "2026-09-30", fechaRealizacion: "2026-10-05" });

    const res = await api().get("/api/mantenimientos/calendario").query({ mes: "2026-09" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mes: "2026-09", desde: "2026-08-31", hasta: "2026-10-04" });
    expect(res.body.datos.map((m: { id: number; fecha: string }) => [m.id, m.fecha])).toEqual([
      [atrasado.id, "2026-09-02"],
      [correctivo.id, "2026-09-03"],
      [cancelado.id, "2026-09-15"],
      [programado.id, "2026-09-28"],
    ]);
  });

  it("incluye los días de los meses vecinos que se ven en la cuadrícula", async () => {
    const equipo = await crearEquipo();
    const finDeAgosto = await mantenimientoEnBase(equipo.id, { estado: "REALIZADO", fechaRealizacion: "2026-08-31" });
    const octubre = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-10-01" });
    const ultimoVisible = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-10-04" });
    await mantenimientoEnBase(equipo.id, { estado: "REALIZADO", fechaRealizacion: "2026-08-30" });
    const res = await api().get("/api/mantenimientos/calendario").query({ mes: "2026-09" });
    expect(res.body.datos.map((m: { id: number }) => m.id)).toEqual([finDeAgosto.id, octubre.id, ultimoVisible.id]);
  });

  it("sin parámetro muestra el mes actual del hotel", async () => {
    ahora = new Date("2026-10-01T03:00:00Z"); // 30 de septiembre, 22:00 en el hotel
    const res = await api().get("/api/mantenimientos/calendario");
    expect(res.body).toMatchObject({ mes: "2026-09", hoy: "2026-09-30", datos: [] });
  });

  it("en diciembre cruza al año siguiente solo lo que se ve en la cuadrícula", async () => {
    const equipo = await crearEquipo();
    for (const fecha of ["2026-11-29", "2026-11-30", "2026-12-31", "2027-01-03", "2027-01-04"]) {
      await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: fecha });
    }
    const res = await api().get("/api/mantenimientos/calendario?mes=2026-12");
    expect(res.body).toMatchObject({ desde: "2026-11-30", hasta: "2027-01-03" });
    expect(res.body.datos.map((m: { fecha: string }) => m.fecha)).toEqual(["2026-11-30", "2026-12-31", "2027-01-03"]);
  });

  it("un mes que empieza en lunes y cabe en 4 semanas no agrega días extra", async () => {
    // Febrero de 2027 empieza en lunes y tiene 28 días.
    const res = await api().get("/api/mantenimientos/calendario?mes=2027-02");
    expect(res.body).toMatchObject({ desde: "2027-02-01", hasta: "2027-02-28" });
  });

  it.each(["2026-13", "2026-9", "septiembre", "1800-01"])("rechaza el mes %s", async (mes) => {
    const res = await api().get("/api/mantenimientos/calendario").query({ mes });
    expect(res.status).toBe(400);
    expect(res.body.error.campos.mes).toBeDefined();
  });
});

// =============================================================================
describe("POST /api/mantenimientos/:id/realizado", () => {
  it("lo cierra con la fecha de hoy si no se indica otra", async () => {
    const equipo = await crearEquipo();
    const m = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-20" });
    const res = await api().post(`/api/mantenimientos/${m.id}/realizado`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: "REALIZADO", situacion: "REALIZADO", fechaProgramada: "2026-09-20", fechaRealizacion: "2026-09-22", diasRestantes: null });
  });

  it("también funciona sin cuerpo en la petición", async () => {
    const equipo = await crearEquipo();
    const m = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-20" });
    expect((await api().post(`/api/mantenimientos/${m.id}/realizado`)).status).toBe(200);
  });

  it("guarda quién lo hizo y lo que realmente se hizo", async () => {
    const equipo = await crearEquipo();
    const m = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-25", descripcion: "Revisar ventiladores" });
    const res = await api()
      .post(`/api/mantenimientos/${m.id}/realizado`)
      .send({ fechaRealizacion: "2026-09-21", responsable: "Joel Polanco", descripcion: "Se limpiaron y se cambió la pasta térmica" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fechaRealizacion: "2026-09-21", responsable: "Joel Polanco", descripcion: "Se limpiaron y se cambió la pasta térmica" });
  });

  it("conserva la descripción original si no se envía otra", async () => {
    const equipo = await crearEquipo();
    const m = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-25", descripcion: "Revisar ventiladores" });
    const res = await api().post(`/api/mantenimientos/${m.id}/realizado`).send({ descripcion: "  " });
    expect(res.body.descripcion).toBe("Revisar ventiladores");
  });

  it("no se registra dos veces el mismo mantenimiento", async () => {
    const equipo = await crearEquipo();
    const m = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-20" });
    await api().post(`/api/mantenimientos/${m.id}/realizado`).send({}).expect(200);
    const res = await api().post(`/api/mantenimientos/${m.id}/realizado`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ codigo: "MANTENIMIENTO_YA_REALIZADO", mensaje: "Este mantenimiento ya está registrado como realizado." });
  });

  it("no registra como realizado uno cancelado", async () => {
    const equipo = await crearEquipo();
    const m = await mantenimientoEnBase(equipo.id, { estado: "CANCELADO", fechaProgramada: "2026-09-20" });
    const res = await api().post(`/api/mantenimientos/${m.id}/realizado`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("MANTENIMIENTO_CANCELADO");
  });

  it.each([
    ["futura", "2026-09-23", "no puede ser futura"],
    ["inexistente", "2026-02-29", "ese día no existe"],
  ])("rechaza una fecha de realización %s", async (_caso, fechaRealizacion, mensaje) => {
    const equipo = await crearEquipo();
    const m = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-20" });
    const res = await api().post(`/api/mantenimientos/${m.id}/realizado`).send({ fechaRealizacion });
    expect(res.status).toBe(400);
    expect(res.body.error.campos.fechaRealizacion).toContain(mensaje);
    expect((await db.mantenimiento.findUniqueOrThrow({ where: { id: m.id } })).estado).toBe("PROGRAMADO");
  });

  it("responde 404 si no existe y 400 si el id no es número", async () => {
    expect((await api().post("/api/mantenimientos/999999/realizado").send({})).status).toBe(404);
    expect((await api().post("/api/mantenimientos/abc/realizado").send({})).status).toBe(400);
  });
});

// =============================================================================
describe("PATCH /api/mantenimientos/:id (reprogramar o corregir)", () => {
  it("cambia la fecha y la situación se recalcula", async () => {
    const equipo = await crearEquipo();
    const m = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-10" });
    const res = await api().patch(`/api/mantenimientos/${m.id}`).send({ fechaProgramada: "2026-09-24" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fechaProgramada: "2026-09-24", situacion: "PROXIMO", diasRestantes: 2 });
  });

  it("corrige tipo, descripción y responsable sin tocar la fecha", async () => {
    const equipo = await crearEquipo();
    const m = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-10" });
    const res = await api().patch(`/api/mantenimientos/${m.id}`).send({ tipo: "CORRECTIVO", descripcion: "Cambiar disco", responsable: "" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tipo: "CORRECTIVO", descripcion: "Cambiar disco", responsable: null, fechaProgramada: "2026-09-10", situacion: "VENCIDO" });
  });

  it.each([
    ["sin cambios", {}, "_", "Envía al menos un campo"],
    ["fecha pasada", { fechaProgramada: "2026-09-01" }, "fechaProgramada", "no puede ser anterior a hoy"],
    ["fecha inexistente", { fechaProgramada: "2026-11-31" }, "fechaProgramada", "ese día no existe"],
    ["cambiar el estado por aquí", { estado: "REALIZADO" }, "estado", "Este campo no se puede enviar aquí."],
  ])("rechaza %s", async (_caso, cambios, campo, mensaje) => {
    const equipo = await crearEquipo();
    const m = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-10" });
    const res = await api().patch(`/api/mantenimientos/${m.id}`).send(cambios);
    expect(res.status).toBe(400);
    expect(res.body.error.campos[campo]).toContain(mensaje);
  });

  it("no reprograma uno ya realizado", async () => {
    const equipo = await crearEquipo();
    const m = await mantenimientoEnBase(equipo.id, { estado: "REALIZADO", fechaRealizacion: "2026-09-01" });
    const res = await api().patch(`/api/mantenimientos/${m.id}`).send({ fechaProgramada: "2026-10-01" });
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("MANTENIMIENTO_YA_REALIZADO");
  });

  it("no reprograma el de un equipo dado de baja", async () => {
    const equipo = await crearEquipo();
    const m = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-10" });
    await db.equipo.update({ where: { id: equipo.id }, data: { estado: "BAJA" } });
    const res = await api().patch(`/api/mantenimientos/${m.id}`).send({ fechaProgramada: "2026-10-01" });
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("EQUIPO_DADO_DE_BAJA");
  });
});

// =============================================================================
describe("POST /api/mantenimientos/:id/cancelacion", () => {
  it("lo cancela y se conserva en el historial", async () => {
    const equipo = await crearEquipo();
    const m = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-25" });
    const res = await api().post(`/api/mantenimientos/${m.id}/cancelacion`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: "CANCELADO", situacion: "CANCELADO", diasRestantes: null });
    const historial = await api().get("/api/mantenimientos").query({ equipoId: equipo.id });
    expect(historial.body.datos[0]).toMatchObject({ id: m.id, estado: "CANCELADO" });
    expect((await api().get("/api/mantenimientos/avisos")).body.total).toBe(0);
  });

  it("no cancela dos veces ni cancela uno realizado", async () => {
    const equipo = await crearEquipo();
    const m = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-25" });
    await api().post(`/api/mantenimientos/${m.id}/cancelacion`).expect(200);
    expect((await api().post(`/api/mantenimientos/${m.id}/cancelacion`)).body.error.codigo).toBe("MANTENIMIENTO_CANCELADO");
    const hecho = await mantenimientoEnBase(equipo.id, { estado: "REALIZADO", fechaRealizacion: "2026-09-01" });
    const res = await api().post(`/api/mantenimientos/${hecho.id}/cancelacion`);
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("MANTENIMIENTO_YA_REALIZADO");
  });
});

// =============================================================================
describe("GET /api/mantenimientos (historial)", () => {
  async function preparar() {
    const laptop = await crearEquipo({ numeroSerie: "LAP-100" });
    const impresora = await crearEquipo({ numeroSerie: "IMP_200" });
    const a = await mantenimientoEnBase(laptop.id, { estado: "PROGRAMADO", fechaProgramada: "2026-10-01" });
    const b = await mantenimientoEnBase(laptop.id, { estado: "REALIZADO", tipo: "CORRECTIVO", fechaRealizacion: "2026-08-01" });
    const c = await mantenimientoEnBase(impresora.id, { estado: "REALIZADO", fechaProgramada: "2026-09-01", fechaRealizacion: "2026-09-02" });
    const d = await mantenimientoEnBase(impresora.id, { estado: "CANCELADO", fechaProgramada: "2026-09-05" });
    return { laptop, impresora, a, b, c, d };
  }

  it("ordena: programados, realizados (recientes primero) y cancelados", async () => {
    const { a, b, c, d } = await preparar();
    const res = await api().get("/api/mantenimientos");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(res.body.datos.map((m: { id: number }) => m.id)).toEqual([a.id, c.id, b.id, d.id]);
  });

  it("filtra por estado, tipo y equipo", async () => {
    const { laptop, b } = await preparar();
    expect((await api().get("/api/mantenimientos?estado=REALIZADO")).body.total).toBe(2);
    expect((await api().get("/api/mantenimientos?tipo=CORRECTIVO")).body.datos.map((m: { id: number }) => m.id)).toEqual([b.id]);
    expect((await api().get(`/api/mantenimientos?equipoId=${laptop.id}`)).body.total).toBe(2);
  });

  it("busca por número de serie sin importar mayúsculas y trata _ y % como texto", async () => {
    await preparar();
    expect((await api().get("/api/mantenimientos?busqueda=lap")).body.total).toBe(2);
    expect((await api().get("/api/mantenimientos?busqueda=imp_")).body.total).toBe(2);
    expect((await api().get("/api/mantenimientos?busqueda=LAP_")).body.total).toBe(0);
    expect((await api().get("/api/mantenimientos?busqueda=%25")).body.total).toBe(0);
  });

  it("pagina los resultados", async () => {
    await preparar();
    const res = await api().get("/api/mantenimientos?porPagina=3&pagina=2");
    expect(res.body).toMatchObject({ total: 4, pagina: 2, porPagina: 3 });
    expect(res.body.datos).toHaveLength(1);
  });

  it.each([["estado=VENCIDO", "estado"], ["pagina=0", "pagina"], ["porPagina=500", "porPagina"], ["tipo=X", "tipo"]])(
    "rechaza el filtro %s",
    async (consulta, campo) => {
      const res = await api().get(`/api/mantenimientos?${consulta}`);
      expect(res.status).toBe(400);
      expect(res.body.error.campos[campo]).toBeDefined();
    },
  );

  it("GET /:id devuelve uno o 404", async () => {
    const { a } = await preparar();
    expect((await api().get(`/api/mantenimientos/${a.id}`)).body).toMatchObject({ id: a.id, equipo: { numeroSerie: "LAP-100" } });
    expect((await api().get("/api/mantenimientos/999999")).status).toBe(404);
  });
});

// =============================================================================
describe("Mantenimiento en el inventario y en la ficha del equipo", () => {
  it("el listado indica el aviso más urgente de cada equipo", async () => {
    const vencido = await crearEquipo({ numeroSerie: "A-VENCIDO" });
    const proximo = await crearEquipo({ numeroSerie: "B-PROXIMO" });
    const lejano = await crearEquipo({ numeroSerie: "C-LEJANO" });
    await mantenimientoEnBase(vencido.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-25" });
    await mantenimientoEnBase(vencido.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-15" });
    await mantenimientoEnBase(proximo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-09-29" });
    await mantenimientoEnBase(lejano.id, { estado: "PROGRAMADO", fechaProgramada: "2026-12-01" });

    const res = await api().get("/api/equipos");
    const avisos = Object.fromEntries(res.body.datos.map((e: { numeroSerie: string; avisoMantenimiento: unknown }) => [e.numeroSerie, e.avisoMantenimiento]));
    expect(avisos).toEqual({
      "A-VENCIDO": { situacion: "VENCIDO", fecha: "2026-09-15" },
      "B-PROXIMO": { situacion: "PROXIMO", fecha: "2026-09-29" },
      "C-LEJANO": null,
    });
  });

  it("la ficha lista sus mantenimientos del más reciente al más antiguo, con su situación", async () => {
    const equipo = await crearEquipo();
    const correctivo = await mantenimientoEnBase(equipo.id, { estado: "REALIZADO", tipo: "CORRECTIVO", fechaRealizacion: "2026-09-10" });
    const futuro = await mantenimientoEnBase(equipo.id, { estado: "PROGRAMADO", fechaProgramada: "2026-11-01" });
    const viejo = await mantenimientoEnBase(equipo.id, { estado: "REALIZADO", fechaProgramada: "2026-01-10", fechaRealizacion: "2026-01-12" });
    const res = await api().get(`/api/equipos/${equipo.id}`);
    expect(res.body.mantenimientos.map((m: { id: number; situacion: string }) => [m.id, m.situacion])).toEqual([
      [futuro.id, "PROGRAMADO"],
      [correctivo.id, "REALIZADO"],
      [viejo.id, "REALIZADO"],
    ]);
  });
});
