import type { Mantenimiento, SituacionMantenimiento, TipoMantenimiento } from "../api/equipos";
import { fechaCorta, type Variante } from "./formato";

export const ETIQUETAS_TIPO_MANTENIMIENTO: Record<TipoMantenimiento, string> = {
  PREVENTIVO: "Preventivo",
  CORRECTIVO: "Correctivo",
};

export const ETIQUETAS_SITUACION: Record<SituacionMantenimiento, string> = {
  VENCIDO: "Vencido",
  PROXIMO: "Próximo",
  PROGRAMADO: "Programado",
  REALIZADO: "Realizado",
  CANCELADO: "Cancelado",
};

export const VARIANTE_SITUACION: Record<SituacionMantenimiento, Variante> = {
  VENCIDO: "peligro",
  PROXIMO: "alerta",
  PROGRAMADO: "primaria",
  REALIZADO: "exito",
  CANCELADO: "neutra",
};

const plural = (n: number, singular: string, varios: string) => `${n} ${n === 1 ? singular : varios}`;

/** Cuándo toca, en palabras: "Vencido hace 5 días", "Hoy", "Mañana", "En 3 días"… */
export function textoPlazo(m: Pick<Mantenimiento, "estado" | "diasRestantes" | "fechaProgramada" | "fechaRealizacion">): string {
  if (m.estado === "REALIZADO") return `Realizado el ${fechaCorta(m.fechaRealizacion)}`;
  if (m.estado === "CANCELADO") return `Cancelado (era para el ${fechaCorta(m.fechaProgramada)})`;
  const dias = m.diasRestantes ?? 0;
  if (dias < 0) return `Vencido hace ${plural(-dias, "día", "días")}`;
  if (dias === 0) return "Hoy";
  if (dias === 1) return "Mañana";
  if (dias <= 7) return `En ${plural(dias, "día", "días")}`;
  return `Programado para el ${fechaCorta(m.fechaProgramada)}`;
}

// -----------------------------------------------------------------------------
// Calendario mensual
// -----------------------------------------------------------------------------

const NOMBRES_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export interface DiaCalendario {
  fecha: string;
  dia: number;
  delMes: boolean;
  esHoy: boolean;
}

export function mesValido(texto: unknown): texto is string {
  if (typeof texto !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(texto)) return false;
  const anio = Number(texto.slice(0, 4));
  return anio >= 1900 && anio <= 2100;
}

const dosDigitos = (n: number) => String(n).padStart(2, "0");
const aTexto = (fecha: Date) => `${fecha.getUTCFullYear()}-${dosDigitos(fecha.getUTCMonth() + 1)}-${dosDigitos(fecha.getUTCDate())}`;

/** "2026-09" + 1 → "2026-10"; "2026-01" − 1 → "2025-12". */
export function mesDesplazado(mes: string, meses: number): string {
  const [anio, numero] = mes.split("-").map(Number) as [number, number];
  return aTexto(new Date(Date.UTC(anio, numero - 1 + meses, 1))).slice(0, 7);
}

/** "2026-09" → "Septiembre de 2026". */
export function nombreMes(mes: string): string {
  const [anio, numero] = mes.split("-").map(Number) as [number, number];
  const nombre = NOMBRES_MES[numero - 1]!;
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} de ${anio}`;
}

/** "2026-09-22" → "martes 22 de septiembre". */
export function nombreDia(fecha: string): string {
  const [anio, mes, dia] = fecha.split("-").map(Number) as [number, number, number];
  const semana = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()];
  return `${semana} ${dia} de ${NOMBRES_MES[mes - 1]}`;
}

/**
 * Semanas completas (de lunes a domingo) que cubren el mes, con los días del
 * mes anterior y siguiente para rellenar la cuadrícula.
 */
export function semanasDelMes(mes: string, hoy: string): DiaCalendario[][] {
  const [anio, numero] = mes.split("-").map(Number) as [number, number];
  const primero = new Date(Date.UTC(anio, numero - 1, 1));
  const desfase = (primero.getUTCDay() + 6) % 7; // lunes = 0
  const inicio = new Date(Date.UTC(anio, numero - 1, 1 - desfase));
  const diasEnMes = new Date(Date.UTC(anio, numero, 0)).getUTCDate();
  const totalDias = Math.ceil((desfase + diasEnMes) / 7) * 7;

  const semanas: DiaCalendario[][] = [];
  for (let i = 0; i < totalDias; i++) {
    const fecha = new Date(inicio.getTime() + i * 86_400_000);
    const texto = aTexto(fecha);
    if (i % 7 === 0) semanas.push([]);
    semanas.at(-1)!.push({ fecha: texto, dia: fecha.getUTCDate(), delMes: fecha.getUTCMonth() === numero - 1, esHoy: texto === hoy });
  }
  return semanas;
}
