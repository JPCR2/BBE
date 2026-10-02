import type { DatosEquipo } from "../api/equipos";
import { hoyEnElHotel, normalizarNumeroSerie } from "./formato";

/** Quita comas, espacios y el signo $ del costo capturado ("$21,500.00" → "21500.00"). */
export function limpiarCosto(valor: string): string {
  return valor.replace(/[\s,$]/g, "");
}

export const MENSAJE_GARANTIA_ANTES_DE_COMPRA = "La garantía no puede vencer antes de la fecha de adquisición.";

/** "2026-03-15" + 2 años → "2028-03-15". El 29 de febrero pasa al 28 si el año no es bisiesto. */
export function sumarAnios(fecha: string, anios: number): string {
  const [anio, mes, dia] = fecha.split("-").map(Number) as [number, number, number];
  const ultimoDia = new Date(Date.UTC(anio + anios, mes, 0)).getUTCDate();
  const resultado = new Date(Date.UTC(anio + anios, mes - 1, Math.min(dia, ultimoDia)));
  return resultado.toISOString().slice(0, 10);
}

/**
 * Validación en el navegador con los MISMOS mensajes que la API, para avisar
 * antes de enviar. La API vuelve a validar todo de cualquier forma.
 * En un alta, el folio de factura y la garantía son obligatorios; al editar un
 * equipo anterior al sistema pueden quedar vacíos.
 */
export function validarEquipo(
  datos: DatosEquipo,
  hoy: string = hoyEnElHotel(),
  modo: "alta" | "edicion" = "alta",
): Record<string, string> {
  const errores: Record<string, string> = {};
  const serie = normalizarNumeroSerie(datos.numeroSerie);
  if (serie === "") errores.numeroSerie = "Escribe el número de serie.";
  else if (serie.length > 100) errores.numeroSerie = "Máximo 100 caracteres.";

  if (datos.tipo === "") errores.tipo = "Selecciona un tipo de equipo válido.";
  if (datos.marca.trim() === "") errores.marca = "Escribe la marca.";
  else if (datos.marca.trim().length > 80) errores.marca = "Máximo 80 caracteres.";
  if (datos.modelo.trim() === "") errores.modelo = "Escribe el modelo.";
  else if (datos.modelo.trim().length > 100) errores.modelo = "Máximo 100 caracteres.";
  if (datos.ubicacion.trim().length > 150) errores.ubicacion = "Máximo 150 caracteres.";

  const costo = limpiarCosto(datos.costo);
  if (costo !== "") {
    if (costo.startsWith("-")) errores.costo = "El costo no puede ser negativo.";
    else if (!/^\d{1,8}(\.\d{1,2})?$/.test(costo)) {
      errores.costo = "Escribe el costo con hasta 8 enteros y 2 decimales, por ejemplo 21500.00.";
    }
  }

  if (datos.fechaAdquisicion !== "" && datos.fechaAdquisicion > hoy) {
    errores.fechaAdquisicion = "La fecha de adquisición no puede ser futura.";
  }

  const folio = datos.folioFactura.trim();
  if (folio === "" && modo === "alta") errores.folioFactura = "Escribe el folio de la factura.";
  else if (folio.length > 50) errores.folioFactura = "Máximo 50 caracteres.";

  if (datos.fechaVencimientoGarantia === "") {
    if (modo === "alta") errores.fechaVencimientoGarantia = "Elige la fecha en que vence la garantía.";
  } else if (datos.fechaAdquisicion !== "" && datos.fechaVencimientoGarantia < datos.fechaAdquisicion) {
    errores.fechaVencimientoGarantia = MENSAJE_GARANTIA_ANTES_DE_COMPRA;
  }
  return errores;
}
