import { describe, expect, it } from "vitest";
import { duracion, fechaCorta, fechaDeHoyLarga, moneda, normalizarNumeroSerie, tiempoDesde } from "../src/utilidades/formato";

describe("formato", () => {
  it("muestra fechas como dd/mm/aaaa, sin corrimiento para fechas de calendario", () => {
    expect(fechaCorta("2023-03-15")).toBe("15/03/2023");
    // 02:00 UTC del 19 de sept = 21:00 del 18 de sept en Playa del Carmen
    expect(fechaCorta("2026-09-19T02:00:00.000Z")).toBe("18/09/2026");
    expect(fechaCorta(null)).toBe("—");
  });

  it("formatea el costo en pesos mexicanos", () => {
    expect(moneda("21500.00")).toBe("$21,500.00 MXN");
    expect(moneda("0.50")).toBe("$0.50 MXN");
    expect(moneda(null)).toBe("—");
  });

  it("escribe la duración en palabras", () => {
    expect(duracion({ anios: 3, meses: 6 })).toBe("3 años, 6 meses");
    expect(duracion({ anios: 1, meses: 1 })).toBe("1 año, 1 mes");
    expect(duracion({ anios: 0, meses: 0 })).toBe("Menos de un mes");
  });

  it("normaliza el número de serie igual que el backend", () => {
    expect(normalizarNumeroSerie("  5cd 12ab-x9 ")).toBe("5CD12AB-X9");
  });

  it("calcula el tiempo transcurrido con la fecha del hotel", () => {
    expect(tiempoDesde("2025-08-14T15:00:00.000Z", new Date("2026-09-18T18:00:00Z"))).toEqual({ anios: 1, meses: 1 });
  });

  it("muestra la fecha de hoy con mayúscula inicial", () => {
    expect(fechaDeHoyLarga(new Date("2026-09-18T18:00:00Z"))).toBe("Viernes 18 de septiembre de 2026");
  });
});
