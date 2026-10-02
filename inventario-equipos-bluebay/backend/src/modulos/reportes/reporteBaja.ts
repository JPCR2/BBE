import PDFDocument from "pdfkit";
import type { DetalleBaja } from "../bajas/bajas.modulo.ts";
import { COLOR_TENUE, COLOR_TINTA, ETIQUETAS_TIPO, LOGO, SIN_DATO } from "./pdfBase.ts";

/**
 * Reporte de baja con el formato del hotel "BAJAS DE EQUIPO OPERACIONAL":
 * hoja carta horizontal con marco, una tabla DEPTO / DESCRIPCIÓN / CANTIDAD /
 * COSTO / TIEMPO DE USO / OBSERVACIONES y cuatro firmas a mano.
 */

/** Razón social que aparece en el formato del hotel. */
export const RAZON_SOCIAL = "GIRONA CONSULTORES, S.A. DE C.V.";
/** Departamento que da de baja (el sistema es del Departamento de Sistemas). */
export const DEPARTAMENTO = "SISTEMAS";
/** Renglones mínimos de la tabla, como el formato en papel. */
const RENGLONES_MINIMOS = 6;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "2026-04-09" → "09-abr-26", como lo escribe el formato. */
export function fechaFormatoHotel(texto: string): string {
  const [anio, mes, dia] = texto.split("-");
  return `${dia}-${MESES[Number(mes) - 1]}-${anio!.slice(2)}`;
}

/** 0 → "MENOS DE 1 AÑO", 1 → "1 AÑO", 6 → "6 AÑOS". */
export function textoAnios(anios: number): string {
  if (anios === 0) return "MENOS DE 1 AÑO";
  return `${anios} ${anios === 1 ? "AÑO" : "AÑOS"}`;
}

const formatoNumero = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface Renglon {
  descripcion: string;
  /** Números de serie de los equipos del renglón (vacío para artículos). */
  series: string[];
  cantidad: number;
  /** Costo total del renglón en centavos; null si ninguno tiene costo. */
  centavos: number | null;
  /** Algún equipo del renglón no tiene costo registrado. */
  costoIncompleto: boolean;
  tiempoUso: string;
  observaciones: string;
}

/**
 * Convierte el acta en los renglones del formato. Los equipos del inventario
 * con el mismo tipo, marca, modelo y motivo se juntan en un renglón con su
 * cantidad (y sus números de serie debajo); luego van los artículos.
 */
export function renglonesDelActa(baja: DetalleBaja): Renglon[] {
  const grupos = new Map<string, DetalleBaja["equipos"]>();
  for (const equipo of baja.equipos) {
    const clave = [equipo.tipo, equipo.marca, equipo.modelo, equipo.observaciones]
      .map((parte) => parte.trim().toUpperCase())
      .join("|");
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave)!.push(equipo);
  }

  const renglones: Renglon[] = [...grupos.values()].map((equipos) => {
    const primero = equipos[0]!;
    const conCosto = equipos.filter((e) => e.costo !== null);
    const anios = equipos.filter((e) => e.tiempoFuncionamiento).map((e) => e.tiempoFuncionamiento!.anios);
    const minimo = Math.min(...anios);
    const maximo = Math.max(...anios);
    return {
      descripcion: `${ETIQUETAS_TIPO[primero.tipo]} ${primero.marca} ${primero.modelo}`.toUpperCase(),
      series: equipos.map((e) => e.numeroSerie),
      cantidad: equipos.length,
      centavos: conCosto.length > 0 ? conCosto.reduce((suma, e) => suma + Math.round(Number(e.costo) * 100), 0) : null,
      costoIncompleto: conCosto.length > 0 && conCosto.length < equipos.length,
      tiempoUso:
        anios.length === 0 ? SIN_DATO : minimo === maximo ? textoAnios(minimo) : `${minimo} A ${textoAnios(maximo)}`,
      observaciones: primero.observaciones.toUpperCase(),
    };
  });

  for (const articulo of baja.articulos) {
    renglones.push({
      descripcion: articulo.descripcion.toUpperCase(),
      series: [],
      cantidad: articulo.cantidad,
      centavos: articulo.costo !== null ? Math.round(Number(articulo.costo) * 100) : null,
      costoIncompleto: false,
      tiempoUso: articulo.aniosUso !== null ? textoAnios(articulo.aniosUso) : SIN_DATO,
      observaciones: articulo.observaciones.toUpperCase(),
    });
  }
  return renglones;
}

// -----------------------------------------------------------------------------
// PDF
// -----------------------------------------------------------------------------

const MARGEN = 36;
const RELLENO_MARCO = 14;
const RELLENO_CELDA = 4;
const COLUMNAS = [
  { titulo: "DEPTO", ancho: 66 },
  { titulo: "DESCRIPCIÓN", ancho: 216 },
  { titulo: "CANTIDAD", ancho: 62 },
  { titulo: "COSTO", ancho: 92 },
  { titulo: "TIEMPO DE USO", ancho: 76 },
  { titulo: "(MOTIVO DE BAJA Y CONDICIONES DEL EQUIPO)\nOBSERVACIONES", ancho: 180 },
] as const;
const ALTO_FIRMAS = 190;

export function generarPdfBaja(baja: DetalleBaja): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "LETTER",
    layout: "landscape",
    margins: { top: MARGEN, bottom: MARGEN, left: MARGEN, right: MARGEN },
    bufferPages: true,
    info: { Title: `Bajas de equipo operacional ${baja.folio}`, Author: "Departamento de Sistemas · Blue Bay Grand Esmeralda" },
  });
  const partes: Buffer[] = [];
  doc.on("data", (parte: Buffer) => partes.push(parte));
  const terminado = new Promise<Buffer>((resolver, rechazar) => {
    doc.on("end", () => resolver(Buffer.concat(partes)));
    doc.on("error", rechazar);
  });

  const marco = { x: MARGEN, y: MARGEN, ancho: doc.page.width - MARGEN * 2, alto: doc.page.height - MARGEN * 2 - 14 };
  const izquierda = marco.x + RELLENO_MARCO;
  const anchoUtil = marco.ancho - RELLENO_MARCO * 2;
  const abajo = marco.y + marco.alto - RELLENO_MARCO;
  let y = 0;

  function dibujarMarco() {
    doc.rect(marco.x, marco.y, marco.ancho, marco.alto).lineWidth(1.2).strokeColor(COLOR_TINTA).stroke();
  }

  function encabezado() {
    dibujarMarco();
    doc.image(LOGO, izquierda + 6, marco.y + 12, { width: 170 });
    const xDerecha = izquierda + anchoUtil - 300;
    doc
      .font("Times-Bold").fontSize(13).fillColor(COLOR_TINTA)
      .text(RAZON_SOCIAL, xDerecha, marco.y + 36, { width: 300, align: "center" })
      .font("Times-Bold").fontSize(10)
      .text("Fecha:", xDerecha + 40, marco.y + 62, { width: 60 })
      .font("Times-Roman")
      .text(fechaFormatoHotel(baja.fechaBaja), xDerecha + 130, marco.y + 62, { width: 120 })
      .font("Times-Bold").text("Folio:", xDerecha + 40, marco.y + 78, { width: 60 })
      .font("Times-Roman").text(baja.folio, xDerecha + 130, marco.y + 78, { width: 150 });
    doc
      .font("Times-Bold").fontSize(13).fillColor(COLOR_TINTA)
      .text("BAJAS DE EQUIPO OPERACIONAL", izquierda + 70, marco.y + 112, { width: anchoUtil - 70 });
    y = marco.y + 132;
  }

  // ------------------------------------------------------------------ tabla
  function alturaFila(celdas: string[], series: string[], fuente: string, tamano: number) {
    doc.font(fuente).fontSize(tamano);
    let alto = Math.max(...celdas.map((texto, i) => doc.heightOfString(texto || " ", { width: COLUMNAS[i]!.ancho - RELLENO_CELDA * 2 })));
    if (series.length > 0) {
      const descripcion = doc.heightOfString(celdas[1]!, { width: COLUMNAS[1].ancho - RELLENO_CELDA * 2 });
      doc.font("Helvetica").fontSize(7);
      alto = Math.max(alto, descripcion + 2 + doc.heightOfString(`SERIE: ${series.join(", ")}`, { width: COLUMNAS[1].ancho - RELLENO_CELDA * 2 }));
    }
    return Math.max(alto + RELLENO_CELDA * 2, 18);
  }

  function celdas(alto: number) {
    let x = izquierda;
    for (const columna of COLUMNAS) {
      doc.rect(x, y, columna.ancho, alto).lineWidth(0.6).strokeColor(COLOR_TINTA).stroke();
      x += columna.ancho;
    }
  }

  function titulosTabla() {
    const titulos = COLUMNAS.map((c) => c.titulo);
    const alto = alturaFila(titulos, [], "Times-Bold", 9);
    celdas(alto);
    let x = izquierda;
    COLUMNAS.forEach((columna) => {
      doc.font("Times-Bold").fontSize(9).fillColor(COLOR_TINTA);
      const altoTexto = doc.heightOfString(columna.titulo, { width: columna.ancho - RELLENO_CELDA * 2 });
      doc.text(columna.titulo, x + RELLENO_CELDA, y + (alto - altoTexto) / 2, { width: columna.ancho - RELLENO_CELDA * 2, align: "center" });
      x += columna.ancho;
    });
    y += alto;
  }

  function fila(renglon: Renglon | null, esPrimero: boolean) {
    const costo = renglon?.centavos != null ? formatoNumero.format(renglon.centavos / 100) + (renglon.costoIncompleto ? " *" : "") : "";
    const textos = renglon
      ? [esPrimero ? DEPARTAMENTO : "", renglon.descripcion, String(renglon.cantidad), costo, renglon.tiempoUso, renglon.observaciones]
      : ["", "", "", "", "", ""];
    const series = renglon?.series ?? [];
    const alto = alturaFila(textos, series, "Times-Roman", 9);
    if (y + alto > abajo) {
      doc.addPage();
      encabezado();
      titulosTabla();
    }
    celdas(alto);
    let x = izquierda;
    textos.forEach((texto, i) => {
      const ancho = COLUMNAS[i]!.ancho - RELLENO_CELDA * 2;
      doc.font("Times-Roman").fontSize(i === 0 ? 8.5 : 9).fillColor(COLOR_TINTA);
      if (i === 3 && texto) {
        // Como en el formato: el signo de pesos a la izquierda y la cantidad a la derecha.
        doc.text("$", x + RELLENO_CELDA, y + RELLENO_CELDA, { width: ancho });
        doc.text(texto, x + RELLENO_CELDA, y + RELLENO_CELDA, { width: ancho, align: "right" });
      } else {
        doc.text(texto, x + RELLENO_CELDA, y + RELLENO_CELDA, { width: ancho, align: i === 1 ? "left" : "center" });
        if (i === 1 && series.length > 0) {
          doc.font("Helvetica").fontSize(7).fillColor(COLOR_TENUE).text(`SERIE: ${series.join(", ")}`, { width: ancho });
        }
      }
      x += COLUMNAS[i]!.ancho;
    });
    y += alto;
  }

  encabezado();
  titulosTabla();
  const renglones = renglonesDelActa(baja);
  renglones.forEach((renglon, i) => fila(renglon, i === 0));
  for (let i = renglones.length; i < RENGLONES_MINIMOS; i++) fila(null, false);

  if (renglones.some((r) => r.costoIncompleto)) {
    doc
      .font("Helvetica-Oblique").fontSize(7.5).fillColor(COLOR_TENUE)
      .text("* Algún equipo del renglón no tiene costo registrado; el costo es la suma de los que sí lo tienen.", izquierda, y + 4, { width: anchoUtil });
    y = doc.y;
  }

  // ----------------------------------------------------------------- firmas
  if (y + ALTO_FIRMAS > abajo) {
    doc.addPage();
    encabezado();
  }
  const yFirmas = Math.max(y + 24, abajo - ALTO_FIRMAS + 10);
  const anchoFirma = 240;
  const firmas = [
    { etiqueta: "FIRMA", cargo: "JEFE DEPARTAMENTAL", x: izquierda + 10, y: yFirmas },
    { etiqueta: "RECIBE", cargo: "CONTRALOR DE COSTOS", x: izquierda + anchoUtil - anchoFirma - 10, y: yFirmas },
    { etiqueta: "AUTORIZACIÓN", cargo: "DIRECTOR", x: izquierda + 10, y: yFirmas + 95 },
    { etiqueta: "VO. BO.", cargo: "CONTRALOR GENERAL", x: izquierda + anchoUtil - anchoFirma - 10, y: yFirmas + 95 },
  ];
  for (const firma of firmas) {
    const yLinea = firma.y + 58;
    doc.font("Times-Bold").fontSize(9.5).fillColor(COLOR_TINTA).text(firma.etiqueta, firma.x, firma.y, { width: anchoFirma });
    doc.moveTo(firma.x, yLinea).lineTo(firma.x + anchoFirma, yLinea).lineWidth(0.8).strokeColor(COLOR_TINTA).stroke();
    doc.font("Times-Bold").fontSize(9.5).text(firma.cargo, firma.x, yLinea + 4, { width: anchoFirma });
  }

  // ------------------------------------------------- pie de página numerado
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(paginas.start + i);
    const margenInferior = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // permite escribir fuera del marco sin crear otra página
    doc
      .font("Helvetica").fontSize(7.5).fillColor(COLOR_TENUE)
      .text(
        `${baja.folio} · Capturó: ${baja.elaboro} · Página ${i + 1} de ${paginas.count}`,
        marco.x, marco.y + marco.alto + 5, { width: marco.ancho, align: "right" },
      );
    doc.page.margins.bottom = margenInferior;
  }

  doc.end();
  return terminado;
}
