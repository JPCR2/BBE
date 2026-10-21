import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { crearApp } from "../../src/app.ts";
import { crearDepartamento, crearEmpleado, crearEquipo, db, limpiarTablas, rechazo, iniciarSesionDePrueba } from "../helpers/contexto.ts";

const app = crearApp({ db });
// Todas las rutas exigen sesión: las pruebas usan un técnico ya autenticado.
const sesion = await iniciarSesionDePrueba(app);
const api = () => sesion;

beforeEach(limpiarTablas);
afterAll(() => db.$disconnect());

const empleadoValido = (departamentoId: number) => ({
  numeroEmpleado: " 1001 ",
  nombre: "Laura",
  apellidos: "Méndez Cruz",
  puesto: "Recepcionista",
  departamentoId,
});

// =============================================================================
describe("Departamentos", () => {
  it("lista en orden alfabético y cuenta solo a los empleados activos", async () => {
    const sistemas = await crearDepartamento("Sistemas");
    await crearDepartamento("Ama de Llaves");
    const inactivo = await crearEmpleado({ departamentoId: sistemas.id });
    await crearEmpleado({ departamentoId: sistemas.id });
    await db.empleado.update({ where: { id: inactivo.id }, data: { activo: false } });

    const res = await api().get("/api/departamentos");
    expect(res.status).toBe(200);
    expect(res.body.datos.map((d: { nombre: string }) => d.nombre)).toEqual(["Ama de Llaves", "Sistemas"]);
    expect(res.body.datos[1]).toMatchObject({ nombre: "Sistemas", empleadosActivos: 1 });
  });

  it("registra un departamento nuevo", async () => {
    const res = await api().post("/api/departamentos").send({ nombre: "  Alimentos y Bebidas " });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ nombre: "Alimentos y Bebidas", empleadosActivos: 0 });
  });

  it("rechaza un nombre repetido aunque cambien acentos o mayúsculas", async () => {
    await api().post("/api/departamentos").send({ nombre: "Recepción" }).expect(201);
    const res = await api().post("/api/departamentos").send({ nombre: "RECEPCION" });
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("DEPARTAMENTO_DUPLICADO");
    expect(res.body.error.campos.nombre).toBe("Ya existe el departamento «Recepción».");
  });

  it("rechaza un nombre vacío y los campos desconocidos", async () => {
    const vacio = await api().post("/api/departamentos").send({ nombre: "   " });
    expect(vacio.status).toBe(400);
    expect(vacio.body.error.campos.nombre).toBe("Escribe el nombre del departamento.");
    const extra = await api().post("/api/departamentos").send({ nombre: "Spa", clave: "SPA" });
    expect(extra.body.error.campos.clave).toBe("Este campo no se puede enviar aquí.");
  });

  it("renombra un departamento, pero no le pone el nombre de otro", async () => {
    const recepcion = await crearDepartamento("Recepción");
    await crearDepartamento("Sistemas");
    const renombrado = await api().patch(`/api/departamentos/${recepcion.id}`).send({ nombre: "Recepción y Concierge" });
    expect(renombrado.body.nombre).toBe("Recepción y Concierge");
    expect((await api().patch(`/api/departamentos/${recepcion.id}`).send({ nombre: "sistemas" })).status).toBe(409);
    expect((await api().patch("/api/departamentos/999999").send({ nombre: "X" })).status).toBe(404);
  });
});

// =============================================================================
describe("POST /api/empleados (alta)", () => {
  it("registra un empleado activo, con su departamento y sin equipos", async () => {
    const departamento = await crearDepartamento("Recepción");
    const res = await api().post("/api/empleados").send(empleadoValido(departamento.id));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      numeroEmpleado: "1001",
      nombre: "Laura",
      activo: true,
      equiposAsignados: 0,
      departamento: { nombre: "Recepción" },
      equiposVigentes: [],
    });
  });

  it("rechaza un número de empleado repetido", async () => {
    const departamento = await crearDepartamento();
    await api().post("/api/empleados").send(empleadoValido(departamento.id)).expect(201);
    const res = await api().post("/api/empleados").send({ ...empleadoValido(departamento.id), numeroEmpleado: "1001" });
    expect(res.status).toBe(409);
    expect(res.body.error.campos.numeroEmpleado).toBe("Ya existe un empleado con el número 1001.");
  });

  it("indica cada campo obligatorio que falta", async () => {
    const res = await api().post("/api/empleados").send({ numeroEmpleado: "  ", nombre: "", apellidos: " ", puesto: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.campos).toMatchObject({
      numeroEmpleado: "Escribe el número de empleado.",
      nombre: "Escribe el nombre.",
      apellidos: "Escribe los apellidos.",
      puesto: "Escribe el puesto.",
      departamentoId: "Selecciona un departamento.",
    });
  });

  it("rechaza un departamento que no existe", async () => {
    const res = await api().post("/api/empleados").send(empleadoValido(999999));
    expect(res.status).toBe(400);
    expect(res.body.error.campos.departamentoId).toBe("El departamento seleccionado no existe.");
  });
});

// =============================================================================
describe("GET /api/empleados (listado y ficha)", () => {
  it("ordena por apellidos, cuenta equipos asignados y trae los conteos de activos e inactivos", async () => {
    const departamento = await crearDepartamento("Sistemas");
    const jorge = await crearEmpleado({ nombre: "Jorge", apellidos: "Ramírez Soto", departamentoId: departamento.id });
    const ana = await crearEmpleado({ nombre: "Ana", apellidos: "Ávila Pool", departamentoId: departamento.id });
    const baja = await crearEmpleado({ nombre: "Sofía", apellidos: "Zuñiga", departamentoId: departamento.id });
    await db.empleado.update({ where: { id: baja.id }, data: { activo: false } });
    await db.asignacion.create({ data: { equipoId: (await crearEquipo()).id, empleadoId: jorge.id } });

    const res = await api().get("/api/empleados");
    expect(res.body.datos.map((e: { id: number }) => e.id)).toEqual([ana.id, jorge.id]);
    expect(res.body.datos[1].equiposAsignados).toBe(1);
    expect(res.body.conteos).toEqual({ activos: 2, inactivos: 1 });
    expect((await api().get("/api/empleados?estado=inactivos")).body.total).toBe(1);
    expect((await api().get("/api/empleados?estado=todos")).body.total).toBe(3);
  });

  it("busca por nombre, apellidos, número de empleado o puesto y filtra por departamento", async () => {
    const sistemas = await crearDepartamento("Sistemas");
    const recepcion = await crearDepartamento("Recepción");
    await crearEmpleado({ numeroEmpleado: "1001", nombre: "Laura", apellidos: "Méndez Cruz", puesto: "Recepcionista", departamentoId: recepcion.id });
    await crearEmpleado({ numeroEmpleado: "1002", nombre: "Jorge", apellidos: "Ramírez Soto", puesto: "Técnico de soporte", departamentoId: sistemas.id });

    const numeros = async (consulta: string) =>
      (await api().get(`/api/empleados?${consulta}`)).body.datos.map((e: { numeroEmpleado: string }) => e.numeroEmpleado);
    expect(await numeros("busqueda=mendez")).toEqual(["1001"]);
    expect(await numeros("busqueda=1002")).toEqual(["1002"]);
    expect(await numeros("busqueda=soporte")).toEqual(["1002"]);
    expect(await numeros("busqueda=jorge ramirez")).toEqual(["1002"]);
    expect(await numeros(`departamentoId=${recepcion.id}`)).toEqual(["1001"]);
    expect(await numeros("busqueda=%")).toEqual([]);
  });

  it("la ficha separa los equipos vigentes del historial completo", async () => {
    const empleado = await crearEmpleado();
    const vigente = await crearEquipo({ numeroSerie: "VIG-1" });
    const devuelto = await crearEquipo({ numeroSerie: "DEV-1" });
    await db.asignacion.create({ data: { equipoId: vigente.id, empleadoId: empleado.id } });
    await db.asignacion.create({
      data: {
        equipoId: devuelto.id,
        empleadoId: empleado.id,
        fechaAsignacion: new Date("2025-01-10T15:00:00Z"),
        fechaDevolucion: new Date("2025-06-10T15:00:00Z"),
      },
    });

    const res = await api().get(`/api/empleados/${empleado.id}`);
    expect(res.body.equiposVigentes.map((a: { equipo: { numeroSerie: string } }) => a.equipo.numeroSerie)).toEqual(["VIG-1"]);
    expect(res.body.historial).toHaveLength(2);
    expect(res.body.equiposAsignados).toBe(1);
  });

  it("responde 404 si el empleado no existe y 400 si el id no es válido", async () => {
    expect((await api().get("/api/empleados/999999")).status).toBe(404);
    expect((await api().get("/api/empleados/abc")).status).toBe(400);
  });
});

// =============================================================================
describe("PATCH /api/empleados/:id (edición y desactivación)", () => {
  it("edita puesto y departamento", async () => {
    const empleado = await crearEmpleado();
    const nuevoDepartamento = await crearDepartamento("Contabilidad");
    const res = await api()
      .patch(`/api/empleados/${empleado.id}`)
      .send({ puesto: "Jefa de Recepción", departamentoId: nuevoDepartamento.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ puesto: "Jefa de Recepción", departamento: { nombre: "Contabilidad" } });
  });

  it("ya no se desactiva con PATCH: la salida se registra con «Dar de baja»", async () => {
    const empleado = await crearEmpleado();
    const res = await api().patch(`/api/empleados/${empleado.id}`).send({ activo: false });
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("USA_DAR_DE_BAJA");
    expect((await db.empleado.findUniqueOrThrow({ where: { id: empleado.id } })).activo).toBe(true);
  });

  it("un registro inactivo de antes (sin baja) se puede reactivar", async () => {
    const empleado = await crearEmpleado();
    await db.empleado.update({ where: { id: empleado.id }, data: { activo: false } });
    expect((await api().patch(`/api/empleados/${empleado.id}`).send({ activo: true })).body.activo).toBe(true);
  });

  it("rechaza una edición vacía, un número repetido y un empleado inexistente", async () => {
    const otro = await crearEmpleado({ numeroEmpleado: "2002" });
    const empleado = await crearEmpleado({ numeroEmpleado: "2001" });
    const vacia = await api().patch(`/api/empleados/${empleado.id}`).send({});
    expect(vacia.body.error.campos._).toBe("Envía al menos un campo para modificar.");
    expect((await api().patch(`/api/empleados/${empleado.id}`).send({ numeroEmpleado: otro.numeroEmpleado })).status).toBe(409);
    expect((await api().patch(`/api/empleados/${empleado.id}`).send({ numeroEmpleado: "2001" })).status).toBe(200);
    expect((await api().patch("/api/empleados/999999").send({ puesto: "X" })).status).toBe(404);
  });
});

// =============================================================================
describe("POST /api/empleados/:id/baja (renuncia, despido…)", () => {
  const baja = (id: number, cuerpo: object) => api().post(`/api/empleados/${id}/baja`).send(cuerpo);
  const valida = { fechaSalida: "2026-09-15", motivo: "RENUNCIA", observaciones: "  Se cambia de ciudad  " };

  it("lo da de baja con fecha y motivo, y borra sus datos personales", async () => {
    const departamento = await crearDepartamento("Recepción");
    const empleado = await crearEmpleado({ numeroEmpleado: "1001", nombre: "Laura", apellidos: "Méndez Cruz", puesto: "Recepcionista", departamentoId: departamento.id });
    const res = await baja(empleado.id, valida);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      nombre: "Ex empleado", apellidos: `#${empleado.id}`, numeroEmpleado: `EX-${empleado.id}`,
      puesto: "Recepcionista", departamento: { nombre: "Recepción" }, activo: false, anonimizado: true,
      salida: { fecha: "2026-09-15", motivo: "RENUNCIA", observaciones: "Se cambia de ciudad" },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/Laura|Méndez|1001/);
    const guardado = await db.empleado.findUniqueOrThrow({ where: { id: empleado.id } });
    expect(guardado.anonimizadoEn).toBeInstanceOf(Date);
  });

  it("conserva su historial de equipos (para auditorías)", async () => {
    const empleado = await crearEmpleado({ nombre: "Carlos" });
    const equipo = await crearEquipo({ numeroSerie: "HIST-1" });
    await db.asignacion.create({ data: { equipoId: equipo.id, empleadoId: empleado.id, fechaAsignacion: new Date("2026-08-01T12:00:00Z"), fechaDevolucion: new Date("2026-09-01T12:00:00Z") } });
    await baja(empleado.id, { fechaSalida: "2026-09-10", motivo: "DESPIDO" }).expect(200);

    const ficha = (await api().get(`/api/empleados/${empleado.id}`)).body;
    expect(ficha.historial).toHaveLength(1);
    expect(ficha.historial[0].equipo.numeroSerie).toBe("HIST-1");
    expect(ficha.puedeEliminar).toBe(false);
    const fichaEquipo = (await api().get(`/api/equipos/${equipo.id}`)).body;
    expect(JSON.stringify(fichaEquipo)).toContain("Ex empleado");
    expect(JSON.stringify(fichaEquipo)).not.toContain("Carlos");
  });

  it("no se puede dar de baja a quien todavía tiene equipos", async () => {
    const empleado = await crearEmpleado();
    const equipo = await crearEquipo();
    await db.asignacion.create({ data: { equipoId: equipo.id, empleadoId: empleado.id } });
    const res = await baja(empleado.id, valida);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ codigo: "EMPLEADO_CON_EQUIPOS" });
    expect(res.body.error.mensaje).toMatch(/1 equipo asignado.*devolución/);
    expect((await db.empleado.findUniqueOrThrow({ where: { id: empleado.id } })).nombre).not.toBe("Ex empleado");
  });

  it("valida la fecha y el motivo", async () => {
    const empleado = await crearEmpleado();
    const sinDatos = await baja(empleado.id, {});
    expect(sinDatos.status).toBe(400);
    expect(Object.keys(sinDatos.body.error.campos).sort()).toEqual(["fechaSalida", "motivo"]);
    expect((await baja(empleado.id, { fechaSalida: "2026-02-30", motivo: "RENUNCIA" })).body.error.campos.fechaSalida).toBeTruthy();
    expect((await baja(empleado.id, { fechaSalida: "2026-09-01", motivo: "VACACIONES" })).body.error.campos.motivo).toMatch(/motivo/);
    const futura = await baja(empleado.id, { fechaSalida: "2026-12-31", motivo: "RENUNCIA" });
    expect(futura.body.error.campos.fechaSalida).toBe("La fecha de salida no puede ser futura.");
    expect((await baja(empleado.id, { ...valida, observaciones: "x".repeat(256) })).body.error.campos.observaciones).toMatch(/255/);
  });

  it("hoy sí se acepta como fecha de salida (con la fecha del hotel)", async () => {
    const empleado = await crearEmpleado();
    // El reloj de estas pruebas es el real; hoy en el hotel nunca es futuro.
    const { hoyEnElHotel } = await import("../../src/lib/fechas.ts");
    expect((await baja(empleado.id, { fechaSalida: hoyEnElHotel(), motivo: "FIN_CONTRATO" })).status).toBe(200);
  });

  it("ya dado de baja: no se puede editar, reactivar, volver a dar de baja ni asignarle equipos", async () => {
    const empleado = await crearEmpleado();
    await baja(empleado.id, valida).expect(200);
    for (const cambio of [{ activo: true }, { nombre: "Laura" }, { puesto: "Otro" }]) {
      const res = await api().patch(`/api/empleados/${empleado.id}`).send(cambio);
      expect(res.status).toBe(409);
      expect(res.body.error.codigo).toBe("EMPLEADO_ANONIMIZADO");
    }
    expect((await baja(empleado.id, valida)).body.error.codigo).toBe("EMPLEADO_YA_DADO_DE_BAJA");
    const equipo = await crearEquipo();
    const asignar = await api().post("/api/asignaciones").send({ equipoId: equipo.id, empleadoId: empleado.id });
    expect(asignar.status).toBe(409);
    expect(asignar.body.error.mensaje).toBe(`Ex empleado #${empleado.id} ya no trabaja en el hotel; no se le pueden asignar equipos.`);
  });

  it("libera su número de empleado: se puede registrar a alguien nuevo con el mismo número", async () => {
    const empleado = await crearEmpleado({ numeroEmpleado: "5005" });
    await baja(empleado.id, valida).expect(200);
    const nuevo = await api().post("/api/empleados").send({ numeroEmpleado: "5005", nombre: "Nuevo", apellidos: "Ingreso", puesto: "Recepcionista", departamentoId: empleado.departamentoId });
    expect(nuevo.status).toBe(201);
  });

  it("aparece entre los inactivos y no entre los activos", async () => {
    const empleado = await crearEmpleado();
    await baja(empleado.id, valida).expect(200);
    expect((await api().get("/api/empleados")).body.datos.map((e: { id: number }) => e.id)).not.toContain(empleado.id);
    const inactivos = (await api().get("/api/empleados?estado=inactivos")).body;
    expect(inactivos.datos[0]).toMatchObject({ id: empleado.id, nombre: "Ex empleado", anonimizado: true });
  });

  it("empleado inexistente o id inválido", async () => {
    expect((await baja(999999, valida)).status).toBe(404);
    expect((await api().post("/api/empleados/abc/baja").send(valida)).status).toBe(400);
  });

  it("la base rechaza datos de salida incompletos o en un empleado activo", async () => {
    const empleado = await crearEmpleado();
    for (const data of [
      { activo: false, fechaSalida: new Date("2026-09-01") },
      { activo: true, fechaSalida: new Date("2026-09-01"), motivoSalida: "RENUNCIA" as const },
      { activo: false, anonimizadoEn: new Date() },
    ]) {
      const error = await rechazo(db.empleado.update({ where: { id: empleado.id }, data }));
      expect(error.message).toMatch(/chk_empleados_(salida_completa|salida_solo_inactivo|anonimizado_con_salida)/);
    }
  });
});

// =============================================================================
describe("DELETE /api/empleados/:id (registrado por error)", () => {
  it("borra a quien nunca tuvo equipos", async () => {
    const empleado = await crearEmpleado();
    expect((await api().get(`/api/empleados/${empleado.id}`)).body.puedeEliminar).toBe(true);
    expect((await api().delete(`/api/empleados/${empleado.id}`)).status).toBe(204);
    expect(await db.empleado.findUnique({ where: { id: empleado.id } })).toBeNull();
    expect((await api().get(`/api/empleados/${empleado.id}`)).status).toBe(404);
  });

  it("no borra a quien tiene historial, aunque ya haya devuelto todo", async () => {
    const empleado = await crearEmpleado();
    const equipo = await crearEquipo();
    await db.asignacion.create({ data: { equipoId: equipo.id, empleadoId: empleado.id, fechaAsignacion: new Date("2026-08-01T12:00:00Z"), fechaDevolucion: new Date("2026-09-01T12:00:00Z") } });
    const res = await api().delete(`/api/empleados/${empleado.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("EMPLEADO_CON_HISTORIAL");
    expect(await db.empleado.findUnique({ where: { id: empleado.id } })).not.toBeNull();
  });

  it("empleado inexistente o id inválido", async () => {
    expect((await api().delete("/api/empleados/999999")).status).toBe(404);
    expect((await api().delete("/api/empleados/abc")).status).toBe(400);
  });
});
