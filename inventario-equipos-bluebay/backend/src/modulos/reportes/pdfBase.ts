import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import type { TipoEquipo } from "../../generated/prisma/enums.ts";

/**
 * Piezas comunes de los reportes imprimibles (alta y baja): hoja carta con el
 * logo del hotel, tabla que continúa en otra página repitiendo sus títulos,
 * firmas y pie de página numerado.
 */

export const LOGO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../recursos/logo-blue-bay.png");

export const COLOR_TINTA = "#16212B";
export const COLOR_TENUE = "#4F5B66";
export const COLOR_PRIMARIO = "#0B4F6C";
const COLOR_LINEA = "#CFC8BA";
const COLOR_FONDO_ENCABEZADO = "#E2EDF1";
const RELLENO = 5;

export const ETIQUETAS_TIPO: Record<TipoEquipo, string> = {
  ESCRITORIO: "Escritorio",
  LAPTOP: "Laptop",
  ALL_IN_ONE: "All-in-one",
  MONITOR: "Monitor",
  IMPRESORA: "Impresora",
  OTRO: "Otro",
};

const formatoMoneda = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
export const moneda = (valor: number) => formatoMoneda.format(valor);
/** "2027-03-15" → "15/03/2027". */
export const fechaCorta = (texto: string) => texto.split("-").reverse().join("/");
export const SIN_DATO = "—";

export interface Columna {
  titulo: string;
  ancho: number;
  alinear: "left" | "center" | "right";
}

export interface Firma {
  titulo: string;
  /** Nombre impreso sobre la línea (si se conoce). */
  nombre?: string | null;
  detalle: string;
}

/** Crea el documento y devuelve las utilidades para dibujarlo. */
export function crearReporte(opciones: {
  titulo: string;
  /** Líneas de la esquina superior derecha, bajo "DEPARTAMENTO DE SISTEMAS". */
  datosDerecha: string[];
  encabezado: string;
  introduccion: string;
}) {
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 50, bottom: 60, left: 50, right: 50 },
    bufferPages: true,
    info: { Title: opciones.titulo, Author: "Departamento de Sistemas · Blue Bay Grand Esmeralda" },
  });
  const partes: Buffer[] = [];
  doc.on("data", (parte: Buffer) => partes.push(parte));
  const terminado = new Promise<Buffer>((resolver, rechazar) => {
    doc.on("end", () => resolver(Buffer.concat(partes)));
    doc.on("error", rechazar);
  });

  const izquierda = doc.page.margins.left;
  const anchoUtil = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const limiteInferior = () => doc.page.height - doc.page.margins.bottom;

  // ---------------------------------------------------------- encabezado
  doc.image(LOGO, izquierda, 42, { width: 150 });
  doc
    .font("Helvetica-Bold").fontSize(9).fillColor(COLOR_TENUE)
    .text("DEPARTAMENTO DE SISTEMAS", izquierda, 50, { width: anchoUtil, align: "right", characterSpacing: 0.6 })
    .font("Helvetica");
  for (const linea of opciones.datosDerecha) doc.text(linea, { width: anchoUtil, align: "right" });

  doc
    .moveTo(izquierda, 112).lineTo(izquierda + anchoUtil, 112).lineWidth(1.5).strokeColor(COLOR_PRIMARIO).stroke()
    .font("Helvetica-Bold").fontSize(15).fillColor(COLOR_TINTA)
    .text(opciones.encabezado, izquierda, 126, { width: anchoUtil, align: "center" })
    .moveDown(0.6)
    .font("Helvetica").fontSize(10).fillColor(COLOR_TENUE)
    .text(opciones.introduccion, { width: anchoUtil, align: "left" });

  /** Posición vertical actual de lo que se dibuja con coordenadas propias. */
  let y = doc.y + 12;

  /** Si lo que sigue (de la altura dada) no cabe, pasa a otra página. */
  function asegurarEspacio(alto: number): boolean {
    if (y + alto <= limiteInferior()) return false;
    doc.addPage();
    y = doc.page.margins.top;
    return true;
  }

  /** Tabla con filas de altura variable; en cada página nueva repite los títulos. */
  function tabla(columnas: readonly Columna[], filas: string[][]) {
    function alturaFila(celdas: string[], fuente: string, tamano: number) {
      doc.font(fuente).fontSize(tamano);
      return Math.max(...celdas.map((texto, i) => doc.heightOfString(texto, { width: columnas[i]!.ancho - RELLENO * 2 }))) + RELLENO * 2;
    }
    function dibujarFila(celdas: string[], estilo: { fuente: string; tamano: number; fondo?: string; color?: string }) {
      const alto = alturaFila(celdas, estilo.fuente, estilo.tamano);
      if (estilo.fondo) doc.rect(izquierda, y, anchoUtil, alto).fill(estilo.fondo);
      let x = izquierda;
      celdas.forEach((texto, i) => {
        const columna = columnas[i]!;
        doc
          .font(estilo.fuente).fontSize(estilo.tamano).fillColor(estilo.color ?? COLOR_TINTA)
          .text(texto, x + RELLENO, y + RELLENO, { width: columna.ancho - RELLENO * 2, align: columna.alinear });
        x += columna.ancho;
      });
      y += alto;
      doc.moveTo(izquierda, y).lineTo(izquierda + anchoUtil, y).lineWidth(0.5).strokeColor(COLOR_LINEA).stroke();
    }
    const titulos = () =>
      dibujarFila(columnas.map((c) => c.titulo), { fuente: "Helvetica-Bold", tamano: 8.5, fondo: COLOR_FONDO_ENCABEZADO, color: COLOR_PRIMARIO });

    titulos();
    for (const celdas of filas) {
      if (asegurarEspacio(alturaFila(celdas, "Helvetica", 9))) titulos();
      dibujarFila(celdas, { fuente: "Helvetica", tamano: 9 });
    }
  }

  /** "Costo total" alineado bajo la columna del costo (índice dado). */
  function total(columnas: readonly Columna[], indiceCosto: number, centavos: number, sinCosto: number) {
    const anchoEtiqueta = columnas.slice(0, indiceCosto).reduce((suma, c) => suma + c.ancho, 0);
    doc
      .font("Helvetica-Bold").fontSize(9.5).fillColor(COLOR_TINTA)
      .text("Costo total", izquierda, y + 8, { width: anchoEtiqueta - RELLENO, align: "right" })
      .text(moneda(centavos / 100), izquierda + anchoEtiqueta, y + 8, { width: columnas[indiceCosto]!.ancho - RELLENO, align: "right" });
    y += 26;
    if (sinCosto > 0) {
      doc
        .font("Helvetica-Oblique").fontSize(8.5).fillColor(COLOR_TENUE)
        .text(
          `${sinCosto} ${sinCosto === 1 ? "equipo no tiene" : "equipos no tienen"} costo registrado y no ${sinCosto === 1 ? "suma" : "suman"} al total.`,
          izquierda, y, { width: anchoUtil },
        );
      y = doc.y + 6;
    }
  }

  /** Dos firmas al pie de la última página. */
  function firmas(lista: [Firma, Firma]) {
    asegurarEspacio(120);
    const yLinea = Math.max(y + 70, limiteInferior() - 40);
    const anchoFirma = 200;
    const posiciones = [izquierda + 20, izquierda + anchoUtil - anchoFirma - 20];
    lista.forEach((firma, i) => {
      const x = posiciones[i]!;
      if (firma.nombre) {
        doc.font("Helvetica").fontSize(10).fillColor(COLOR_TINTA).text(firma.nombre, x, yLinea - 16, { width: anchoFirma, align: "center" });
      }
      doc.moveTo(x, yLinea).lineTo(x + anchoFirma, yLinea).lineWidth(0.8).strokeColor(COLOR_TINTA).stroke();
      doc
        .font("Helvetica-Bold").fontSize(10).fillColor(COLOR_TINTA)
        .text(firma.titulo, x, yLinea + 6, { width: anchoFirma, align: "center" })
        .font("Helvetica").fontSize(8.5).fillColor(COLOR_TENUE)
        .text(firma.detalle, { width: anchoFirma, align: "center" });
    });
  }

  /** Numera las páginas y cierra el documento. */
  function terminar(): Promise<Buffer> {
    const paginas = doc.bufferedPageRange();
    for (let i = 0; i < paginas.count; i++) {
      doc.switchToPage(paginas.start + i);
      const margenInferior = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // permite escribir en el margen sin crear otra página
      doc
        .font("Helvetica").fontSize(8).fillColor(COLOR_TENUE)
        .text(
          `Blue Bay Grand Esmeralda · Sistema de inventario de equipos de cómputo · Página ${i + 1} de ${paginas.count}`,
          izquierda, doc.page.height - 36, { width: anchoUtil, align: "center" },
        );
      doc.page.margins.bottom = margenInferior;
    }
    doc.end();
    return terminado;
  }

  return { tabla, total, firmas, terminar };
}

/** Suma costos ("21500.00" o null) en centavos enteros: sin errores de punto flotante. */
export function sumarCostos(costos: (string | null)[]) {
  let centavos = 0;
  let sinCosto = 0;
  for (const costo of costos) {
    if (costo === null) sinCosto++;
    else centavos += Math.round(Number(costo) * 100);
  }
  return { centavos, sinCosto };
}
