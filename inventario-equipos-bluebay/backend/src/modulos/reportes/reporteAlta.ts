import { z } from "zod";
import type { TipoEquipo } from "../../generated/prisma/enums.ts";
import { crearReporte, ETIQUETAS_TIPO, fechaCorta, moneda, SIN_DATO, sumarCostos, type Columna } from "./pdfBase.ts";

/** Máximo de equipos por reporte (una factura grande cabe de sobra). */
export const MAXIMO_EQUIPOS_REPORTE = 100;

export const esquemaReporteAlta = z.object({
  /** "3,7,12": los equipos que salen en el reporte. */
  ids: z
    .string({ error: "Indica los equipos del reporte, por ejemplo ids=1,2,3." })
    .trim()
    .regex(/^\d+(,\d+)*$/, "Los identificadores van separados por comas, por ejemplo ids=1,2,3.")
    .transform((texto) => [...new Set(texto.split(",").map(Number))])
    .refine((ids) => ids.every((id) => id > 0), "Los identificadores deben ser mayores que cero.")
    .refine((ids) => ids.length <= MAXIMO_EQUIPOS_REPORTE, `Máximo ${MAXIMO_EQUIPOS_REPORTE} equipos por reporte.`),
});

export interface FilaReporteAlta {
  tipo: TipoEquipo;
  marca: string;
  modelo: string;
  numeroSerie: string;
  costo: string | null;
  folioFactura: string | null;
  fechaVencimientoGarantia: string | null;
}

const COLUMNAS: readonly Columna[] = [
  { titulo: "No.", ancho: 26, alinear: "center" },
  { titulo: "Modelo", ancho: 120, alinear: "left" },
  { titulo: "Número de serie /\nService Tag", ancho: 104, alinear: "left" },
  { titulo: "Folio de factura", ancho: 100, alinear: "left" },
  { titulo: "Costo", ancho: 78, alinear: "right" },
  { titulo: "Vencimiento de la garantía", ancho: 84, alinear: "center" },
];
const INDICE_COSTO = 4;

/**
 * Genera el reporte imprimible de alta. Recibe los equipos ya consultados para
 * que se pueda probar sin base de datos.
 */
export function generarPdfAlta(filas: FilaReporteAlta[], opciones: { fechaEmision: string }): Promise<Buffer> {
  const reporte = crearReporte({
    titulo: "Reporte de alta de equipo de cómputo",
    datosDerecha: [
      `Fecha de emisión: ${fechaCorta(opciones.fechaEmision)}`,
      `${filas.length} ${filas.length === 1 ? "equipo" : "equipos"}`,
    ],
    encabezado: "REPORTE DE ALTA DE EQUIPO DE CÓMPUTO",
    introduccion:
      "Se registran en el inventario del Departamento de Sistemas del hotel Blue Bay Grand Esmeralda los siguientes equipos de cómputo:",
  });

  reporte.tabla(
    COLUMNAS,
    filas.map((fila, indice) => [
      String(indice + 1),
      `${fila.marca} ${fila.modelo}\n${ETIQUETAS_TIPO[fila.tipo]}`,
      fila.numeroSerie,
      fila.folioFactura ?? SIN_DATO,
      fila.costo !== null ? moneda(Number(fila.costo)) : SIN_DATO,
      fila.fechaVencimientoGarantia ? fechaCorta(fila.fechaVencimientoGarantia) : SIN_DATO,
    ]),
  );
  const { centavos, sinCosto } = sumarCostos(filas.map((f) => f.costo));
  reporte.total(COLUMNAS, INDICE_COSTO, centavos, sinCosto);
  reporte.firmas([
    { titulo: "Elaboró", detalle: "Nombre y firma · Departamento de Sistemas" },
    { titulo: "Autorizó", detalle: "Nombre, puesto y firma" },
  ]);
  return reporte.terminar();
}
