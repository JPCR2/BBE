import type { ArticuloNuevo, DatosNuevaBaja } from "../api/bajas";

export const MAXIMO_EQUIPOS_BAJA = 100;
export const MAXIMO_ARTICULOS_BAJA = 50;

export const articuloVacio = (): ArticuloNuevo => ({ descripcion: "", cantidad: "1", costo: "", aniosUso: "", observaciones: "" });

const MENSAJE_OBSERVACIONES = "Escribe el motivo de la baja y las condiciones.";

/**
 * Validación en el navegador con los mismos mensajes y los mismos nombres de
 * campo que la API ("equipos.0.observaciones", "articulos.1.cantidad"…).
 */
export function validarBaja(datos: DatosNuevaBaja, hoy: string): Record<string, string> {
  const errores: Record<string, string> = {};

  if (datos.equipos.length + datos.articulos.length === 0) errores.equipos = "Agrega al menos un equipo o un artículo.";
  else if (datos.equipos.length > MAXIMO_EQUIPOS_BAJA) errores.equipos = `Máximo ${MAXIMO_EQUIPOS_BAJA} equipos por baja.`;
  if (datos.articulos.length > MAXIMO_ARTICULOS_BAJA) errores.articulos = `Máximo ${MAXIMO_ARTICULOS_BAJA} artículos por baja.`;

  datos.equipos.forEach((equipo, i) => {
    const texto = equipo.observaciones.trim();
    if (texto === "") errores[`equipos.${i}.observaciones`] = MENSAJE_OBSERVACIONES;
    else if (texto.length > 255) errores[`equipos.${i}.observaciones`] = "Máximo 255 caracteres.";
  });

  datos.articulos.forEach((articulo, i) => {
    const campo = (nombre: string) => `articulos.${i}.${nombre}`;
    const descripcion = articulo.descripcion.trim();
    if (descripcion === "") errores[campo("descripcion")] = "Describe el artículo, por ejemplo «Baterías de UPS».";
    else if (descripcion.length > 150) errores[campo("descripcion")] = "Máximo 150 caracteres.";

    const cantidad = articulo.cantidad.trim();
    if (cantidad === "") errores[campo("cantidad")] = "Escribe la cantidad.";
    else if (!/^-?\d+(\.\d+)?$/.test(cantidad)) errores[campo("cantidad")] = "Escribe la cantidad como número.";
    else if (!Number.isInteger(Number(cantidad))) errores[campo("cantidad")] = "La cantidad debe ser un número entero.";
    else if (Number(cantidad) < 1) errores[campo("cantidad")] = "La cantidad debe ser mayor que cero.";

    const costo = articulo.costo.replace(/[\s,$]/g, "");
    if (costo.startsWith("-")) errores[campo("costo")] = "El costo no puede ser negativo.";
    else if (costo !== "" && !/^\d{1,8}(\.\d{1,2})?$/.test(costo)) {
      errores[campo("costo")] = "Escribe el costo con hasta 8 enteros y 2 decimales, por ejemplo 21500.00.";
    }

    const anios = articulo.aniosUso.trim();
    if (anios !== "") {
      if (!/^-?\d+(\.\d+)?$/.test(anios)) errores[campo("aniosUso")] = "Escribe los años de uso como número.";
      else if (!Number.isInteger(Number(anios))) errores[campo("aniosUso")] = "Escribe los años de uso sin decimales (0 si es menos de un año).";
      else if (Number(anios) < 0) errores[campo("aniosUso")] = "Los años de uso no pueden ser negativos.";
      else if (Number(anios) > 100) errores[campo("aniosUso")] = "Revisa los años de uso.";
    }

    const observaciones = articulo.observaciones.trim();
    if (observaciones === "") errores[campo("observaciones")] = MENSAJE_OBSERVACIONES;
    else if (observaciones.length > 255) errores[campo("observaciones")] = "Máximo 255 caracteres.";
  });

  if (!datos.fechaBaja) errores.fechaBaja = "Elige la fecha de la baja.";
  else if (datos.fechaBaja > hoy) errores.fechaBaja = "La fecha de la baja no puede ser futura.";

  const elaboro = datos.elaboro.trim();
  if (elaboro === "") errores.elaboro = "Escribe el nombre de quien captura la baja.";
  else if (elaboro.length > 100) errores.elaboro = "Máximo 100 caracteres.";
  return errores;
}

/** "3 equipos y 2 artículos", "1 artículo"… */
export function resumenRenglones(equipos: number, articulos: number): string {
  const partes: string[] = [];
  if (equipos > 0) partes.push(`${equipos} ${equipos === 1 ? "equipo" : "equipos"}`);
  if (articulos > 0) partes.push(`${articulos} ${articulos === 1 ? "artículo" : "artículos"}`);
  return partes.join(" y ");
}
