import { z } from "zod";
import { EstadoEquipo, TipoEquipo } from "../../generated/prisma/enums.ts";
import { normalizarNumeroSerie } from "../../lib/clientePrisma.ts";
import { fechaDesdeTexto, FechaInvalidaError, hoyEnElHotel } from "../../lib/fechas.ts";
import { textoObligatorio, textoOpcional } from "../../lib/validacion.ts";

const vacioANull = (valor: unknown) => (typeof valor === "string" && valor.trim() === "" ? null : valor);
const vacioAUndefined = (valor: unknown) => (typeof valor === "string" && valor.trim() === "" ? undefined : valor);

const numeroSerie = textoObligatorio("Escribe el número de serie.", 100)
  .transform(normalizarNumeroSerie)
  .pipe(z.string().min(1, "Escribe el número de serie."));

const tipo = z.enum(TipoEquipo, { error: "Selecciona un tipo de equipo válido." });

/** "AAAA-MM-DD" → fecha de calendario opcional, validando que exista (y, si se pide, que no sea futura). */
function fechaOpcional(mensajeSiFutura?: string) {
  return z.preprocess(
    vacioANull,
    z
      .string({ error: "La fecha debe tener el formato AAAA-MM-DD." })
      .nullable()
      .optional()
      .transform((texto, contexto) => {
        if (texto == null) return texto;
        try {
          const fecha = fechaDesdeTexto(texto);
          if (mensajeSiFutura && fecha > fechaDesdeTexto(hoyEnElHotel())) {
            contexto.addIssue({ code: "custom", message: mensajeSiFutura });
            return z.NEVER;
          }
          return fecha;
        } catch (error) {
          const mensaje = error instanceof FechaInvalidaError ? error.message : "Fecha inválida.";
          contexto.addIssue({ code: "custom", message: mensaje });
          return z.NEVER;
        }
      }),
  );
}

const fechaAdquisicion = fechaOpcional("La fecha de adquisición no puede ser futura.");
/** Puede ser futura (lo normal) o pasada (garantía ya vencida). */
const fechaVencimientoGarantia = fechaOpcional();

export const MENSAJE_GARANTIA_ANTES_DE_COMPRA = "La garantía no puede vencer antes de la fecha de adquisición.";

/** Costo en MXN: acepta "21500", "21,500.00" o 21500.5; se guarda como texto decimal exacto. */
export const esquemaCosto = z.preprocess(
  (valor) => {
    if (typeof valor === "number") return String(valor);
    if (typeof valor === "string") return valor.trim() === "" ? null : valor.replace(/[\s,$]/g, "");
    return valor;
  },
  z
    .string({ error: "Escribe el costo como número, por ejemplo 21500.00." })
    .nullable()
    .optional()
    .superRefine((texto, contexto) => {
      if (texto == null) return;
      if (texto.startsWith("-")) contexto.addIssue({ code: "custom", message: "El costo no puede ser negativo." });
      else if (!/^\d{1,8}(\.\d{1,2})?$/.test(texto)) {
        contexto.addIssue({ code: "custom", message: "Escribe el costo con hasta 8 enteros y 2 decimales, por ejemplo 21500.00." });
      }
    }),
);

const camposEditables = {
  numeroSerie,
  tipo,
  marca: textoObligatorio("Escribe la marca.", 80),
  modelo: textoObligatorio("Escribe el modelo.", 100),
  especificaciones: textoOpcional(5000),
  ubicacion: textoOpcional(150),
  fechaAdquisicion,
  costo: esquemaCosto,
  folioFactura: textoOpcional(50),
  fechaVencimientoGarantia,
};

/**
 * Alta: el estado no se envía; todo equipo nuevo queda ACTIVO.
 * El folio de factura y la garantía son obligatorios en las altas nuevas (van
 * en el reporte de alta); los equipos anteriores al sistema pueden no tenerlos.
 */
export const esquemaCrearEquipo = z.strictObject(camposEditables).superRefine((datos, contexto) => {
  if (!datos.folioFactura) {
    contexto.addIssue({ code: "custom", path: ["folioFactura"], message: "Escribe el folio de la factura." });
  }
  if (!datos.fechaVencimientoGarantia) {
    contexto.addIssue({ code: "custom", path: ["fechaVencimientoGarantia"], message: "Elige la fecha en que vence la garantía." });
  } else if (datos.fechaAdquisicion && datos.fechaVencimientoGarantia < datos.fechaAdquisicion) {
    contexto.addIssue({ code: "custom", path: ["fechaVencimientoGarantia"], message: MENSAJE_GARANTIA_ANTES_DE_COMPRA });
  }
});

/** Edición parcial. El estado solo alterna entre ACTIVO y EN_MANTENIMIENTO. */
export const esquemaEditarEquipo = z
  .strictObject({
    ...camposEditables,
    estado: z.enum([EstadoEquipo.ACTIVO, EstadoEquipo.EN_MANTENIMIENTO], {
      error: "El estado solo puede ser ACTIVO o EN_MANTENIMIENTO; la baja se registra en el módulo de Bajas.",
    }),
  })
  .partial()
  .refine((datos) => Object.keys(datos).length > 0, { message: "Envía al menos un campo para modificar." });

export const esquemaListarEquipos = z.object({
  busqueda: z.preprocess(vacioAUndefined, z.string().trim().max(100, "Máximo 100 caracteres.").optional()),
  tipo: z.preprocess(vacioAUndefined, tipo.optional()),
  estado: z.preprocess(vacioAUndefined, z.enum(EstadoEquipo, { error: "Estado no válido." }).optional()),
  asignacion: z.preprocess(
    vacioAUndefined,
    z.enum(["todos", "asignados", "libres"], { error: "Usa todos, asignados o libres." }).default("todos"),
  ),
  pagina: z.preprocess(vacioAUndefined, z.coerce.number().int().min(1, "La página empieza en 1.").default(1)),
  porPagina: z.preprocess(
    vacioAUndefined,
    z.coerce.number().int().min(1).max(100, "Máximo 100 equipos por página.").default(20),
  ),
});

export type DatosCrearEquipo = z.output<typeof esquemaCrearEquipo>;
export type DatosEditarEquipo = z.output<typeof esquemaEditarEquipo>;
export type FiltrosEquipos = z.output<typeof esquemaListarEquipos>;
