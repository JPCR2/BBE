import { describe, expect, it } from "vitest";
import type { DatosEquipo } from "../src/api/equipos";
import { limpiarCosto, sumarAnios, validarEquipo } from "../src/utilidades/validacionEquipo";

const base: DatosEquipo = {
  numeroSerie: "ABC-1", tipo: "LAPTOP", marca: "Dell", modelo: "Latitude", ubicacion: "",
  fechaAdquisicion: "", costo: "", folioFactura: "FAC-1", fechaVencimientoGarantia: "2027-09-18", especificaciones: "",
};
const HOY = "2026-09-18";

describe("validarEquipo (mismos mensajes que la API)", () => {
  it("acepta un equipo válido", () => {
    expect(validarEquipo({ ...base, costo: "$21,500.00", fechaAdquisicion: HOY }, HOY)).toEqual({});
  });

  it("marca todos los obligatorios vacíos", () => {
    expect(validarEquipo({ ...base, numeroSerie: "   ", tipo: "", marca: " ", modelo: "" }, HOY)).toEqual({
      numeroSerie: "Escribe el número de serie.",
      tipo: "Selecciona un tipo de equipo válido.",
      marca: "Escribe la marca.",
      modelo: "Escribe el modelo.",
    });
  });

  it.each([
    ["-5", "El costo no puede ser negativo."],
    ["10.555", "Escribe el costo con hasta 8 enteros y 2 decimales, por ejemplo 21500.00."],
    ["mil", "Escribe el costo con hasta 8 enteros y 2 decimales, por ejemplo 21500.00."],
  ])("rechaza el costo %s", (costo, mensaje) => {
    expect(validarEquipo({ ...base, costo }, HOY).costo).toBe(mensaje);
  });

  it("rechaza una fecha de adquisición futura", () => {
    expect(validarEquipo({ ...base, fechaAdquisicion: "2026-09-19" }, HOY).fechaAdquisicion).toBe(
      "La fecha de adquisición no puede ser futura.",
    );
  });

  it("limpia el costo capturado con símbolos", () => {
    expect(limpiarCosto(" $21,500.00 ")).toBe("21500.00");
  });
});

describe("folio de factura y garantía", () => {
  it("en un alta son obligatorios; al editar un equipo antiguo no", () => {
    const sinDatos = { ...base, folioFactura: "  ", fechaVencimientoGarantia: "" };
    expect(validarEquipo(sinDatos, HOY, "alta")).toEqual({
      folioFactura: "Escribe el folio de la factura.",
      fechaVencimientoGarantia: "Elige la fecha en que vence la garantía.",
    });
    expect(validarEquipo(sinDatos, HOY, "edicion")).toEqual({});
  });

  it("la garantía no puede vencer antes de la compra (el mismo día sí)", () => {
    const compra = { ...base, fechaAdquisicion: "2026-03-15" };
    expect(validarEquipo({ ...compra, fechaVencimientoGarantia: "2026-03-14" }, HOY).fechaVencimientoGarantia).toBe(
      "La garantía no puede vencer antes de la fecha de adquisición.",
    );
    expect(validarEquipo({ ...compra, fechaVencimientoGarantia: "2026-03-15" }, HOY)).toEqual({});
    // Una garantía ya vencida es válida (equipo comprado hace tiempo).
    expect(validarEquipo({ ...base, fechaAdquisicion: "2020-01-01", fechaVencimientoGarantia: "2021-01-01" }, HOY)).toEqual({});
  });

  it("rechaza un folio de más de 50 caracteres también al editar", () => {
    expect(validarEquipo({ ...base, folioFactura: "F".repeat(51) }, HOY, "edicion").folioFactura).toBe("Máximo 50 caracteres.");
  });
});

describe("sumarAnios (botones rápidos de garantía)", () => {
  it.each([
    ["2026-03-15", 1, "2027-03-15"],
    ["2026-03-15", 3, "2029-03-15"],
    ["2024-02-29", 1, "2025-02-28"],
    ["2024-02-29", 4, "2028-02-29"],
    ["2026-12-31", 2, "2028-12-31"],
  ])("%s + %i años = %s", (fecha, anios, esperado) => {
    expect(sumarAnios(fecha, anios)).toBe(esperado);
  });
});
