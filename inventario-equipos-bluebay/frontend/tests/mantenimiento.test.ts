import { describe, expect, it } from "vitest";
import { mesDesplazado, mesValido, nombreDia, nombreMes, semanasDelMes, textoPlazo } from "../src/utilidades/mantenimiento";

const programado = (diasRestantes: number) => ({ estado: "PROGRAMADO" as const, diasRestantes, fechaProgramada: "2026-10-15", fechaRealizacion: null });

describe("textoPlazo", () => {
  it.each([
    [-1, "Vencido hace 1 día"],
    [-12, "Vencido hace 12 días"],
    [0, "Hoy"],
    [1, "Mañana"],
    [3, "En 3 días"],
    [7, "En 7 días"],
    [8, "Programado para el 15/10/2026"],
  ])("con %i días restantes dice «%s»", (dias, texto) => {
    expect(textoPlazo(programado(dias))).toBe(texto);
  });

  it("describe los realizados y los cancelados", () => {
    expect(textoPlazo({ estado: "REALIZADO", diasRestantes: null, fechaProgramada: null, fechaRealizacion: "2026-09-03" })).toBe("Realizado el 03/09/2026");
    expect(textoPlazo({ estado: "CANCELADO", diasRestantes: null, fechaProgramada: "2026-09-15", fechaRealizacion: null })).toBe("Cancelado (era para el 15/09/2026)");
  });
});

describe("calendario mensual", () => {
  it("arma semanas de lunes a domingo, rellenando con días de los meses vecinos", () => {
    const semanas = semanasDelMes("2026-09", "2026-09-22"); // 1 de septiembre de 2026 es martes
    expect(semanas).toHaveLength(5);
    expect(semanas.every((s) => s.length === 7)).toBe(true);
    expect(semanas[0]![0]).toEqual({ fecha: "2026-08-31", dia: 31, delMes: false, esHoy: false });
    expect(semanas[0]![1]).toMatchObject({ fecha: "2026-09-01", delMes: true });
    expect(semanas.flat().filter((d) => d.esHoy).map((d) => d.fecha)).toEqual(["2026-09-22"]);
    expect(semanas[4]![6]).toMatchObject({ fecha: "2026-10-04", delMes: false });
    expect(semanas.flat().filter((d) => d.delMes)).toHaveLength(30);
  });

  it("un febrero que empieza en lunes cabe en 4 semanas exactas", () => {
    const semanas = semanasDelMes("2027-02", "2026-09-22");
    expect(semanas).toHaveLength(4);
    expect(semanas[0]![0]!.fecha).toBe("2027-02-01");
    expect(semanas[3]![6]!.fecha).toBe("2027-02-28");
  });

  it("incluye el 29 de febrero en año bisiesto y usa 6 semanas cuando hace falta", () => {
    expect(semanasDelMes("2028-02", "").flat().some((d) => d.fecha === "2028-02-29" && d.delMes)).toBe(true);
    expect(semanasDelMes("2026-08", "")).toHaveLength(6); // agosto de 2026 empieza en sábado y tiene 31 días
  });

  it("cambia de mes y de año", () => {
    expect(mesDesplazado("2026-12", 1)).toBe("2027-01");
    expect(mesDesplazado("2026-01", -1)).toBe("2025-12");
    expect(mesDesplazado("2026-09", 0)).toBe("2026-09");
  });

  it("nombra meses y días en español", () => {
    expect(nombreMes("2026-09")).toBe("Septiembre de 2026");
    expect(nombreDia("2026-09-22")).toBe("martes 22 de septiembre");
    expect(nombreDia("2026-11-01")).toBe("domingo 1 de noviembre");
  });

  it.each([["2026-09", true], ["2026-13", false], ["2026-9", false], ["1800-01", false], [undefined, false], [["2026-09"], false]])(
    "mesValido(%j) = %s",
    (valor, esperado) => {
      expect(mesValido(valor)).toBe(esperado);
    },
  );
});
