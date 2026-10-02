import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { crearApp } from "../../src/app.ts";
import { fechaATexto, fechaDesdeTexto, hoyEnElHotel, sumarDias } from "../../src/lib/fechas.ts";
import { crearEmpleado, crearEquipo, db, limpiarTablas } from "../helpers/contexto.ts";

const app = crearApp({ db });
const api = () => request(app);

beforeEach(limpiarTablas);
afterAll(() => db.$disconnect());

const equipoValido = {
  numeroSerie: "demo sn 0100",
  tipo: "LAPTOP",
  marca: "Dell",
  modelo: "Latitude 5440",
  folioFactura: "FAC-100",
  fechaVencimientoGarantia: "2029-01-01",
};

/** Crea un equipo con una asignación vigente. */
async function equipoAsignado(numeroSerie: string, marca = "HP", modelo = "ProDesk") {
  const equipo = await crearEquipo({ numeroSerie, marca, modelo });
  const empleado = await crearEmpleado();
  await db.asignacion.create({ data: { equipoId: equipo.id, empleadoId: empleado.id } });
  return { equipo, empleado };
}

// =============================================================================
describe("POST /api/equipos (alta)", () => {
  it("registra un equipo con los datos mínimos: 201, serie normalizada y estado ACTIVO", async () => {
    const res = await api().post("/api/equipos").send(equipoValido);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      numeroSerie: "DEMOSN0100",
      estado: "ACTIVO",
      asignacionVigente: null,
      costo: null,
      fechaAdquisicion: null,
      asignaciones: [],
    });
  });

  it("registra todos los campos y devuelve costo y fecha en formato estable", async () => {
    const res = await api().post("/api/equipos").send({
      ...equipoValido,
      ubicacion: "  Recepción ",
      especificaciones: "Core i5, 16 GB RAM",
      fechaAdquisicion: "2023-03-15",
      costo: "21,500.5",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ubicacion: "Recepción", fechaAdquisicion: "2023-03-15", costo: "21500.50" });
    expect(res.body.tiempoFuncionamiento.anios).toBeGreaterThanOrEqual(3);
  });

  it("convierte campos opcionales vacíos en nulos", async () => {
    const res = await api().post("/api/equipos").send({ ...equipoValido, ubicacion: "   ", costo: "", fechaAdquisicion: "" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ubicacion: null, costo: null, fechaAdquisicion: null });
  });

  it("rechaza un número de serie repetido (409) aunque se escriba distinto", async () => {
    await api().post("/api/equipos").send(equipoValido).expect(201);
    const res = await api().post("/api/equipos").send({ ...equipoValido, numeroSerie: " DEMOSN0100 " });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ codigo: "NUMERO_SERIE_DUPLICADO" });
    expect(res.body.error.campos.numeroSerie).toBe("Ya existe un equipo con el número de serie DEMOSN0100.");
  });

  it("indica cada campo obligatorio que falta (400)", async () => {
    const res = await api().post("/api/equipos").send({ numeroSerie: "   ", marca: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe("DATOS_INVALIDOS");
    expect(res.body.error.campos).toMatchObject({
      numeroSerie: "Escribe el número de serie.",
      tipo: "Selecciona un tipo de equipo válido.",
      marca: "Escribe la marca.",
      modelo: "Escribe el modelo.",
    });
  });

  it("rechaza un tipo de equipo que no existe", async () => {
    const res = await api().post("/api/equipos").send({ ...equipoValido, tipo: "TABLET" });
    expect(res.status).toBe(400);
    expect(res.body.error.campos.tipo).toBe("Selecciona un tipo de equipo válido.");
  });

  it.each([
    ["2026-02-30", /no existe/],
    ["15/03/2023", /AAAA-MM-DD/],
    ["2023-3-5", /AAAA-MM-DD/],
  ])("rechaza la fecha de adquisición %s", async (fecha, mensaje) => {
    const res = await api().post("/api/equipos").send({ ...equipoValido, fechaAdquisicion: fecha });
    expect(res.status).toBe(400);
    expect(res.body.error.campos.fechaAdquisicion).toMatch(mensaje);
  });

  it("rechaza una fecha de adquisición futura y acepta la de hoy", async () => {
    const hoy = fechaDesdeTexto(hoyEnElHotel());
    const manana = fechaATexto(sumarDias(hoy, 1));
    const futura = await api().post("/api/equipos").send({ ...equipoValido, fechaAdquisicion: manana });
    expect(futura.status).toBe(400);
    expect(futura.body.error.campos.fechaAdquisicion).toBe("La fecha de adquisición no puede ser futura.");
    await api().post("/api/equipos").send({ ...equipoValido, fechaAdquisicion: fechaATexto(hoy) }).expect(201);
  });

  it.each([
    ["-10", "El costo no puede ser negativo."],
    ["10.555", /hasta 8 enteros y 2 decimales/],
    ["mil pesos", /hasta 8 enteros y 2 decimales/],
    ["100000000", /hasta 8 enteros y 2 decimales/],
  ])("rechaza el costo %s", async (costo, mensaje) => {
    const res = await api().post("/api/equipos").send({ ...equipoValido, costo });
    expect(res.status).toBe(400);
    expect(res.body.error.campos.costo).toMatch(mensaje);
  });

  it("rechaza textos que exceden el máximo", async () => {
    const res = await api().post("/api/equipos").send({ ...equipoValido, marca: "x".repeat(81) });
    expect(res.status).toBe(400);
    expect(res.body.error.campos.marca).toBe("Máximo 80 caracteres.");
  });

  it("no permite fijar el estado ni campos desconocidos al registrar", async () => {
    const res = await api().post("/api/equipos").send({ ...equipoValido, estado: "BAJA", color: "negro" });
    expect(res.status).toBe(400);
    expect(res.body.error.campos).toMatchObject({
      estado: "Este campo no se puede enviar aquí.",
      color: "Este campo no se puede enviar aquí.",
    });
  });

  it("responde 400 si el cuerpo no es JSON válido", async () => {
    const res = await api().post("/api/equipos").set("Content-Type", "application/json").send("{ serie: ");
    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe("JSON_INVALIDO");
  });
});

// =============================================================================
describe("GET /api/equipos (listado)", () => {
  it("lista con asignación vigente, paginación y conteos para los filtros rápidos", async () => {
    const { empleado } = await equipoAsignado("A-001");
    await crearEquipo({ numeroSerie: "B-002" });
    const enTaller = await crearEquipo({ numeroSerie: "C-003" });
    await db.equipo.update({ where: { id: enTaller.id }, data: { estado: "EN_MANTENIMIENTO" } });

    const res = await api().get("/api/equipos");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.conteos).toEqual({ todos: 3, asignados: 1, libres: 2, mantenimiento: 1 });
    expect(res.body.datos.map((e: { numeroSerie: string }) => e.numeroSerie)).toEqual(["A-001", "B-002", "C-003"]);
    expect(res.body.datos[0].asignacionVigente.empleado).toMatchObject({ id: empleado.id, departamento: expect.any(String) });
    expect(res.body.datos[1].asignacionVigente).toBeNull();
  });

  it("filtra por asignación, estado y tipo", async () => {
    await equipoAsignado("A-001");
    await crearEquipo({ numeroSerie: "B-002" });
    const enTaller = await crearEquipo({ numeroSerie: "C-003" });
    await db.equipo.update({ where: { id: enTaller.id }, data: { estado: "EN_MANTENIMIENTO", tipo: "IMPRESORA" } });

    const series = async (query: string) =>
      (await api().get(`/api/equipos?${query}`)).body.datos.map((e: { numeroSerie: string }) => e.numeroSerie);
    expect(await series("asignacion=asignados")).toEqual(["A-001"]);
    expect(await series("asignacion=libres")).toEqual(["B-002", "C-003"]);
    expect(await series("estado=EN_MANTENIMIENTO")).toEqual(["C-003"]);
    expect(await series("tipo=IMPRESORA")).toEqual(["C-003"]);
    expect(await series("tipo=&estado=&asignacion=")).toHaveLength(3);
  });

  it("busca por partes del número de serie, marca o modelo, sin importar mayúsculas ni acentos", async () => {
    await crearEquipo({ numeroSerie: "DEMO-SN-0001", marca: "Dell", modelo: "Latitude 5440" });
    await crearEquipo({ numeroSerie: "DEMO-SN-0002", marca: "HP", modelo: "ProDesk 400" });
    await crearEquipo({ numeroSerie: "XYZ-9", marca: "Lenovo", modelo: "Ideacentre" });

    const series = async (busqueda: string) =>
      (await api().get("/api/equipos").query({ busqueda })).body.datos.map((e: { numeroSerie: string }) => e.numeroSerie);
    expect(await series("sn 0001")).toEqual(["DEMO-SN-0001"]);
    expect(await series("demo-sn")).toEqual(["DEMO-SN-0001", "DEMO-SN-0002"]);
    expect(await series("dell latitude")).toEqual(["DEMO-SN-0001"]);
    expect(await series("PRODESK")).toEqual(["DEMO-SN-0002"]);
    expect(await series("idéacentre")).toEqual(["XYZ-9"]);
    expect(await series("no-existe")).toEqual([]);
  });

  it("trata % y _ como texto normal, no como comodines de SQL", async () => {
    await crearEquipo({ numeroSerie: "AB-001", modelo: "Uno" });
    await crearEquipo({ numeroSerie: "AB_002", modelo: "Dos 100%" });
    const series = async (busqueda: string) =>
      (await api().get("/api/equipos").query({ busqueda })).body.datos.map((e: { numeroSerie: string }) => e.numeroSerie);
    expect(await series("%")).toEqual(["AB_002"]);
    expect(await series("_")).toEqual(["AB_002"]);
    expect(await series("AB_")).toEqual(["AB_002"]);
    expect(await series("\\")).toEqual([]);
  });

  it("no muestra equipos dados de baja salvo que se pidan", async () => {
    await crearEquipo({ numeroSerie: "VIVO-1" });
    const baja = await crearEquipo({ numeroSerie: "BAJA-1" });
    await db.equipo.update({ where: { id: baja.id }, data: { estado: "BAJA" } });
    expect((await api().get("/api/equipos")).body.total).toBe(1);
    expect((await api().get("/api/equipos?estado=BAJA")).body.datos[0].numeroSerie).toBe("BAJA-1");
  });

  it("pagina los resultados", async () => {
    for (let i = 1; i <= 5; i++) await crearEquipo({ numeroSerie: `P-00${i}` });
    const pagina2 = (await api().get("/api/equipos?pagina=2&porPagina=2")).body;
    expect(pagina2).toMatchObject({ total: 5, pagina: 2, porPagina: 2 });
    expect(pagina2.datos.map((e: { numeroSerie: string }) => e.numeroSerie)).toEqual(["P-003", "P-004"]);
    expect((await api().get("/api/equipos?pagina=9&porPagina=2")).body.datos).toEqual([]);
  });

  it.each([
    ["pagina=0", "pagina"],
    ["porPagina=500", "porPagina"],
    ["pagina=abc", "pagina"],
    ["asignacion=quiza", "asignacion"],
    ["estado=ROTO", "estado"],
  ])("rechaza el parámetro inválido %s", async (query, campo) => {
    const res = await api().get(`/api/equipos?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.campos).toHaveProperty(campo);
  });
});

// =============================================================================
describe("GET /api/equipos/serie/:numeroSerie (búsqueda exacta)", () => {
  it("encuentra el equipo aunque se escriba con minúsculas o espacios", async () => {
    await equipoAsignado("DEMO-SN-0001");
    const res = await api().get(`/api/equipos/serie/${encodeURIComponent(" demo-sn-0001 ")}`);
    expect(res.status).toBe(200);
    expect(res.body.numeroSerie).toBe("DEMO-SN-0001");
    expect(res.body.asignacionVigente).not.toBeNull();
  });

  it("responde 404 con un mensaje claro si no existe", async () => {
    const res = await api().get("/api/equipos/serie/nada-123");
    expect(res.status).toBe(404);
    expect(res.body.error.mensaje).toBe("No existe un equipo con el número de serie NADA-123.");
  });
});

// =============================================================================
describe("GET /api/equipos/:id (ficha)", () => {
  it("devuelve datos, tiempo de funcionamiento, historial y mantenimientos", async () => {
    const creado = await api()
      .post("/api/equipos")
      .send({ ...equipoValido, fechaAdquisicion: "2023-03-15", costo: "21500" });
    const id = creado.body.id;
    const [ana, beto] = [await crearEmpleado({ nombre: "Ana" }), await crearEmpleado({ nombre: "Beto" })];
    await db.asignacion.create({
      data: {
        equipoId: id,
        empleadoId: ana.id,
        fechaAsignacion: new Date("2024-01-10T15:00:00Z"),
        fechaDevolucion: new Date("2024-06-01T15:00:00Z"),
      },
    });
    await db.asignacion.create({ data: { equipoId: id, empleadoId: beto.id, fechaAsignacion: new Date("2024-06-02T15:00:00Z") } });
    await db.mantenimiento.create({
      data: { equipoId: id, tipo: "PREVENTIVO", fechaProgramada: fechaDesdeTexto("2026-10-01"), descripcion: "Limpieza" },
    });

    const res = await api().get(`/api/equipos/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ costo: "21500.00", fechaAdquisicion: "2023-03-15" });
    expect(res.body.tiempoFuncionamiento).toEqual({ anios: expect.any(Number), meses: expect.any(Number) });
    expect(res.body.asignacionVigente.empleado.nombre).toBe("Beto");
    expect(res.body.asignaciones.map((a: { empleado: { nombre: string } }) => a.empleado.nombre)).toEqual(["Beto", "Ana"]);
    expect(res.body.mantenimientos[0]).toMatchObject({ tipo: "PREVENTIVO", fechaProgramada: "2026-10-01" });
  });

  it("responde 404 si el equipo no existe y 400 si el id no es válido", async () => {
    expect((await api().get("/api/equipos/999999")).status).toBe(404);
    const invalido = await api().get("/api/equipos/abc");
    expect(invalido.status).toBe(400);
    expect(invalido.body.error.codigo).toBe("DATOS_INVALIDOS");
  });
});

// =============================================================================
describe("PATCH /api/equipos/:id (edición)", () => {
  it("edita campos sueltos y permite vaciar los opcionales", async () => {
    const creado = (await api().post("/api/equipos").send({ ...equipoValido, ubicacion: "Recepción" })).body;
    const res = await api().patch(`/api/equipos/${creado.id}`).send({ modelo: "Latitude 7440", ubicacion: "" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ modelo: "Latitude 7440", ubicacion: null, marca: "Dell" });
  });

  it("cambia el estado entre ACTIVO y EN_MANTENIMIENTO, pero no a BAJA", async () => {
    const creado = (await api().post("/api/equipos").send(equipoValido)).body;
    const enTaller = await api().patch(`/api/equipos/${creado.id}`).send({ estado: "EN_MANTENIMIENTO" });
    expect(enTaller.body.estado).toBe("EN_MANTENIMIENTO");
    const baja = await api().patch(`/api/equipos/${creado.id}`).send({ estado: "BAJA" });
    expect(baja.status).toBe(400);
    expect(baja.body.error.campos.estado).toMatch(/módulo de Bajas/);
  });

  it("rechaza cambiar el número de serie por uno que ya usa otro equipo", async () => {
    await crearEquipo({ numeroSerie: "OCUPADA-1" });
    const propio = await crearEquipo({ numeroSerie: "PROPIA-1" });
    const res = await api().patch(`/api/equipos/${propio.id}`).send({ numeroSerie: "ocupada-1" });
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("NUMERO_SERIE_DUPLICADO");
    // Volver a guardar su propia serie no es un conflicto.
    expect((await api().patch(`/api/equipos/${propio.id}`).send({ numeroSerie: "propia-1" })).status).toBe(200);
  });

  it("no permite modificar un equipo dado de baja", async () => {
    const equipo = await crearEquipo();
    await db.equipo.update({ where: { id: equipo.id }, data: { estado: "BAJA" } });
    const res = await api().patch(`/api/equipos/${equipo.id}`).send({ ubicacion: "Bodega" });
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("EQUIPO_DADO_DE_BAJA");
  });

  it("rechaza una edición vacía y responde 404 si el equipo no existe", async () => {
    const equipo = await crearEquipo();
    const vacia = await api().patch(`/api/equipos/${equipo.id}`).send({});
    expect(vacia.status).toBe(400);
    expect(vacia.body.error.campos._).toBe("Envía al menos un campo para modificar.");
    expect((await api().patch("/api/equipos/999999").send({ marca: "X" })).status).toBe(404);
  });
});

// =============================================================================
describe("GET /api/resumen y rutas desconocidas", () => {
  it("devuelve los conteos de Inicio sin contar equipos dados de baja", async () => {
    await equipoAsignado("A-1");
    await crearEquipo({ numeroSerie: "B-1" });
    const taller = await crearEquipo({ numeroSerie: "C-1" });
    await db.equipo.update({ where: { id: taller.id }, data: { estado: "EN_MANTENIMIENTO" } });
    const baja = await crearEquipo({ numeroSerie: "D-1" });
    await db.equipo.update({ where: { id: baja.id }, data: { estado: "BAJA" } });

    const res = await api().get("/api/resumen");
    expect(res.body).toEqual({ equipos: 3, asignados: 1, sinAsignar: 2, enMantenimiento: 1 });
  });

  it("responde 404 en JSON para una ruta de la API que no existe", async () => {
    const res = await api().get("/api/no-existe");
    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe("RUTA_NO_ENCONTRADA");
  });
});
