/**
 * Utilidades de fechas "de calendario" (sin hora): adquisición, mantenimiento…
 *
 * Por qué existen: en JavaScript `new Date("2026-02-30")` NO falla, se convierte
 * en silencio al 2 de marzo, y la base de datos ya no puede detectarlo. Por eso
 * toda fecha que llegue como texto debe pasar por fechaDesdeTexto().
 *
 * Convención: una fecha de calendario se representa como Date a medianoche UTC,
 * que es como Prisma la guarda en columnas DATE sin corrimientos.
 */

/** Zona horaria de Playa del Carmen, Quintana Roo (UTC−5 todo el año). */
export const ZONA_HORARIA_HOTEL = "America/Cancun";

export class FechaInvalidaError extends Error {
  constructor(public readonly valor: string, motivo: string) {
    super(`Fecha inválida "${valor}": ${motivo}`);
    this.name = "FechaInvalidaError";
  }
}

const ANIO_MINIMO = 1900;
const ANIO_MAXIMO = 2100;

/** Convierte "AAAA-MM-DD" en una fecha de calendario, validando que exista. */
export function fechaDesdeTexto(texto: string): Date {
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto.trim());
  if (!coincidencia) {
    throw new FechaInvalidaError(texto, "se esperaba el formato AAAA-MM-DD");
  }
  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  const dia = Number(coincidencia[3]);
  if (anio < ANIO_MINIMO || anio > ANIO_MAXIMO) {
    throw new FechaInvalidaError(texto, `el año debe estar entre ${ANIO_MINIMO} y ${ANIO_MAXIMO}`);
  }
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) {
    throw new FechaInvalidaError(texto, "ese día no existe en el calendario");
  }
  return fecha;
}

/** Convierte una fecha de calendario de vuelta a "AAAA-MM-DD". */
export function fechaATexto(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Fecha de hoy en el hotel ("AAAA-MM-DD"), sin importar la zona del servidor. */
export function hoyEnElHotel(ahora: Date = new Date()): string {
  // en-CA formatea como AAAA-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_HORARIA_HOTEL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

/** Suma (o resta, con número negativo) días a una fecha de calendario. */
export function sumarDias(fecha: Date, dias: number): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() + dias));
}

/**
 * Tiempo transcurrido entre dos fechas de calendario en años y meses
 * completos. Se usa para el "tiempo de funcionamiento" de un equipo.
 */
export function tiempoTranscurrido(desde: Date, hasta: Date): { anios: number; meses: number } {
  let meses =
    (hasta.getUTCFullYear() - desde.getUTCFullYear()) * 12 + (hasta.getUTCMonth() - desde.getUTCMonth());
  if (hasta.getUTCDate() < desde.getUTCDate()) meses -= 1;
  meses = Math.max(0, meses);
  return { anios: Math.floor(meses / 12), meses: meses % 12 };
}
