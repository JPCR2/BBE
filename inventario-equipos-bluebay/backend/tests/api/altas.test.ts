import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { crearApp } from "../../src/app.ts";
import { fechaDesdeTexto } from "../../src/lib/fechas.ts";
import { generarPdfAlta } from "../../src/modulos/reportes/reporteAlta.ts";
import { crearEquipo, db, limpiarTablas, rechazo, iniciarSesionDePrueba } from "../helpers/contexto.ts";
import { paginasDelPdf, textoDelPdf } from "../helpers/pdf.ts";

// "Ahora" fijo: 23 de septiembre de 2026 en Playa del Carmen.
const app = crearApp({ db, reloj: () => new Date("2026-09-23T16:00:00Z") });
// Todas las rutas exigen sesión: las pruebas usan un técnico ya autenticado.
const sesion = await iniciarSesionDePrueba(app);
const api = () => sesion;

beforeEach(limpiarTablas);
afterAll(() => db.$disconnect());

const alta = {
  numeroSerie: "5CD1234XYZ",
  tipo: "LAPTOP",
  marca: "Dell",
  modelo: "Latitude 5440",
  fechaAdquisicion: "2026-03-15",
  costo: "21500",
  folioFactura: "  FAC-A-10234 ",
  fechaVencimientoGarantia: "2027-03-15",
};

/** Equipo registrado antes de que el sistema pidiera factura y garantía. */
async function equipoAntiguo(datos: Partial<{ fechaAdquisicion: string; fechaVencimientoGarantia: string }> = {}) {
  const equipo = await crearEquipo({ numeroSerie: "VIEJO-1" });
  return db.equipo.update({
    where: { id: equipo.id },
    data: {
      ...(datos.fechaAdquisicion ? { fechaAdquisicion: fechaDesdeTexto(datos.fechaAdquisicion) } : {}),
      ...(datos.fechaVencimientoGarantia ? { fechaVencimientoGarantia: fechaDesdeTexto(datos.fechaVencimientoGarantia) } : {}),
    },
  });
}

// =============================================================================
describe("Alta con folio de factura y garantía", () => {
  it("guarda el folio (sin espacios de más) y la garantía, y dice si está vigente", async () => {
    const res = await api().post("/api/equipos").send(alta);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ folioFactura: "FAC-A-10234", fechaVencimientoGarantia: "2027-03-15", garantiaVigente: true });
  });

  it("en un alta nueva, el folio y la garantía son obligatorios", async () => {
    const { folioFactura: _f, fechaVencimientoGarantia: _g, ...sinDatos } = alta;
    const res = await api().post("/api/equipos").send({ ...sinDatos, folioFactura: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error.campos).toMatchObject({
      folioFactura: "Escribe el folio de la factura.",
      fechaVencimientoGarantia: "Elige la fecha en que vence la garantía.",
    });
    expect(await db.equipo.count()).toBe(0);
  });

  it.each([
    ["que vence antes de la compra", "2026-03-14", "La garantía no puede vencer antes de la fecha de adquisición."],
    ["con un día inexistente", "2027-02-29", "ese día no existe en el calendario"],
    ["con otro formato", "15/03/2027", "se esperaba el formato AAAA-MM-DD"],
  ])("rechaza una garantía %s", async (_caso, fechaVencimientoGarantia, mensaje) => {
    const res = await api().post("/api/equipos").send({ ...alta, fechaVencimientoGarantia });
    expect(res.status).toBe(400);
    expect(res.body.error.campos.fechaVencimientoGarantia).toContain(mensaje);
  });

  it("acepta una garantía que vence el mismo día de la compra o que ya venció (equipo usado)", async () => {
    await api().post("/api/equipos").send({ ...alta, fechaVencimientoGarantia: "2026-03-15" }).expect(201);
    const vencida = await api()
      .post("/api/equipos")
      .send({ ...alta, numeroSerie: "USADO-1", fechaAdquisicion: "2020-01-10", fechaVencimientoGarantia: "2021-01-10" });
    expect(vencida.status).toBe(201);
    expect(vencida.body.garantiaVigente).toBe(false);
  });

  it("sin fecha de adquisición no puede comparar, así que acepta la garantía", async () => {
    const res = await api().post("/api/equipos").send({ ...alta, fechaAdquisicion: "", fechaVencimientoGarantia: "2020-01-01" });
    expect(res.status).toBe(201);
  });

  it("rechaza un folio de más de 50 caracteres", async () => {
    const res = await api().post("/api/equipos").send({ ...alta, folioFactura: "F".repeat(51) });
    expect(res.status).toBe(400);
    expect(res.body.error.campos.folioFactura).toBe("Máximo 50 caracteres.");
  });

  it("la garantía vence el último día de su fecha: ese día sigue vigente", async () => {
    const res = await api().post("/api/equipos").send({ ...alta, fechaVencimientoGarantia: "2026-09-23" });
    expect(res.body.garantiaVigente).toBe(true);
    const ayer = await api().post("/api/equipos").send({ ...alta, numeroSerie: "OTRO-1", fechaVencimientoGarantia: "2026-09-22" });
    expect(ayer.body.garantiaVigente).toBe(false);
  });

  it("se puede buscar en el inventario por folio de factura", async () => {
    await api().post("/api/equipos").send(alta).expect(201);
    await api().post("/api/equipos").send({ ...alta, numeroSerie: "OTRA-FACTURA", folioFactura: "FAC-B-555" }).expect(201);
    const res = await api().get("/api/equipos").query({ busqueda: "fac-a-10234" });
    expect(res.body.datos.map((e: { numeroSerie: string }) => e.numeroSerie)).toEqual(["5CD1234XYZ"]);
  });
});

// =============================================================================
describe("Edición de equipos anteriores al sistema", () => {
  it("se pueden editar sin capturar folio ni garantía", async () => {
    const viejo = await equipoAntiguo();
    const res = await api().patch(`/api/equipos/${viejo.id}`).send({ ubicacion: "Bodega" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ubicacion: "Bodega", folioFactura: null, fechaVencimientoGarantia: null, garantiaVigente: null });
  });

  it("se les puede agregar y quitar el folio después", async () => {
    const viejo = await equipoAntiguo();
    expect((await api().patch(`/api/equipos/${viejo.id}`).send({ folioFactura: "FAC-2019-88" })).body.folioFactura).toBe("FAC-2019-88");
    expect((await api().patch(`/api/equipos/${viejo.id}`).send({ folioFactura: "" })).body.folioFactura).toBeNull();
  });

  it("revisa la garantía contra la fecha de adquisición ya guardada", async () => {
    const viejo = await equipoAntiguo({ fechaAdquisicion: "2022-05-01" });
    const res = await api().patch(`/api/equipos/${viejo.id}`).send({ fechaVencimientoGarantia: "2022-04-30" });
    expect(res.status).toBe(400);
    expect(res.body.error.campos.fechaVencimientoGarantia).toBe("La garantía no puede vencer antes de la fecha de adquisición.");
  });

  it("y la fecha de adquisición contra la garantía ya guardada", async () => {
    const viejo = await equipoAntiguo({ fechaAdquisicion: "2022-05-01", fechaVencimientoGarantia: "2023-05-01" });
    const res = await api().patch(`/api/equipos/${viejo.id}`).send({ fechaAdquisicion: "2023-06-01" });
    expect(res.status).toBe(400);
    expect(res.body.error.campos.fechaAdquisicion).toBe("La garantía no puede vencer antes de la fecha de adquisición.");
    // Cambiando las dos a la vez sí se puede.
    const ambas = await api().patch(`/api/equipos/${viejo.id}`).send({ fechaAdquisicion: "2023-06-01", fechaVencimientoGarantia: "2024-06-01" });
    expect(ambas.status).toBe(200);
  });
});

// =============================================================================
describe("Reglas en la base de datos (segunda barrera)", () => {
  it("rechaza un folio vacío aunque se salte la API", async () => {
    const equipo = await crearEquipo();
    const error = await rechazo(db.equipo.update({ where: { id: equipo.id }, data: { folioFactura: "   " } }));
    expect(error.message).toContain("chk_equipos_folio_no_vacio");
  });

  it("rechaza una garantía anterior a la compra aunque se salte la API", async () => {
    const equipo = await crearEquipo();
    const error = await rechazo(
      db.equipo.update({
        where: { id: equipo.id },
        data: { fechaAdquisicion: fechaDesdeTexto("2024-01-10"), fechaVencimientoGarantia: fechaDesdeTexto("2024-01-09") },
      }),
    );
    expect(error.message).toContain("chk_equipos_garantia_posterior_adquisicion");
  });
});

// =============================================================================
describe("GET /api/reportes/alta (PDF imprimible)", () => {
  async function registrar(cambios: Record<string, unknown>) {
    return (await api().post("/api/equipos").send({ ...alta, ...cambios }).expect(201)).body.id as number;
  }

  it("genera el PDF con los datos que pide el hotel y el costo total", async () => {
    const a = await registrar({});
    const b = await registrar({ numeroSerie: "MJ0ABCDE", tipo: "ALL_IN_ONE", marca: "Lenovo", modelo: "IdeaCentre AIO 3", costo: "16990.50", fechaVencimientoGarantia: "2028-01-20" });

    const res = await api().get("/api/reportes/alta").query({ ids: `${a},${b}` }).buffer(true).parse((r, fin) => {
      const partes: Buffer[] = [];
      r.on("data", (p: Buffer) => partes.push(p));
      r.on("end", () => fin(null, Buffer.concat(partes)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe('inline; filename="reporte-alta-2026-09-23.pdf"');
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    const texto = textoDelPdf(pdf);
    for (const esperado of [
      "REPORTE DE ALTA DE EQUIPO DE CÓMPUTO",
      "Fecha de emisión: 23/09/2026",
      "Número de serie /", "Service Tag", "Folio de factura", "Vencimiento de",
      "Dell Latitude 5440", "5CD1234XYZ", "FAC-A-10234", "$21,500.00", "15/03/2027",
      "Lenovo IdeaCentre AIO 3", "MJ0ABCDE", "$16,990.50", "20/01/2028",
      "Costo total", "$38,490.50",
      "Elaboró", "Autorizó", "Página 1 de 1",
    ]) {
      expect(texto, `falta «${esperado}» en el PDF`).toContain(esperado);
    }
  });

  it("marca con — los datos que no tiene un equipo antiguo y lo avisa en el total", async () => {
    const viejo = await equipoAntiguo();
    const pdf = await generarPdfAlta(
      [{ tipo: "MONITOR", marca: "Samsung", modelo: "S24C310", numeroSerie: "VIEJO-1", costo: null, folioFactura: null, fechaVencimientoGarantia: null }],
      { fechaEmision: "2026-09-23" },
    );
    const texto = textoDelPdf(pdf);
    expect(texto).toContain("VIEJO-1");
    expect(texto).toContain("—");
    expect(texto).toContain("1 equipo no tiene costo registrado y no suma al total.");
    expect((await api().get(`/api/reportes/alta?ids=${viejo.id}`)).status).toBe(200);
  });

  it("suma los centavos sin errores de punto flotante", async () => {
    const fila = { tipo: "OTRO", marca: "X", modelo: "Y", folioFactura: "F", fechaVencimientoGarantia: null } as const;
    const pdf = await generarPdfAlta(
      [{ ...fila, numeroSerie: "A", costo: "0.10" }, { ...fila, numeroSerie: "B", costo: "0.20" }],
      { fechaEmision: "2026-09-23" },
    );
    expect(textoDelPdf(pdf)).toContain("$0.30");
  });

  it("con muchos equipos continúa en otras páginas y repite los títulos de la tabla", async () => {
    const filas = Array.from({ length: 40 }, (_, i) => ({
      tipo: "LAPTOP" as const, marca: "Dell", modelo: "Latitude 5440", numeroSerie: `SN${String(i).padStart(3, "0")}`,
      costo: "1000.00", folioFactura: "FAC-1", fechaVencimientoGarantia: "2027-01-01",
    }));
    const pdf = await generarPdfAlta(filas, { fechaEmision: "2026-09-23" });
    const paginas = paginasDelPdf(pdf);
    expect(paginas).toBeGreaterThan(1);
    const texto = textoDelPdf(pdf);
    expect(texto).toContain("SN039");
    expect(texto).toContain("$40,000.00");
    expect(texto).toContain(`Página ${paginas} de ${paginas}`);
    expect(texto.split("Folio de factura").length - 1).toBe(paginas);
  });

  it("ignora ids repetidos", async () => {
    const a = await registrar({});
    const res = await api().get(`/api/reportes/alta?ids=${a},${a}`);
    expect(res.status).toBe(200);
  });

  it("responde 404 y dice qué equipos no existen", async () => {
    const a = await registrar({});
    const res = await api().get(`/api/reportes/alta?ids=${a},999998,999999`);
    expect(res.status).toBe(404);
    expect(res.body.error.mensaje).toBe("No existen los equipos con id 999998, 999999.");
  });

  it.each([
    ["sin ids", "", "Indica los equipos del reporte"],
    ["con texto", "?ids=abc", "separados por comas"],
    ["con coma al final", "?ids=1,", "separados por comas"],
    ["con cero", "?ids=0", "mayores que cero"],
    ["con demasiados equipos", `?ids=${Array.from({ length: 101 }, (_, i) => i + 1).join(",")}`, "Máximo 100 equipos"],
  ])("rechaza la petición %s", async (_caso, consulta, mensaje) => {
    const res = await api().get(`/api/reportes/alta${consulta}`);
    expect(res.status).toBe(400);
    expect(res.body.error.campos.ids).toContain(mensaje);
  });
});
