import { describe, expect, it } from "vitest";
import { FechaInvalidaError, fechaATexto, fechaDesdeTexto, hoyEnElHotel, sumarDias, tiempoTranscurrido } from "../src/lib/fechas.ts";

describe("fechaDesdeTexto", () => {
  it.each(["2026-09-18", "2028-02-29", "1990-01-01", " 2026-12-31 "])("acepta la fecha válida %j", (texto) => {
    expect(fechaATexto(fechaDesdeTexto(texto))).toBe(texto.trim());
  });

  it.each([
    ["2026-02-30", "30 de febrero"],
    ["2026-02-29", "29 de febrero en año no bisiesto"],
    ["2026-04-31", "31 de abril"],
    ["2026-13-01", "mes 13"],
    ["2026-00-10", "mes 00"],
    ["2026-05-00", "día 00"],
  ])("rechaza %s (%s) en lugar de corregirla en silencio", (texto) => {
    expect(() => fechaDesdeTexto(texto)).toThrow(FechaInvalidaError);
    expect(() => fechaDesdeTexto(texto)).toThrow(/no existe/);
  });

  it.each(["", "   ", "2026/09/18", "18-09-2026", "2026-9-18", "hoy", "2026-09-18T10:00:00Z"])(
    "rechaza el formato incorrecto %j",
    (texto) => {
      expect(() => fechaDesdeTexto(texto)).toThrow(/AAAA-MM-DD/);
    },
  );

  it.each(["1899-12-31", "2101-01-01"])("rechaza el año fuera de rango en %s", (texto) => {
    expect(() => fechaDesdeTexto(texto)).toThrow(/entre 1900 y 2100/);
  });
});

describe("hoyEnElHotel", () => {
  it("usa la hora de Quintana Roo, no la del servidor", () => {
    // 03:00 UTC del 19 de sept = 22:00 del 18 de sept en Playa del Carmen
    expect(hoyEnElHotel(new Date("2026-09-19T03:00:00Z"))).toBe("2026-09-18");
    // 05:30 UTC del 19 de sept = 00:30 del 19 de sept en Playa del Carmen
    expect(hoyEnElHotel(new Date("2026-09-19T05:30:00Z"))).toBe("2026-09-19");
  });
});

describe("sumarDias", () => {
  it("cruza cambios de mes y de año correctamente", () => {
    expect(fechaATexto(sumarDias(fechaDesdeTexto("2026-12-30"), 3))).toBe("2027-01-02");
    expect(fechaATexto(sumarDias(fechaDesdeTexto("2026-03-01"), -1))).toBe("2026-02-28");
    expect(fechaATexto(sumarDias(fechaDesdeTexto("2028-03-01"), -1))).toBe("2028-02-29");
  });
});

describe("tiempoTranscurrido", () => {
  const t = (desde: string, hasta: string) => tiempoTranscurrido(fechaDesdeTexto(desde), fechaDesdeTexto(hasta));
  it("cuenta años y meses completos", () => {
    expect(t("2023-03-15", "2026-09-18")).toEqual({ anios: 3, meses: 6 });
    expect(t("2023-03-15", "2026-09-14")).toEqual({ anios: 3, meses: 5 });
    expect(t("2026-09-01", "2026-09-18")).toEqual({ anios: 0, meses: 0 });
    expect(t("2024-02-29", "2025-02-28")).toEqual({ anios: 0, meses: 11 });
  });
  it("nunca devuelve valores negativos", () => {
    expect(t("2026-10-01", "2026-09-18")).toEqual({ anios: 0, meses: 0 });
  });
});
