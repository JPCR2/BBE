import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { crearApp } from "../../src/app.ts";
import { crearDepartamento, crearEmpleado, crearEquipo, db, limpiarTablas, iniciarSesionDePrueba } from "../helpers/contexto.ts";

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

  it("no permite desactivar a quien todavía tiene equipos, y sí después de la devolución", async () => {
    const empleado = await crearEmpleado();
    const equipo = await crearEquipo();
    const asignacion = await db.asignacion.create({ data: { equipoId: equipo.id, empleadoId: empleado.id } });

    const bloqueado = await api().patch(`/api/empleados/${empleado.id}`).send({ activo: false });
    expect(bloqueado.status).toBe(409);
    expect(bloqueado.body.error.codigo).toBe("EMPLEADO_CON_EQUIPOS");
    expect(bloqueado.body.error.mensaje).toMatch(/1 equipo asignado/);

    await api().post(`/api/asignaciones/${asignacion.id}/devolucion`).send({}).expect(200);
    const desactivado = await api().patch(`/api/empleados/${empleado.id}`).send({ activo: false });
    expect(desactivado.status).toBe(200);
    expect(desactivado.body.activo).toBe(false);
    // Se puede volver a activar.
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
