import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { crearApp } from "../../src/app.ts";
import { fechaDesdeTexto } from "../../src/lib/fechas.ts";
import { formatoFolio, type DetalleBaja } from "../../src/modulos/bajas/bajas.modulo.ts";
import {
  configuracionDesdeEntorno, fechaFormatoHotel, generarPdfBaja, relacionPorTipo, renglonesDelActa, textoAnios, totalesDelActa,
} from "../../src/modulos/reportes/reporteBaja.ts";
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
    ["más de 500 equipos", { equipos: Array.from({ length: 501 }, (_, i) => ({ id: i + 1, observaciones: "x" })) }, "equipos", "Máximo 500 equipos por baja."],
    ["tiempo de uso demasiado largo", { articulos: [{ ...bateriasUps, tiempoUso: "x".repeat(41) }] }, "articulos.0.tiempoUso", "máximo 40 caracteres"],
    ["tiempo de uso de un equipo que no es texto", { equipos: [{ id: 1, observaciones: "x", tiempoUso: 5 }] }, "equipos.0.tiempoUso", "como texto"],
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
describe("Formato de noviembre de 2026: tiempo de uso escrito y bajas grandes", () => {
  it("guarda el tiempo de uso escrito de equipos y artículos y lo devuelve en el detalle", async () => {
    const a = await crearEquipo({ numeroSerie: "TEL-1" });
    const res = await darDeBaja({
      equipos: [{ id: a.id, observaciones: "Falla en display", tiempoUso: " 5 a 6 años " }],
      articulos: [{ ...bateriasUps, aniosUso: "", tiempoUso: "6 a 8 años" }],
    });
    expect(res.status).toBe(201);
    expect(res.body.equipos[0]).toMatchObject({ numeroSerie: "TEL-1", tiempoUso: "5 a 6 años", tiempoFuncionamiento: null });
    expect(res.body.articulos[0]).toMatchObject({ tiempoUso: "6 a 8 años", aniosUso: null });
    expect((await db.equipo.findUniqueOrThrow({ where: { id: a.id } })).tiempoUsoBaja).toBe("5 a 6 años");
  });

  it("sin tiempo de uso escrito, el campo queda vacío (null)", async () => {
    const a = await crearEquipo();
    const res = await darDeBaja({ equipos: [{ id: a.id, observaciones: "x", tiempoUso: "  " }] });
    expect(res.status).toBe(201);
    expect(res.body.equipos[0].tiempoUso).toBeNull();
  });

  it("da de baja 188 equipos en una sola acta (como la de BBGE de octubre)", async () => {
    const ids: number[] = [];
    for (let i = 1; i <= 188; i++) ids.push((await crearEquipo({ numeroSerie: `BBGE-${i}`, costo: "1200" })).id);
    const res = await darDeBaja({ equipos: ids.map((id) => ({ id, observaciones: "Equipo obsoleto / falla en display", tiempoUso: "5 a 6 años" })) });
    expect(res.status).toBe(201);
    expect(res.body.equipos).toHaveLength(188);
    expect(res.body.costoTotal).toBe("225600.00");
    expect(await db.equipo.count({ where: { estado: "BAJA" } })).toBe(188);
  });

  it("la base no acepta tiempo de uso en un equipo sin acta ni vacío en un artículo", async () => {
    const equipo = await crearEquipo();
    expect((await rechazo(db.equipo.update({ where: { id: equipo.id }, data: { tiempoUsoBaja: "5 años" } }))).message).toMatch(/chk_equipos_tiempo_uso_solo_con_acta/);
    const acta = await darDeBaja({ articulos: [bateriasUps] });
    const base = { bajaId: acta.body.id, descripcion: "X", cantidad: 1, observaciones: "Y" };
    expect((await rechazo(db.bajaArticulo.create({ data: { ...base, tiempoUso: "  " } }))).message).toMatch(/chk_bajas_articulos_tiempo_uso_no_vacio/);
  });

  it("acepta los tipos de equipo nuevos (teléfono, switch, no-break, cargador…)", async () => {
    for (const tipo of ["TELEFONO", "SWITCH", "ACCESS_POINT", "NO_BREAK", "TECLADO", "MOUSE", "BOCINA", "LECTOR_HUELLA", "FUENTE_PODER", "CARGADOR", "CAMARA", "SERVIDOR", "TPV"] as const) {
      await db.equipo.create({ data: { numeroSerie: `T-${tipo}`, tipo, marca: "M", modelo: "X" } });
    }
    expect(await db.equipo.count()).toBe(13);
  });
});

// =============================================================================
describe("POST /api/bajas/verificar-series", () => {
  const verificar = (series: unknown) => api().post("/api/bajas/verificar-series").send({ series });

  it("separa los disponibles de los que no existen, ya están de baja, están asignados o vienen repetidos", async () => {
    const libre = await crearEquipo({ numeroSerie: "0016CAF31C53" });
    const otroLibre = await crearEquipo({ numeroSerie: "NTMN34GF70E6" });
    const dado = await crearEquipo({ numeroSerie: "VIEJO-1" });
    await darDeBajaEquipos([dado.id]);
    const asignado = await crearEquipo({ numeroSerie: "ASIG-1" });
    const empleado = await crearEmpleado({ nombre: "Ana", apellidos: "López" });
    await db.asignacion.create({ data: { equipoId: asignado.id, empleadoId: empleado.id } });

    const res = await verificar([" 0016caf31c53 ", "ntmn34gf70e6", "0016CAF31C53", "NO-EXISTE", "viejo-1", "ASIG-1", "", "   "]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      revisadas: 5,
      disponibles: [
        { id: libre.id, numeroSerie: "0016CAF31C53", tipo: "LAPTOP", marca: "Marca", modelo: "Modelo", ubicacion: null },
        { id: otroLibre.id, numeroSerie: "NTMN34GF70E6", tipo: "LAPTOP", marca: "Marca", modelo: "Modelo", ubicacion: null },
      ],
      noEncontrados: ["NO-EXISTE"],
      yaDeBaja: [{ numeroSerie: "VIEJO-1", folio: "BAJA-2026-0001" }],
      asignados: [{ numeroSerie: "ASIG-1", empleado: "Ana López" }],
      repetidos: ["0016CAF31C53"],
    });
    // Solo revisa: no cambia nada.
    expect((await db.equipo.findUniqueOrThrow({ where: { id: libre.id } })).estado).toBe("ACTIVO");
  });

  it("una lista vacía no es error", async () => {
    const res = await verificar([]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ revisadas: 0, disponibles: [], noEncontrados: [] });
  });

  it.each([
    ["sin lista", undefined, "series", "Los números de serie van en una lista."],
    ["un número que no es texto", [123], "series.0", "como texto"],
    ["una serie demasiado larga", ["x".repeat(101)], "series.0", "máximo 100 caracteres"],
    ["más de 1000 series", Array.from({ length: 1001 }, (_, i) => `S${i}`), "series", "Máximo 1000"],
  ])("rechaza %s", async (_caso, series, campo, mensaje) => {
    const res = await verificar(series);
    expect(res.status).toBe(400);
    expect(res.body.error.campos[campo]).toContain(mensaje);
  });

  it("exige sesión", async () => {
    const { default: request } = await import("supertest");
    expect((await request(app).post("/api/bajas/verificar-series").send({ series: ["X"] })).status).toBe(401);
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
    costo: "10000.00", tiempoFuncionamiento: { anios: 6, meses: 3 }, observaciones: "No enciende", tiempoUso: null, ...cambios,
  });
  const articulo = (id: number, cambios: Partial<DetalleBaja["articulos"][number]> = {}): DetalleBaja["articulos"][number] => ({
    id, descripcion: "Baterías UPS no-break", cantidad: 19, costo: "28500.00", aniosUso: 10, tiempoUso: null, observaciones: "No retienen carga", ...cambios,
  });
  const configuracion = configuracionDesdeEntorno({
    FIRMA_JEFE_DEPARTAMENTAL: "Ana Torres", FIRMA_CONTRALOR_COSTOS: "Luis Pérez",
    FIRMA_DIRECTOR_GENERAL: "Marta Ruiz", FIRMA_CONTRALOR_GENERAL: "Pedro Gómez",
  });

  it("junta los equipos del mismo tipo y motivo en un renglón con cantidad, costo unitario y costo total", () => {
    const renglones = renglonesDelActa(detalle({
      equipos: [
        equipo(1, "SN-1"),
        equipo(2, "SN-2", { tiempoFuncionamiento: { anios: 5, meses: 0 }, costo: null }),
        equipo(3, "SN-3", { observaciones: "Pantalla rota" }),
        equipo(4, "SN-4", { modelo: "Latitude 7490" }),
      ],
      articulos: [articulo(1)],
    }));
    expect(renglones).toEqual([
      {
        descripcion: "LAPTOP", series: ["SN-1", "SN-2", "SN-4"], cantidad: 3, centavosUnitario: null, unitarioVarios: false,
        centavos: 2_000_000, costoIncompleto: true, tiempoUso: "5 A 6 AÑOS", observaciones: "NO ENCIENDE",
      },
      expect.objectContaining({ series: ["SN-3"], cantidad: 1, centavosUnitario: 1_000_000, tiempoUso: "6 AÑOS", observaciones: "PANTALLA ROTA" }),
      {
        descripcion: "BATERÍAS UPS NO-BREAK", series: [], cantidad: 19, centavosUnitario: 150_000, unitarioVarios: false,
        centavos: 2_850_000, costoIncompleto: false, tiempoUso: "10 AÑOS", observaciones: "NO RETIENEN CARGA",
      },
    ]);
  });

  it("usa el tiempo de uso escrito cuando no hay fecha de adquisición y lo junta con el calculado", () => {
    const [renglon] = renglonesDelActa(detalle({
      equipos: [
        equipo(1, "T-1", { tipo: "TELEFONO", tiempoFuncionamiento: null, tiempoUso: "5 a 6 años" }),
        equipo(2, "T-2", { tipo: "TELEFONO", tiempoFuncionamiento: null, tiempoUso: "5 a 6 AÑOS " }),
        equipo(3, "T-3", { tipo: "TELEFONO", tiempoFuncionamiento: { anios: 7, meses: 1 } }),
      ],
    }));
    expect(renglon).toMatchObject({ descripcion: "TELÉFONO", cantidad: 3, centavosUnitario: 1_000_000, tiempoUso: "5 A 6 AÑOS / 7 AÑOS" });
    const [sinDatos] = renglonesDelActa(detalle({ equipos: [equipo(1, "X", { tiempoFuncionamiento: null })] }));
    expect(sinDatos!.tiempoUso).toBe("—");
    const [deArticulo] = renglonesDelActa(detalle({ articulos: [articulo(1, { tiempoUso: "6 a 8 años", aniosUso: 3 })] }));
    expect(deArticulo!.tiempoUso).toBe("6 A 8 AÑOS");
  });

  it("marca VARIOS cuando los equipos del renglón cuestan distinto y separa los «Otro» por marca y modelo", () => {
    const renglones = renglonesDelActa(detalle({
      equipos: [
        equipo(1, "S-1", { tipo: "SWITCH", costo: "4500.00" }),
        equipo(2, "S-2", { tipo: "SWITCH", costo: "3000.00" }),
        equipo(3, "O-1", { tipo: "OTRO", marca: "Uni-T", modelo: "UT55" }),
        equipo(4, "O-2", { tipo: "OTRO", marca: "Dormakaba", modelo: "EC90EN" }),
      ],
    }));
    expect(renglones.map((r) => [r.descripcion, r.cantidad, r.unitarioVarios, r.centavos])).toEqual([
      ["SWITCH", 2, true, 750_000],
      ["UNI-T UT55", 1, false, 1_000_000],
      ["DORMAKABA EC90EN", 1, false, 1_000_000],
    ]);
  });

  it("suma el total de piezas y de costo, y agrupa la relación por tipo", () => {
    const acta = detalle({
      equipos: [equipo(1, "A"), equipo(2, "B", { tipo: "MOUSE", costo: "150.00" }), equipo(3, "C", { costo: null })],
      articulos: [articulo(1)],
    });
    expect(totalesDelActa(renglonesDelActa(acta))).toEqual({ cantidad: 22, centavos: 3_865_000 });
    expect(relacionPorTipo(acta).map((g) => [g.titulo, g.equipos.map((e) => e.numeroSerie)])).toEqual([
      ["LAPTOP", ["A", "C"]],
      ["MOUSE", ["B"]],
    ]);
  });

  it("lee la razón social y los firmantes del .env; sin nombres solo sale el cargo", () => {
    expect(configuracionDesdeEntorno({})).toEqual({
      razonSocial: "ECONOVA SUSTAINABILITY S.A. de C.V.",
      firmas: [
        { etiqueta: "FIRMA", cargo: "JEFE DEPARTAMENTAL", nombre: "" },
        { etiqueta: "RECIBE", cargo: "CONTRALOR DE COSTOS", nombre: "" },
        { etiqueta: "AUTORIZACIÓN", cargo: "DIRECTOR GENERAL", nombre: "" },
        { etiqueta: "VO. BO.", cargo: "CONTRALOR GENERAL", nombre: "" },
      ],
    });
    expect(configuracionDesdeEntorno({ RAZON_SOCIAL_BAJA: "  OTRA S.A.  ", FIRMA_JEFE_DEPARTAMENTAL: " Ana Torres " })).toMatchObject({
      razonSocial: "OTRA S.A.",
      firmas: [{ nombre: "Ana Torres" }, { nombre: "" }, { nombre: "" }, { nombre: "" }],
    });
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
      "ECONOVA SUSTAINABILITY S.A. de C.V.",
      "29-sep-26",
      "BAJA-2026-0001",
      "BAJA DE EQUIPO OPERACIONAL",
      "DEPTO", "DESCRIPCIÓN", "CANTIDAD", "COSTO", "UNITARIO", "TOTAL", "TIEMPO DE", "USO", "MOTIVO DE BAJA Y",
      "SISTEMAS",
      "LAPTOP", "6 AÑOS", "21,500.00", "NO ENCIENDE",
      "BATERÍAS UPS NO-BREAK", "19", "1,500.00", "28,500.00", "10 AÑOS", "NO RETIENEN CARGA",
      "TOTAL", "20", "50,000.00",
      "FIRMA", "JEFE DEPARTAMENTAL", "RECIBE", "CONTRALOR DE COSTOS", "AUTORIZACIÓN", "DIRECTOR GENERAL", "VO. BO.", "CONTRALOR GENERAL",
      "RELACIÓN DE EQUIPOS DADOS DE BAJA", "LAPTOP (1)", "N/SERIE", "DELL", "OPTIPLEX 3080", "SN-A",
      "ARTÍCULOS SIN NÚMERO DE SERIE (19)",
      "Página 1 de 2", "Página 2 de 2",
    ]) {
      expect(texto, `falta «${esperado}»`).toContain(esperado);
    }
  });

  it("un acta con muchos renglones pasa a más páginas y las numera", async () => {
    const articulos = Array.from({ length: 30 }, (_, i) => articulo(i + 1, { descripcion: `Artículo ${i + 1}` }));
    const pdf = await generarPdfBaja(detalle({ articulos }), configuracion);
    const paginas = paginasDelPdf(pdf);
    expect(paginas).toBeGreaterThanOrEqual(3);
    const texto = textoDelPdf(pdf);
    expect(texto).toContain("ARTÍCULO 30");
    expect(texto).toContain(`Página ${paginas} de ${paginas}`);
    expect(texto.match(/BAJA DE EQUIPO OPERACIONAL/g)!.length + texto.match(/RELACIÓN DE EQUIPOS DADOS DE BAJA/g)!.length).toBe(paginas);
  });

  it("marca con * el costo de un renglón al que le falta el costo de algún equipo", async () => {
    const texto = textoDelPdf(await generarPdfBaja(detalle({ equipos: [equipo(1, "SN-1"), equipo(2, "SN-2", { costo: null })] }), configuracion));
    expect(texto).toContain("10,000.00 *");
    expect(texto).toContain("Algún equipo del renglón no tiene costo registrado");
  });

  it("imprime los nombres de los firmantes sobre su cargo", async () => {
    const texto = textoDelPdf(await generarPdfBaja(detalle({ articulos: [articulo(1)] }), configuracion));
    for (const nombre of ["ANA TORRES", "LUIS PÉREZ", "MARTA RUIZ", "PEDRO GÓMEZ"]) expect(texto).toContain(nombre);
  });

  it("una baja grande (188 equipos de 12 tipos, como la de BBGE) sale completa: resumen por tipo y relación de cada equipo", async () => {
    const tipos = ["TELEFONO", "BOCINA", "LECTOR_HUELLA", "NO_BREAK", "TECLADO", "FUENTE_PODER", "SWITCH", "MOUSE", "IMPRESORA", "CAMARA", "ACCESS_POINT", "CARGADOR"] as const;
    const equipos = Array.from({ length: 188 }, (_, i) => equipo(i + 1, `SN-${String(i + 1).padStart(3, "0")}`, { tipo: tipos[i % tipos.length]!, tiempoFuncionamiento: null, tiempoUso: "5 a 6 años", costo: "100.00" }));
    const acta = detalle({ equipos });
    expect(renglonesDelActa(acta)).toHaveLength(12);
    const pdf = await generarPdfBaja(acta, configuracion);
    const texto = textoDelPdf(pdf);
    expect(texto).toContain("SN-001");
    expect(texto).toContain("SN-188");
    expect(texto).toContain("18,800.00");
    expect(texto).toContain("188");
    const paginas = paginasDelPdf(pdf);
    expect(paginas).toBeGreaterThan(4);
    expect(texto).toContain(`Página ${paginas} de ${paginas}`);
  });

  it("404 si el acta no existe y 400 si el id no es válido", async () => {
    expect((await api().get("/api/reportes/baja/9999")).status).toBe(404);
    expect((await api().get("/api/reportes/baja/abc")).status).toBe(400);
  });
});
