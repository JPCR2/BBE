import PDFDocument from "pdfkit";
import type { DetalleBaja } from "../bajas/bajas.modulo.ts";
import { COLOR_TENUE, COLOR_TINTA, ETIQUETAS_TIPO, LOGO, SIN_DATO } from "./pdfBase.ts";

/**
 * Reporte de baja con el formato del hotel "BAJA DE EQUIPO OPERACIONAL"
 * (versión de noviembre de 2026, razón social Econova):
 *
 * 1. Resumen: hoja carta horizontal con marco, tabla DEPTO / DESCRIPCIÓN /
 *    CANTIDAD / COSTO UNITARIO / COSTO TOTAL / TIEMPO DE USO / MOTIVO, renglón
 *    de totales y las cuatro firmas con nombre y cargo. Es la hoja que se firma.
 * 2. Relación de equipos: el detalle por tipo de equipo con No., dispositivo,
 *    marca, modelo y número de serie, para cotejar contra los equipos físicos;
 *    al final, los artículos sin número de serie.
 */

/** Razón social del formato; se puede cambiar con RAZON_SOCIAL_BAJA en el .env. */
export const RAZON_SOCIAL_PREDETERMINADA = "ECONOVA SUSTAINABILITY S.A. de C.V.";
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
const pesos = (centavos: number) => formatoNumero.format(centavos / 100);

// -----------------------------------------------------------------------------
// Configuración (razón social y firmantes)
// -----------------------------------------------------------------------------

export interface FirmaBaja {
  etiqueta: string;
  cargo: string;
  /** Nombre impreso sobre el cargo; vacío si no se configuró. */
  nombre: string;
}

export interface ConfiguracionBaja {
  razonSocial: string;
  firmas: FirmaBaja[];
}

/** Lee la razón social y los nombres de los firmantes del .env (si faltan, solo sale el cargo). */
export function configuracionDesdeEntorno(entorno: NodeJS.ProcessEnv = process.env): ConfiguracionBaja {
  const texto = (clave: string) => (entorno[clave] ?? "").trim();
  return {
    razonSocial: texto("RAZON_SOCIAL_BAJA") || RAZON_SOCIAL_PREDETERMINADA,
    firmas: [
      { etiqueta: "FIRMA", cargo: "JEFE DEPARTAMENTAL", nombre: texto("FIRMA_JEFE_DEPARTAMENTAL") },
      { etiqueta: "RECIBE", cargo: "CONTRALOR DE COSTOS", nombre: texto("FIRMA_CONTRALOR_COSTOS") },
      { etiqueta: "AUTORIZACIÓN", cargo: "DIRECTOR GENERAL", nombre: texto("FIRMA_DIRECTOR_GENERAL") },
      { etiqueta: "VO. BO.", cargo: "CONTRALOR GENERAL", nombre: texto("FIRMA_CONTRALOR_GENERAL") },
    ],
  };
}

// -----------------------------------------------------------------------------
// Renglones del resumen
// -----------------------------------------------------------------------------

export interface Renglon {
  descripcion: string;
  /** Números de serie de los equipos del renglón (vacío para artículos). */
  series: string[];
  cantidad: number;
  /** Costo por unidad en centavos; null si no hay costo o si los equipos cuestan distinto. */
  centavosUnitario: number | null;
  /** Los equipos del renglón tienen costos distintos (se imprime "VARIOS"). */
  unitarioVarios: boolean;
  /** Costo total del renglón en centavos; null si ninguno tiene costo. */
  centavos: number | null;
  /** Algún equipo del renglón no tiene costo registrado. */
  costoIncompleto: boolean;
  tiempoUso: string;
  observaciones: string;
}

type EquipoDeBaja = DetalleBaja["equipos"][number];

/** Equipos de un mismo tipo van juntos; los de tipo "Otro" se separan por marca y modelo. */
function claveDeTipo(equipo: EquipoDeBaja) {
  return equipo.tipo === "OTRO" ? `OTRO|${equipo.marca.trim().toUpperCase()}|${equipo.modelo.trim().toUpperCase()}` : equipo.tipo;
}

function descripcionDeGrupo(equipo: EquipoDeBaja) {
  return (equipo.tipo === "OTRO" ? `${equipo.marca} ${equipo.modelo}` : ETIQUETAS_TIPO[equipo.tipo]).toUpperCase();
}

/** Une los tiempos escritos y el intervalo calculado con las fechas de adquisición. */
function tiempoDelGrupo(equipos: EquipoDeBaja[]) {
  const escritos = [...new Set(equipos.map((e) => e.tiempoUso?.trim().toUpperCase()).filter((t): t is string => !!t))];
  const anios = equipos.filter((e) => !e.tiempoUso?.trim() && e.tiempoFuncionamiento).map((e) => e.tiempoFuncionamiento!.anios);
  const partes = [...escritos];
  if (anios.length > 0) {
    const minimo = Math.min(...anios);
    const maximo = Math.max(...anios);
    partes.push(minimo === maximo ? textoAnios(minimo) : `${minimo} A ${textoAnios(maximo)}`);
  }
  return partes.length > 0 ? partes.join(" / ") : SIN_DATO;
}

/**
 * Convierte el acta en los renglones del resumen. Los equipos del mismo tipo y
 * con el mismo motivo se juntan en un renglón con su cantidad, su costo
 * unitario y su costo total; luego van los artículos sin número de serie.
 */
export function renglonesDelActa(baja: DetalleBaja): Renglon[] {
  const grupos = new Map<string, EquipoDeBaja[]>();
  for (const equipo of baja.equipos) {
    const clave = `${claveDeTipo(equipo)}|${equipo.observaciones.trim().toUpperCase()}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave)!.push(equipo);
  }

  const renglones: Renglon[] = [...grupos.values()].map((equipos) => {
    const primero = equipos[0]!;
    const costos = equipos.filter((e) => e.costo !== null).map((e) => Math.round(Number(e.costo) * 100));
    const distintos = new Set(costos);
    const todosConCosto = costos.length === equipos.length;
    return {
      descripcion: descripcionDeGrupo(primero),
      series: equipos.map((e) => e.numeroSerie),
      cantidad: equipos.length,
      centavosUnitario: todosConCosto && distintos.size === 1 ? costos[0]! : null,
      unitarioVarios: distintos.size > 1,
      centavos: costos.length > 0 ? costos.reduce((suma, c) => suma + c, 0) : null,
      costoIncompleto: costos.length > 0 && !todosConCosto,
      tiempoUso: tiempoDelGrupo(equipos),
      observaciones: primero.observaciones.toUpperCase(),
    };
  });

  for (const articulo of baja.articulos) {
    const centavos = articulo.costo !== null ? Math.round(Number(articulo.costo) * 100) : null;
    const tiempoEscrito = articulo.tiempoUso?.trim();
    renglones.push({
      descripcion: articulo.descripcion.toUpperCase(),
      series: [],
      cantidad: articulo.cantidad,
      // El costo del artículo se captura total; el unitario se deduce.
      centavosUnitario: centavos !== null ? Math.round(centavos / articulo.cantidad) : null,
      unitarioVarios: false,
      centavos,
      costoIncompleto: false,
      tiempoUso: tiempoEscrito ? tiempoEscrito.toUpperCase() : articulo.aniosUso !== null ? textoAnios(articulo.aniosUso) : SIN_DATO,
      observaciones: articulo.observaciones.toUpperCase(),
    });
  }
  return renglones;
}

/** Totales del acta: piezas (equipos + artículos) y costo. */
export function totalesDelActa(renglones: Renglon[]) {
  return {
    cantidad: renglones.reduce((suma, r) => suma + r.cantidad, 0),
    centavos: renglones.reduce((suma, r) => suma + (r.centavos ?? 0), 0),
  };
}

/** Equipos agrupados por tipo para la relación de detalle (en el orden en que aparecen en el resumen). */
export function relacionPorTipo(baja: DetalleBaja) {
  const grupos = new Map<string, { titulo: string; equipos: EquipoDeBaja[] }>();
  for (const equipo of baja.equipos) {
    const clave = equipo.tipo;
    if (!grupos.has(clave)) grupos.set(clave, { titulo: ETIQUETAS_TIPO[equipo.tipo].toUpperCase(), equipos: [] });
    grupos.get(clave)!.equipos.push(equipo);
  }
  return [...grupos.values()];
}

// -----------------------------------------------------------------------------
// PDF
// -----------------------------------------------------------------------------

const MARGEN = 36;
const RELLENO_MARCO = 14;
const RELLENO_CELDA = 4;

interface Columna { titulo: string; ancho: number; alinear: "left" | "center" | "right" }

const COLUMNAS_RESUMEN: Columna[] = [
  { titulo: "DEPTO", ancho: 60, alinear: "center" },
  { titulo: "DESCRIPCIÓN", ancho: 168, alinear: "left" },
  { titulo: "CANTIDAD", ancho: 56, alinear: "center" },
  { titulo: "COSTO UNITARIO", ancho: 80, alinear: "right" },
  { titulo: "COSTO TOTAL", ancho: 86, alinear: "right" },
  { titulo: "TIEMPO DE USO", ancho: 72, alinear: "center" },
  { titulo: "MOTIVO DE BAJA Y CONDICIONES DEL EQUIPO", ancho: 170, alinear: "left" },
];

const COLUMNAS_RELACION: Columna[] = [
  { titulo: "NO.", ancho: 44, alinear: "center" },
  { titulo: "DISPOSITIVO", ancho: 150, alinear: "left" },
  { titulo: "MARCA", ancho: 140, alinear: "left" },
  { titulo: "MODELO", ancho: 170, alinear: "left" },
  { titulo: "N/SERIE", ancho: 188, alinear: "left" },
];

const COLUMNAS_ARTICULOS: Columna[] = [
  { titulo: "NO.", ancho: 44, alinear: "center" },
  { titulo: "DESCRIPCIÓN (SIN NÚMERO DE SERIE VISIBLE)", ancho: 290, alinear: "left" },
  { titulo: "CANTIDAD", ancho: 70, alinear: "center" },
  { titulo: "MOTIVO DE BAJA Y CONDICIONES", ancho: 288, alinear: "left" },
];

const ALTO_FIRMAS = 92;

export function generarPdfBaja(baja: DetalleBaja, configuracion: ConfiguracionBaja = configuracionDesdeEntorno()): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "LETTER",
    layout: "landscape",
    margins: { top: MARGEN, bottom: MARGEN, left: MARGEN, right: MARGEN },
    bufferPages: true,
    info: { Title: `Baja de equipo operacional ${baja.folio}`, Author: "Departamento de Sistemas · Blue Bay Grand Esmeralda" },
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

  function encabezado(titulo: string) {
    doc.rect(marco.x, marco.y, marco.ancho, marco.alto).lineWidth(1.2).strokeColor(COLOR_TINTA).stroke();
    doc.image(LOGO, izquierda + 6, marco.y + 12, { width: 170 });
    const xDerecha = izquierda + anchoUtil - 300;
    doc
      .font("Times-Bold").fontSize(13).fillColor(COLOR_TINTA)
      .text(configuracion.razonSocial, xDerecha, marco.y + 36, { width: 300, align: "center" })
      .font("Times-Bold").fontSize(10)
      .text("FECHA:", xDerecha + 40, marco.y + 62, { width: 60 })
      .font("Times-Roman")
      .text(fechaFormatoHotel(baja.fechaBaja), xDerecha + 130, marco.y + 62, { width: 120 })
      .font("Times-Bold").text("FOLIO:", xDerecha + 40, marco.y + 78, { width: 60 })
      .font("Times-Roman").text(baja.folio, xDerecha + 130, marco.y + 78, { width: 150 });
    doc
      .font("Times-Bold").fontSize(13).fillColor(COLOR_TINTA)
      .text(titulo, izquierda + 70, marco.y + 112, { width: anchoUtil - 70 });
    y = marco.y + 132;
  }

  // ------------------------------------------------------------- tablas
  function alturaFila(columnas: Columna[], textos: string[], fuente: string, tamano: number) {
    doc.font(fuente).fontSize(tamano);
    const alto = Math.max(...textos.map((texto, i) => doc.heightOfString(texto || " ", { width: columnas[i]!.ancho - RELLENO_CELDA * 2 })));
    return Math.max(alto + RELLENO_CELDA * 2, 18);
  }

  function celdas(columnas: Columna[], alto: number) {
    let x = izquierda;
    for (const columna of columnas) {
      doc.rect(x, y, columna.ancho, alto).lineWidth(0.6).strokeColor(COLOR_TINTA).stroke();
      x += columna.ancho;
    }
  }

  function titulos(columnas: Columna[]) {
    const textos = columnas.map((c) => c.titulo);
    const alto = alturaFila(columnas, textos, "Times-Bold", 8.5);
    celdas(columnas, alto);
    let x = izquierda;
    for (const columna of columnas) {
      doc.font("Times-Bold").fontSize(8.5).fillColor(COLOR_TINTA);
      const altoTexto = doc.heightOfString(columna.titulo, { width: columna.ancho - RELLENO_CELDA * 2 });
      doc.text(columna.titulo, x + RELLENO_CELDA, y + (alto - altoTexto) / 2, { width: columna.ancho - RELLENO_CELDA * 2, align: "center" });
      x += columna.ancho;
    }
    y += alto;
  }

  /** Dibuja una fila; si no cabe, abre otra página con el encabezado y los títulos de la tabla. */
  function fila(columnas: Columna[], textos: string[], opciones: { titulo: string; negritas?: boolean; alSaltar?: () => void }) {
    const fuente = opciones.negritas ? "Times-Bold" : "Times-Roman";
    const alto = alturaFila(columnas, textos, fuente, 9);
    if (y + alto > abajo) {
      doc.addPage();
      encabezado(opciones.titulo);
      opciones.alSaltar?.();
      titulos(columnas);
    }
    celdas(columnas, alto);
    let x = izquierda;
    textos.forEach((texto, i) => {
      const columna = columnas[i]!;
      const ancho = columna.ancho - RELLENO_CELDA * 2;
      doc.font(fuente).fontSize(9).fillColor(COLOR_TINTA);
      if (columna.alinear === "right" && texto.startsWith("$ ")) {
        // Como en el formato: el signo de pesos a la izquierda y la cantidad a la derecha.
        doc.text("$", x + RELLENO_CELDA, y + RELLENO_CELDA, { width: ancho });
        doc.text(texto.slice(2), x + RELLENO_CELDA, y + RELLENO_CELDA, { width: ancho, align: "right" });
      } else {
        doc.text(texto, x + RELLENO_CELDA, y + RELLENO_CELDA, { width: ancho, align: columna.alinear });
      }
      x += columna.ancho;
    });
    y += alto;
  }

  // ----------------------------------------------------------- 1. resumen
  const TITULO_RESUMEN = "BAJA DE EQUIPO OPERACIONAL";
  encabezado(TITULO_RESUMEN);
  titulos(COLUMNAS_RESUMEN);
  const renglones = renglonesDelActa(baja);
  for (const renglon of renglones) {
    const unitario = renglon.unitarioVarios ? "VARIOS" : renglon.centavosUnitario !== null ? `$ ${pesos(renglon.centavosUnitario)}` : "";
    const total = renglon.centavos !== null ? `$ ${pesos(renglon.centavos)}${renglon.costoIncompleto ? " *" : ""}` : "";
    fila(COLUMNAS_RESUMEN, [DEPARTAMENTO, renglon.descripcion, String(renglon.cantidad), unitario, total, renglon.tiempoUso, renglon.observaciones], {
      titulo: TITULO_RESUMEN,
    });
  }
  for (let i = renglones.length; i < RENGLONES_MINIMOS; i++) fila(COLUMNAS_RESUMEN, ["", "", "", "", "", "", ""], { titulo: TITULO_RESUMEN });
  const totales = totalesDelActa(renglones);
  fila(COLUMNAS_RESUMEN, ["", "TOTAL", String(totales.cantidad), "", `$ ${pesos(totales.centavos)}`, "", ""], { titulo: TITULO_RESUMEN, negritas: true });

  if (renglones.some((r) => r.costoIncompleto) || renglones.some((r) => r.unitarioVarios)) {
    const notas: string[] = [];
    if (renglones.some((r) => r.costoIncompleto)) notas.push("* Algún equipo del renglón no tiene costo registrado; el costo es la suma de los que sí lo tienen.");
    if (renglones.some((r) => r.unitarioVarios)) notas.push("VARIOS: los equipos del renglón tienen costos distintos; el detalle está en el sistema.");
    doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(COLOR_TENUE).text(notas.join("  "), izquierda, y + 4, { width: anchoUtil });
    y = doc.y;
  }

  // ------------------------------------------------------------ firmas
  // Las cuatro firmas en una fila, como en el Excel del hotel.
  if (y + ALTO_FIRMAS > abajo) {
    doc.addPage();
    encabezado(TITULO_RESUMEN);
  }
  const yFirma = Math.max(y + 24, abajo - ALTO_FIRMAS + 6);
  const separacion = 24;
  const anchoFirma = (anchoUtil - separacion * 3) / 4;
  configuracion.firmas.forEach((firma, i) => {
    const x = izquierda + i * (anchoFirma + separacion);
    const yLinea = yFirma + 46;
    doc.font("Times-Bold").fontSize(9).fillColor(COLOR_TINTA).text(firma.etiqueta, x, yFirma, { width: anchoFirma, align: "center" });
    doc.moveTo(x, yLinea).lineTo(x + anchoFirma, yLinea).lineWidth(0.8).strokeColor(COLOR_TINTA).stroke();
    let yTexto = yLinea + 4;
    if (firma.nombre) {
      doc.font("Times-Bold").fontSize(9).text(firma.nombre.toUpperCase(), x, yTexto, { width: anchoFirma, align: "center" });
      yTexto = doc.y + 1;
    }
    doc.font(firma.nombre ? "Times-Roman" : "Times-Bold").fontSize(9).text(firma.cargo, x, yTexto, { width: anchoFirma, align: "center" });
  });

  // ------------------------------------------- 2. relación de equipos
  const TITULO_RELACION = "RELACIÓN DE EQUIPOS DADOS DE BAJA";
  const grupos = relacionPorTipo(baja);
  if (grupos.length > 0 || baja.articulos.length > 0) {
    doc.addPage();
    encabezado(TITULO_RELACION);
  }

  function subtitulo(texto: string) {
    if (y + 60 > abajo) {
      doc.addPage();
      encabezado(TITULO_RELACION);
    }
    doc.font("Times-Bold").fontSize(10.5).fillColor(COLOR_TINTA).text(texto, izquierda, y + 6, { width: anchoUtil });
    y = doc.y + 4;
  }

  for (const grupo of grupos) {
    const nombreGrupo = `${grupo.titulo} (${grupo.equipos.length})`;
    subtitulo(nombreGrupo);
    titulos(COLUMNAS_RELACION);
    grupo.equipos.forEach((equipo, i) => {
      fila(COLUMNAS_RELACION, [String(i + 1), ETIQUETAS_TIPO[equipo.tipo].toUpperCase(), equipo.marca.toUpperCase(), equipo.modelo.toUpperCase(), equipo.numeroSerie], {
        titulo: TITULO_RELACION,
        alSaltar: () => subtitulo(`${nombreGrupo} · continúa`),
      });
    });
  }

  if (baja.articulos.length > 0) {
    const nombre = `ARTÍCULOS SIN NÚMERO DE SERIE (${baja.articulos.reduce((suma, a) => suma + a.cantidad, 0)})`;
    subtitulo(nombre);
    titulos(COLUMNAS_ARTICULOS);
    baja.articulos.forEach((articulo, i) => {
      fila(COLUMNAS_ARTICULOS, [String(i + 1), articulo.descripcion.toUpperCase(), String(articulo.cantidad), articulo.observaciones.toUpperCase()], {
        titulo: TITULO_RELACION,
        alSaltar: () => subtitulo(`${nombre} · continúa`),
      });
    });
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
