import { z } from "zod";
import { ErrorHttp } from "./errores.ts";
import { fechaDesdeTexto, FechaInvalidaError } from "./fechas.ts";

// Mensajes de validación por defecto en español.
z.config(z.locales.es());

/**
 * Valida datos con un esquema de zod. Si fallan, lanza un 400 con un mensaje
 * por campo, listo para mostrarse junto a cada campo del formulario.
 */
export function validar<T extends z.ZodType>(esquema: T, datos: unknown): z.output<T> {
  const resultado = esquema.safeParse(datos);
  if (resultado.success) return resultado.data;

  const campos: Record<string, string> = {};
  for (const problema of resultado.error.issues) {
    if (problema.code === "unrecognized_keys") {
      const prefijo = problema.path.map(String).join(".");
      for (const clave of problema.keys) campos[prefijo ? `${prefijo}.${clave}` : clave] ??= "Este campo no se puede enviar aquí.";
      continue;
    }
    // En listas, el campo lleva el renglón: "articulos.0.cantidad".
    const campo = problema.path.length > 0 ? problema.path.map(String).join(".") : "_";
    campos[campo] ??= problema.message;
  }
  throw new ErrorHttp(400, "DATOS_INVALIDOS", "Revisa los datos marcados.", campos);
}

/** Convierte "" o solo espacios en null (campo opcional vaciado) y recorta el texto. */
export function textoOpcional(maximo: number) {
  return z.preprocess(
    (valor) => (typeof valor === "string" ? (valor.trim() === "" ? null : valor.trim()) : valor),
    z.string().max(maximo, `Máximo ${maximo} caracteres.`).nullable().optional(),
  );
}

/** Texto obligatorio, recortado, con mensaje propio cuando falta. */
export function textoObligatorio(mensajeSiFalta: string, maximo: number) {
  return z
    .string({ error: mensajeSiFalta })
    .trim()
    .min(1, mensajeSiFalta)
    .max(maximo, `Máximo ${maximo} caracteres.`);
}

/** Identificador numérico de la URL (/equipos/:id). */
export const esquemaId = z.coerce
  .number({ error: "El identificador debe ser un número." })
  .int("El identificador debe ser un número entero.")
  .positive("El identificador debe ser mayor que cero.");

/** Para parámetros opcionales: "" o solo espacios cuentan como no enviados. */
export const vacioAUndefined = (valor: unknown) => (typeof valor === "string" && valor.trim() === "" ? undefined : valor);

/** "AAAA-MM-DD" → fecha de calendario; rechaza días inexistentes como el 30 de febrero. */
export function fechaCalendario(mensajeSiFalta: string) {
  return z.string({ error: mensajeSiFalta }).trim().min(1, mensajeSiFalta).transform((texto, contexto) => {
    try {
      return fechaDesdeTexto(texto);
    } catch (error) {
      contexto.addIssue({ code: "custom", message: error instanceof FechaInvalidaError ? error.message : "Fecha inválida." });
      return z.NEVER;
    }
  });
}
