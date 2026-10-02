import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { crearApp } from "../../src/app.ts";
import { fechaDesdeTexto } from "../../src/lib/fechas.ts";
import { formatoFolio, type DetalleBaja } from "../../src/modulos/bajas/bajas.modulo.ts";
import { fechaFormatoHotel, generarPdfBaja, renglonesDelActa, textoAnios } from "../../src/modulos/reportes/reporteBaja.ts";
import { crearEmpleado, crearEquipo, db, limpiarTablas, rechazo, iniciarSesionDePrueba } from "../helpers/contexto.ts";
import { paginasDelPdf, textoDelPdf } from "../helpers/pdf.ts";

// "Ahora" fijo: martes 29 de septiembre de 2026, 11:00 en Playa del Carmen.
const app = crearApp({ db, reloj: () => new Date("2026-09-29T16:00:00Z") });
// Todas las rutas exigen sesión: las pruebas usan un técnico ya autenticado.
const sesion = await iniciarSesionDePrueba(app);
const api = () => sesion;

beforeEach(limpiarTablas);
afterAll(() => db.$disconnect());

/** Equipo con fecha de adquisición y costo, como los que se dan de baja. */
async function equipoViejo(numeroSerie: string, fechaAdquisicion = "2023-03-15", costo: string | null = "21500.00", modelo = "OptiPlex 3080") {
  const equipo = await crearEquipo({ numeroSerie, marca: "Dell", modelo });
  return db.equipo.update({ where: { id: equipo.id }, data: { fechaAdquisicion: fechaDesdeTexto(fechaAdquisicion), costo } });
}

const MOTIVO = "No enciende; la tarjeta madre está dañada";
const conMotivo = (ids: number[], observaciones = MOTIVO) => ids.map((id) => ({ id, observaciones }));

/** Artículo sin número de serie, como en el formato del hotel. */
const bateriasUps = { descripcion: "Baterías UPS no-break", cantidad: 19, costo: "28500", aniosUso: 10, observaciones: "No retienen carga" };

function darDeBaja(cuerpo: Record<string, unknown>) {
  return api().post("/api/bajas").send({ fechaBaja: "2026-09-29", elaboro: " Joel Polanco ", ...cuerpo });
}
const darDeBajaEquipos = (ids: number[], cambios: Record<string, unknown> = {}) => darDeBaja({ equipos: conMotivo(ids), ...cambios });

async function programarMantenimiento(equipoId: number, estado: "PROGRAMADO" | "REALIZADO" = "PROGRAMADO") {
  return db.mantenimiento.create({
    data: {
      equipoId,
      tipo: "PREVENTIVO",
      estado,
      descripcion: "Limpieza",
      ...(estado === "PROGRAMADO" ? { fechaProgramada: fechaDesdeTexto("2026-10-05") } : { fechaRealizacion: fechaDesdeTexto("2026-01-10") }),
    },
  });
}

// =============================================================================
describe("POST /api/bajas", () => {
  it("da de baja equipos del inventario con su motivo y artículos sin número de serie", async () => {
    const a = await equipoViejo("SN-A", "2023-03-15", "21500.00");
    const b = await equipoViejo("SN-B", "2026-09-01", "3500.50");
    const res = await darDeBaja({
      equipos: [{ id: b.id, observaciones: "  Pantalla rota  " }, { id: a.id, observaciones: MOTIVO }],
      articulos: [bateriasUps, { descripcion: "Tóners", cantidad: "24", costo: "", aniosUso: "", observaciones: "Usados" }],
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ folio: "BAJA-2026-0001", fechaBaja: "2026-09-29", elaboro: "Joel Polanco", costoTotal: "53500.50", mantenimientosCancelados: 0 });
    expect(res.body.equipos).toEqual([
      expect.objectContaining({ numeroSerie: "SN-A", observaciones: MOTIVO, tiempoFuncionamiento: { anios: 3, meses: 6 } }),
      expect.objectContaining({ numeroSerie: "SN-B", observaciones: "Pantalla rota" }),
    ]);
    expect(res.body.articulos).toEqual([
      expect.objectContaining({ descripcion: "Baterías UPS no-break", cantidad: 19, costo: "28500.00", aniosUso: 10, observaciones: "No retienen carga" }),
      expect.objectContaining({ descripcion: "Tóners", cantidad: 24, costo: null, aniosUso: null, observaciones: "Usados" }),
    ]);

    const guardados = await db.equipo.findMany({ orderBy: { numeroSerie: "asc" } });
    expect(guardados.map((e) => [e.estado, e.bajaId, e.observacionBaja])).toEqual([
      ["BAJA", res.body.id, MOTIVO],
      ["BAJA", res.body.id, "Pantalla rota"],
    ]);
  });

  it("acepta un acta solo de artículos (como el ejemplo del hotel)", async () => {
    const res = await darDeBaja({ articulos: [bateriasUps] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ equipos: [], costoTotal: "28500.00", mantenimientosCancelados: 0 });
  });

  it("el folio es consecutivo por año de la fecha de baja", async () => {
    await darDeBaja({ articulos: [bateriasUps], fechaBaja: "2025-12-31" }).expect(201);
    await darDeBaja({ articulos: [bateriasUps] }).expect(201);
    await darDeBaja({ articulos: [bateriasUps], fechaBaja: "2025-06-01" }).expect(201);
    const folios = (await db.baja.findMany({ orderBy: { id: "asc" } })).map((b) => b.folio);
    expect(folios).toEqual(["BAJA-2025-0001", "BAJA-2026-0001", "BAJA-2025-0002"]);
    expect(formatoFolio(2026, 12345)).toBe("BAJA-2026-12345");
  });

  it("si un equipo viene dos veces cuenta una, con el primer motivo", async () => {
    const equipo = await equipoViejo("SN-1");
    const res = await darDeBaja({ equipos: [{ id: equipo.id, observaciones: "Primero" }, { id: equipo.id, observaciones: "Segundo" }] });
    expect(res.status).toBe(201);
    expect(res.body.equipos).toEqual([expect.objectContaining({ observaciones: "Primero" })]);
  });

  it("cancela los mantenimientos programados y conserva el historial realizado", async () => {
    const equipo = await equipoViejo("SN-1");
    const programado = await programarMantenimiento(equipo.id);
    const realizado = await programarMantenimiento(equipo.id, "REALIZADO");
    const res = await darDeBajaEquipos([equipo.id]);
    expect(res.body.mantenimientosCancelados).toBe(1);
    expect((await db.mantenimiento.findUniqueOrThrow({ where: { id: programado.id } })).estado).toBe("CANCELADO");
    expect((await db.mantenimiento.findUniqueOrThrow({ where: { id: realizado.id } })).estado).toBe("REALIZADO");
  });

  it("acepta un equipo en mantenimiento y uno sin fecha de adquisición ni costo", async () => {
    const enTaller = await equipoViejo("SN-TALLER");
    await db.equipo.update({ where: { id: enTaller.id }, data: { estado: "EN_MANTENIMIENTO" } });
    const sinDatos = await crearEquipo({ numeroSerie: "SN-SIN-DATOS" });
    const res = await darDeBajaEquipos([enTaller.id, sinDatos.id]);
    expect(res.status).toBe(201);
    expect(res.body.equipos.find((e: { numeroSerie: string }) => e.numeroSerie === "SN-SIN-DATOS")).toMatchObject({
      fechaAdquisicion: null, costo: null, tiempoFuncionamiento: null,
    });
  });

  it("señala lo que falta", async () => {
    const res = await api().post("/api/bajas").send({});
    expect(res.status).toBe(400);
    expect(res.body.error.campos).toEqual({
      fechaBaja: "Elige la fecha de la baja.",
      elaboro: "Escribe el nombre de quien captura la baja.",
    });
    // Con los datos generales completos, pide al menos un renglón.
    const vacia = await darDeBaja({ equipos: [], articulos: [] });
    expect(vacia.body.error.campos).toEqual({ equipos: "Agrega al menos un equipo o un artículo." });
  });

  it("dice exactamente qué renglón está mal", async () => {
    const equipo = await equipoViejo("SN-1");
    const res = await darDeBaja({
      equipos: [{ id: equipo.id, observaciones: "  " }],
      articulos: [bateriasUps, { descripcion: "", cantidad: 0, costo: "-5", aniosUso: 2.5, observaciones: "" }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.campos).toEqual({
      "equipos.0.observaciones": "Escribe el motivo de la baja y las condiciones.",
      "articulos.1.descripcion": "Describe el artículo, por ejemplo «Baterías de UPS».",
      "articulos.1.cantidad": "La cantidad debe ser mayor que cero.",
      "articulos.1.costo": "El costo no puede ser negativo.",
      "articulos.1.aniosUso": "Escribe los años de uso sin decimales (0 si es menos de un año).",
      "articulos.1.observaciones": "Escribe el motivo de la baja y las condiciones.",
    });
    expect(await db.baja.count()).toBe(0);
    expect((await db.equipo.findUniqueOrThrow({ where: { id: equipo.id } })).estado).toBe("ACTIVO");
  });

  it.each([
    ["equipos que no son lista", { equipos: "1,2" }, "equipos", "Los equipos van en una lista."],
    ["id negativo", { equipos: [{ id: -1, observaciones: "x" }] }, "equipos.0.id", "id numérico"],
    ["más de 100 equipos", { equipos: Array.from({ length: 101 }, (_, i) => ({ id: i + 1, observaciones: "x" })) }, "equipos", "Máximo 100 equipos por baja."],
    ["más de 50 artículos", { articulos: Array.from({ length: 51 }, () => bateriasUps) }, "articulos", "Máximo 50 artículos por baja."],
    ["fecha futura", { articulos: [bateriasUps], fechaBaja: "2026-09-30" }, "fechaBaja", "La fecha de la baja no puede ser futura."],
    ["día inexistente", { articulos: [bateriasUps], fechaBaja: "2026-02-30" }, "fechaBaja", "ese día no existe en el calendario"],
    ["cantidad con decimales", { articulos: [{ ...bateriasUps, cantidad: 1.5 }] }, "articulos.0.cantidad", "número entero"],
    ["años de uso negativos", { articulos: [{ ...bateriasUps, aniosUso: -1 }] }, "articulos.0.aniosUso", "no pueden ser negativos"],
    ["motivo demasiado largo", { articulos: [{ ...bateriasUps, observaciones: "x".repeat(256) }] }, "articulos.0.observaciones", "Máximo 255 caracteres."],
    ["campo desconocido en un artículo", { articulos: [{ ...bateriasUps, serie: "X" }] }, "articulos.0.serie", "Este campo no se puede enviar aquí."],
    ["campo del formato anterior", { articulos: [bateriasUps], motivo: "OTRO" }, "motivo", "Este campo no se puede enviar aquí."],
  ])("rechaza %s", async (_caso, cuerpo, campo, mensaje) => {
    const res = await darDeBaja(cuerpo);
    expect(res.status).toBe(400);
    expect(res.body.error.campos[campo]).toContain(mensaje);
    expect(await db.baja.count()).toBe(0);
  });

  it("no acepta una fecha de baja anterior a la compra", async () => {
    const equipo = await equipoViejo("SN-NUEVO", "2026-09-15");
    const res = await darDeBajaEquipos([equipo.id], { fechaBaja: "2026-09-14" });
    expect(res.status).toBe(400);
    expect(res.body.error.campos.fechaBaja).toBe("La fecha de la baja no puede ser anterior a la adquisición de SN-NUEVO (15/09/2026).");
  });

  it("si un equipo no existe no guarda nada, ni los artículos", async () => {
    const equipo = await equipoViejo("SN-1");
    const res = await darDeBajaEquipos([equipo.id, 9999], { articulos: [bateriasUps] });
    expect(res.status).toBe(404);
    expect(res.body.error.mensaje).toBe("No existe el equipo con id 9999.");
    expect(await db.bajaArticulo.count()).toBe(0);
    expect((await db.equipo.findUniqueOrThrow({ where: { id: equipo.id } })).estado).toBe("ACTIVO");
  });

  it("no da de baja dos veces el mismo equipo y dice con qué folio salió", async () => {
    const equipo = await equipoViejo("SN-1");
    await darDeBajaEquipos([equipo.id]).expect(201);
    const res = await darDeBajaEquipos([equipo.id]);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ codigo: "EQUIPO_YA_DADO_DE_BAJA", mensaje: "Este equipo ya está dado de baja: SN-1 (folio BAJA-2026-0001)." });
    expect(await db.baja.count()).toBe(1);
  });

  it("no da de baja un equipo asignado; pide registrar la devolución y no toca los demás", async () => {
    const libre = await equipoViejo("SN-LIBRE");
    const asignado = await equipoViejo("SN-ASIGNADO");
    const empleado = await crearEmpleado({ nombre: "Laura", apellidos: "Méndez Cruz" });
    const asignacion = await api().post("/api/asignaciones").send({ equipoId: asignado.id, empleadoId: empleado.id }).expect(201);

    const res = await darDeBajaEquipos([libre.id, asignado.id]);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      codigo: "EQUIPO_ASIGNADO",
      mensaje: "Registra primero la devolución de este equipo: SN-ASIGNADO (Laura Méndez Cruz).",
      campos: { equipos: expect.any(String) },
    });
    expect(await db.baja.count()).toBe(0);
    expect((await db.equipo.findUniqueOrThrow({ where: { id: libre.id } })).estado).toBe("ACTIVO");

    await api().post(`/api/asignaciones/${asignacion.body.asignacion.id}/devolucion`).send({}).expect(200);
    await darDeBajaEquipos([libre.id, asignado.id]).expect(201);
  });

  it("dos bajas al mismo tiempo reciben folios distintos", async () => {
    const [a, b, c] = await Promise.all(["SN-A", "SN-B", "SN-C"].map((s) => equipoViejo(s)));
    const respuestas = await Promise.all([darDeBajaEquipos([a.id]), darDeBajaEquipos([b.id]), darDeBaja({ articulos: [bateriasUps] }), darDeBajaEquipos([c.id])]);
    expect(respuestas.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(respuestas.map((r) => r.body.folio).sort()).toEqual(["BAJA-2026-0001", "BAJA-2026-0002", "BAJA-2026-0003", "BAJA-2026-0004"]);
  });

  it("si dos personas dan de baja el mismo equipo a la vez, solo una lo logra", async () => {
    const equipo = await equipoViejo("SN-1");
    const respuestas = await Promise.all([darDeBajaEquipos([equipo.id]), darDeBajaEquipos([equipo.id])]);
    expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.baja.count()).toBe(1);
  });
});

// =============================================================================
describe("Un equipo dado de baja", () => {
  async function equipoDadoDeBaja() {
    const equipo = await equipoViejo("SN-BAJA");
    const baja = await darDeBajaEquipos([equipo.id]).expect(201);
    return { equipo, baja: baja.body };
  }

  it("la ficha muestra su acta y su motivo, y el tiempo de funcionamiento se detiene el día de la baja", async () => {
    const { equipo, baja } = await equipoDadoDeBaja();
    const ficha = await api().get(`/api/equipos/${equipo.id}`);
    expect(ficha.body).toMatchObject({
      estado: "BAJA",
      baja: { id: baja.id, folio: "BAJA-2026-0001", fechaBaja: "2026-09-29", observaciones: MOTIVO },
      tiempoFuncionamiento: { anios: 3, meses: 6 },
    });
    expect((await api().get(`/api/equipos/${(await equipoViejo("SN-ACTIVO")).id}`)).body.baja).toBeNull();
  });

  it("ya no se edita, no se asigna ni se le programa mantenimiento", async () => {
    const { equipo } = await equipoDadoDeBaja();
    expect((await api().patch(`/api/equipos/${equipo.id}`).send({ ubicacion: "Bodega" })).status).toBe(409);
    const empleado = await crearEmpleado();
    expect((await api().post("/api/asignaciones").send({ equipoId: equipo.id, empleadoId: empleado.id })).status).toBe(409);
    const mantenimiento = await api()
      .post("/api/mantenimientos")
      .send({ equipoId: equipo.id, tipo: "PREVENTIVO", descripcion: "Limpieza", fechaProgramada: "2026-10-10" });
    expect(mantenimiento.body.error.codigo).toBe("EQUIPO_DADO_DE_BAJA");
  });

  it("sale del inventario y de los conteos de Inicio, pero se puede consultar con estado=BAJA", async () => {
    await equipoViejo("SN-ACTIVO");
    await equipoDadoDeBaja();
    expect((await api().get("/api/equipos")).body.datos.map((e: { numeroSerie: string }) => e.numeroSerie)).toEqual(["SN-ACTIVO"]);
    expect((await api().get("/api/resumen")).body.equipos).toBe(1);
    expect((await api().get("/api/equipos?estado=BAJA")).body.datos.map((e: { numeroSerie: string }) => e.numeroSerie)).toEqual(["SN-BAJA"]);
  });
});

// =============================================================================
describe("GET /api/bajas", () => {
  async function tresBajas() {
    const uno = await darDeBajaEquipos([(await equipoViejo("SN-VIEJO-1", "2020-01-01")).id], { fechaBaja: "2026-01-15" });
    const dos = await darDeBajaEquipos([(await equipoViejo("SN-VIEJO-2", "2020-01-01")).id, (await equipoViejo("MX-777", "2020-01-01")).id]);
    const tres = await darDeBaja({ articulos: [bateriasUps], fechaBaja: "2026-05-01" });
    return [uno.body, dos.body, tres.body];
  }

  it("lista las actas de la más reciente a la más antigua, con sus renglones", async () => {
    await tresBajas();
    const res = await api().get("/api/bajas");
    expect(res.body.total).toBe(3);
    expect(res.body.datos.map((b: { folio: string }) => b.folio)).toEqual(["BAJA-2026-0002", "BAJA-2026-0003", "BAJA-2026-0001"]);
    expect(res.body.datos[0].equipos.map((e: { numeroSerie: string }) => e.numeroSerie)).toEqual(["MX-777", "SN-VIEJO-2"]);
    expect(res.body.datos[1].articulos[0].descripcion).toBe("Baterías UPS no-break");
  });

  it.each([
    ["folio en minúsculas", "baja-2026-0003", ["BAJA-2026-0003"]],
    ["número de serie en minúsculas y con espacios", " mx-777 ", ["BAJA-2026-0002"]],
    ["descripción de un artículo", "baterías", ["BAJA-2026-0003"]],
    ["algo que no existe", "ZZZ", []],
    ["un comodín de SQL", "%", []],
  ])("busca por %s", async (_caso, busqueda, esperados) => {
    await tresBajas();
    const res = await api().get("/api/bajas").query({ busqueda });
    expect(res.body.datos.map((b: { folio: string }) => b.folio)).toEqual(esperados);
  });

  it("pagina, valida parámetros y obtiene un acta por id", async () => {
    const [uno] = await tresBajas();
    expect((await api().get("/api/bajas?porPagina=2&pagina=2")).body).toMatchObject({ total: 3, pagina: 2, datos: [expect.any(Object)] });
    expect((await api().get("/api/bajas?pagina=0")).status).toBe(400);
    expect((await api().get(`/api/bajas/${uno.id}`)).body.folio).toBe("BAJA-2026-0001");
    expect((await api().get("/api/bajas/9999")).body.error.mensaje).toBe("No existe la baja con id 9999.");
    expect((await api().get("/api/bajas/abc")).status).toBe(400);
  });
});

// =============================================================================
describe("Reglas en la base de datos", () => {
  it("un acta y sus renglones no se pueden borrar", async () => {
    const baja = await darDeBaja({ articulos: [bateriasUps] });
    expect((await rechazo(db.bajaArticulo.deleteMany())).message).toMatch(/BAJA_PERMANENTE/);
    expect((await rechazo(db.baja.delete({ where: { id: baja.body.id } }))).message).toMatch(/BAJA_PERMANENTE|foreign key/i);
  });

  it("un equipo dado de baja lleva motivo, y uno activo no puede tener motivo de baja", async () => {
    const baja = await darDeBaja({ articulos: [bateriasUps] });
    const otro = await equipoViejo("SN-2");
    const sinMotivo = await rechazo(db.equipo.update({ where: { id: otro.id }, data: { estado: "BAJA", bajaId: baja.body.id } }));
    expect(sinMotivo.message).toMatch(/chk_equipos_observacion_solo_con_acta/);
    const motivoSinActa = await rechazo(db.equipo.update({ where: { id: otro.id }, data: { observacionBaja: "Rota" } }));
    expect(motivoSinActa.message).toMatch(/chk_equipos_observacion_solo_con_acta/);
    const activoConActa = await rechazo(db.equipo.update({ where: { id: otro.id }, data: { bajaId: baja.body.id, observacionBaja: "Rota" } }));
    expect(activoConActa.message).toMatch(/chk_equipos_acta_solo_en_baja/);
  });

  it("los artículos tienen cantidad positiva y descripción", async () => {
    const baja = await darDeBaja({ articulos: [bateriasUps] });
    const base = { bajaId: baja.body.id, descripcion: "Tóner", cantidad: 1, observaciones: "Usado" };
    expect((await rechazo(db.bajaArticulo.create({ data: { ...base, cantidad: 0 } }))).message).toMatch(/chk_bajas_articulos_cantidad_positiva/);
    expect((await rechazo(db.bajaArticulo.create({ data: { ...base, descripcion: " " } }))).message).toMatch(/chk_bajas_articulos_descripcion_no_vacia/);
    expect((await rechazo(db.bajaArticulo.create({ data: { ...base, aniosUso: 101 } }))).message).toMatch(/chk_bajas_articulos_anios_validos/);
  });
});

// =============================================================================
describe("Reporte de baja con el formato del hotel", () => {
  const detalle = (cambios: Partial<DetalleBaja>): DetalleBaja => ({
    id: 1, folio: "BAJA-2026-0001", fechaBaja: "2026-04-09", elaboro: "Joel Polanco", creadoEn: "2026-04-09T15:00:00.000Z",
    costoTotal: "0.00", equipos: [], articulos: [], ...cambios,
  });
  const equipo = (id: number, serie: string, cambios: Partial<DetalleBaja["equipos"][number]> = {}): DetalleBaja["equipos"][number] => ({
    id, numeroSerie: serie, tipo: "LAPTOP", marca: "Dell", modelo: "Latitude 5440", fechaAdquisicion: "2020-01-01",
    costo: "10000.00", tiempoFuncionamiento: { anios: 6, meses: 3 }, observaciones: "No enciende", ...cambios,
  });

  it("junta los equipos iguales con el mismo motivo en un renglón con su cantidad y sus series", () => {
    const renglones = renglonesDelActa(detalle({
      equipos: [
        equipo(1, "SN-1"),
        equipo(2, "SN-2", { tiempoFuncionamiento: { anios: 5, meses: 0 }, costo: null }),
        equipo(3, "SN-3", { observaciones: "Pantalla rota" }),
        equipo(4, "SN-4", { modelo: "Latitude 7490" }),
      ],
      articulos: [{ id: 1, descripcion: "Baterías UPS no-break", cantidad: 19, costo: "28500.00", aniosUso: 10, observaciones: "No retienen carga" }],
    }));
    expect(renglones).toEqual([
      { descripcion: "LAPTOP DELL LATITUDE 5440", series: ["SN-1", "SN-2"], cantidad: 2, centavos: 1_000_000, costoIncompleto: true, tiempoUso: "5 A 6 AÑOS", observaciones: "NO ENCIENDE" },
      expect.objectContaining({ series: ["SN-3"], cantidad: 1, tiempoUso: "6 AÑOS", observaciones: "PANTALLA ROTA" }),
      expect.objectContaining({ descripcion: "LAPTOP DELL LATITUDE 7490", series: ["SN-4"] }),
      { descripcion: "BATERÍAS UPS NO-BREAK", series: [], cantidad: 19, centavos: 2_850_000, costoIncompleto: false, tiempoUso: "10 AÑOS", observaciones: "NO RETIENEN CARGA" },
    ]);
  });

  it.each([
    [0, "MENOS DE 1 AÑO"],
    [1, "1 AÑO"],
    [10, "10 AÑOS"],
  ])("escribe %i años como «%s»", (anios, texto) => {
    expect(textoAnios(anios)).toBe(texto);
  });

  it("escribe la fecha como en el formato: 09-abr-26", () => {
    expect(fechaFormatoHotel("2026-04-09")).toBe("09-abr-26");
    expect(fechaFormatoHotel("2025-12-31")).toBe("31-dic-25");
  });

  it("GET /api/reportes/baja/:id devuelve el PDF con el encabezado, la tabla y las cuatro firmas", async () => {
    const a = await equipoViejo("SN-A", "2020-03-15", "21500.00");
    const baja = await darDeBaja({ equipos: conMotivo([a.id], "No enciende"), articulos: [bateriasUps] });

    const res = await api().get(`/api/reportes/baja/${baja.body.id}`).buffer(true).parse((r, fin) => {
      const partes: Buffer[] = [];
      r.on("data", (p: Buffer) => partes.push(p));
      r.on("end", () => fin(null, Buffer.concat(partes)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe('inline; filename="reporte-baja-2026-0001.pdf"');

    const texto = textoDelPdf(res.body as Buffer);
    for (const esperado of [
      "GIRONA CONSULTORES, S.A. DE C.V.",
      "29-sep-26",
      "BAJA-2026-0001",
      "BAJAS DE EQUIPO OPERACIONAL",
      "DEPTO", "DESCRIPCIÓN", "CANTIDAD", "COSTO", "TIEMPO DE", "USO", "MOTIVO DE BAJA Y CONDICIONES", "OBSERVACIONES",
      "SISTEMAS",
      "LAPTOP DELL OPTIPLEX 3080", "SERIE: SN-A", "6 AÑOS", "21,500.00", "NO ENCIENDE",
      "BATERÍAS UPS NO-BREAK", "19", "28,500.00", "10 AÑOS", "NO RETIENEN CARGA",
      "FIRMA", "JEFE DEPARTAMENTAL", "RECIBE", "CONTRALOR DE COSTOS", "AUTORIZACIÓN", "DIRECTOR", "VO. BO.", "CONTRALOR GENERAL",
      "Página 1 de 1",
    ]) {
      expect(texto, `falta «${esperado}»`).toContain(esperado);
    }
  });

  it("un acta con muchos renglones pasa a más páginas y las numera", async () => {
    const articulos = Array.from({ length: 30 }, (_, i) => ({ ...bateriasUps, descripcion: `Artículo ${i + 1}` }));
    const pdf = await generarPdfBaja(detalle({ articulos: articulos.map((a, i) => ({ ...a, id: i + 1, costo: "28500.00" })) }));
    const paginas = paginasDelPdf(pdf);
    expect(paginas).toBeGreaterThanOrEqual(2);
    const texto = textoDelPdf(pdf);
    expect(texto).toContain("ARTÍCULO 30");
    expect(texto).toContain(`Página ${paginas} de ${paginas}`);
    expect(texto.match(/BAJAS DE EQUIPO OPERACIONAL/g)).toHaveLength(paginas);
  });

  it("marca con * el costo de un renglón al que le falta el costo de algún equipo", async () => {
    const texto = textoDelPdf(await generarPdfBaja(detalle({ equipos: [equipo(1, "SN-1"), equipo(2, "SN-2", { costo: null })] })));
    expect(texto).toContain("10,000.00 *");
    expect(texto).toContain("Algún equipo del renglón no tiene costo registrado");
  });

  it("404 si el acta no existe y 400 si el id no es válido", async () => {
    expect((await api().get("/api/reportes/baja/9999")).status).toBe(404);
    expect((await api().get("/api/reportes/baja/abc")).status).toBe(400);
  });
});
