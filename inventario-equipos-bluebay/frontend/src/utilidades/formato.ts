import type { EmpleadoResumen, EstadoEquipo, TipoEquipo } from "../api/equipos";

const ZONA_HOTEL = "America/Cancun";

export const ETIQUETAS_TIPO: Record<TipoEquipo, string> = {
  ESCRITORIO: "Escritorio",
  LAPTOP: "Laptop",
  ALL_IN_ONE: "All-in-one",
  MONITOR: "Monitor",
  IMPRESORA: "Impresora",
  OTRO: "Otro",
};

export const ETIQUETAS_ESTADO: Record<EstadoEquipo, string> = {
  ACTIVO: "Activo",
  EN_MANTENIMIENTO: "En mantenimiento",
  BAJA: "Dado de baja",
};

export type Variante = "exito" | "alerta" | "peligro" | "neutra" | "primaria";

export const VARIANTE_ESTADO: Record<EstadoEquipo, Variante> = {
  ACTIVO: "exito",
  EN_MANTENIMIENTO: "alerta",
  BAJA: "neutra",
};

/** Igual que en el backend: sin espacios y en mayúsculas. */
export function normalizarNumeroSerie(valor: string): string {
  return valor.replace(/\s+/g, "").toUpperCase();
}

/** "2023-03-15" o una fecha ISO con hora → "15/03/2023" (hora de Playa del Carmen). */
export function fechaCorta(valor: string | null | undefined): string {
  if (!valor) return "—";
  const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (soloFecha) return `${soloFecha[3]}/${soloFecha[2]}/${soloFecha[1]}`;
  return new Intl.DateTimeFormat("es-MX", { timeZone: ZONA_HOTEL, day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(valor),
  );
}

/** Fecha ISO con hora → "02/10/2026, 10:15" (hora de Playa del Carmen). */
export function fechaHora(valor: string | null | undefined): string {
  if (!valor) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: ZONA_HOTEL, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(valor));
}

/** Fecha de hoy para el encabezado: "Viernes 18 de septiembre de 2026". */
export function fechaDeHoyLarga(ahora: Date = new Date()): string {
  const texto = new Intl.DateTimeFormat("es-MX", {
    timeZone: ZONA_HOTEL,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(ahora).replace(",", "");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** "21500.00" → "$21,500.00 MXN". */
export function moneda(valor: string | null | undefined): string {
  if (valor == null) return "—";
  const numero = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(valor));
  return `${numero} MXN`;
}

/** { anios: 3, meses: 6 } → "3 años, 6 meses". */
export function duracion(tiempo: { anios: number; meses: number } | null | undefined): string {
  if (!tiempo) return "—";
  const partes: string[] = [];
  if (tiempo.anios > 0) partes.push(`${tiempo.anios} ${tiempo.anios === 1 ? "año" : "años"}`);
  if (tiempo.meses > 0) partes.push(`${tiempo.meses} ${tiempo.meses === 1 ? "mes" : "meses"}`);
  return partes.length > 0 ? partes.join(", ") : "Menos de un mes";
}

export function nombreCompleto(empleado: Pick<EmpleadoResumen, "nombre" | "apellidos">): string {
  return `${empleado.nombre} ${empleado.apellidos}`;
}

export function iniciales(empleado: Pick<EmpleadoResumen, "nombre" | "apellidos">): string {
  return `${empleado.nombre.charAt(0)}${empleado.apellidos.charAt(0)}`.toUpperCase();
}

/** Fecha de hoy en el hotel como "AAAA-MM-DD" (para el máximo de los campos de fecha). */
export function hoyEnElHotel(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_HOTEL, year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

/** Años y meses completos desde una fecha ISO hasta hoy (hora del hotel). */
export function tiempoDesde(iso: string, ahora: Date = new Date()): { anios: number; meses: number } {
  const [ay, am, ad] = hoyEnElHotel(ahora).split("-").map(Number) as [number, number, number];
  const [dy, dm, dd] = hoyEnElHotel(new Date(iso)).split("-").map(Number) as [number, number, number];
  let meses = (ay - dy) * 12 + (am - dm);
  if (ad < dd) meses -= 1;
  meses = Math.max(0, meses);
  return { anios: Math.floor(meses / 12), meses: meses % 12 };
}
