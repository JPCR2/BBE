import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { leerCsvInventario, separarLineaCsv } from "../scripts/importar-inventario.ts";

const TITULOS = "numeroSerie,tipo,marca,modelo,costo,ubicacion,especificaciones";

describe("Importar inventario desde CSV", () => {
  it("separa celdas respetando comillas", () => {
    expect(separarLineaCsv('A1,TECLADO,"Dell, Inc.","KB ""212""",235,,')).toEqual(["A1", "TECLADO", "Dell, Inc.", 'KB "212"', "235", "", ""]);
  });

  it("normaliza el número de serie y el tipo, y acepta costo con comas o vacío", () => {
    const { filas, errores } = leerCsvInventario(`${TITULOS}\n 0016caf00a01 ,telefono,Nortel,IP 2002,"1,200",Almacén,Teléfono IP\nX-2,MOUSE,HP,M1,,,\n`);
    expect(errores).toEqual([]);
    expect(filas).toEqual([
      { linea: 2, numeroSerie: "0016CAF00A01", tipo: "TELEFONO", marca: "Nortel", modelo: "IP 2002", costo: "1200", ubicacion: "Almacén", especificaciones: "Teléfono IP" },
      { linea: 3, numeroSerie: "X-2", tipo: "MOUSE", marca: "HP", modelo: "M1", costo: null, ubicacion: null, especificaciones: null },
    ]);
  });

  it("reporta cada fila inválida con su línea y no la carga", () => {
    const { filas, errores } = leerCsvInventario(
      `${TITULOS}\n,TELEFONO,Nortel,IP,1,,\nA,TABLET,X,Y,1,,\nB,MOUSE,,Y,-5,,\nC,MOUSE,HP,M,1,,\nc,MOUSE,HP,M,1,,`,
    );
    expect(filas.map((f) => f.numeroSerie)).toEqual(["C"]);
    expect(errores).toEqual([
      "Línea 2: falta el número de serie.",
      "Línea 3: el tipo «TABLET» no existe.",
      "Línea 4: falta la marca; el costo «-5» no es válido.",
      "Línea 6: el número de serie C ya venía en la línea 5.",
    ]);
  });

  it("avisa si faltan columnas", () => {
    expect(leerCsvInventario("numeroSerie,tipo\nA,MOUSE").errores).toEqual(["Faltan columnas en la primera fila: marca, modelo, costo, ubicacion, especificaciones."]);
  });

  // Los CSV reales del hotel viven fuera del repositorio (..\..\..\datos-importacion
  // respecto a backend). En un clon limpio no existen y estas dos pruebas se saltan.
  describe.each([
    ["inventario-baja-bbge-2026-10.csv", 148],
    ["inventario-baja-beryl-2026-11.csv", 28],
  ])("archivo del hotel %s", (nombre, total) => {
    const archivo = fileURLToPath(new URL(`../../../../datos-importacion/${nombre}`, import.meta.url));
    it.skipIf(!existsSync(archivo))("se lee completo y sin errores", async () => {
      const { filas, errores } = leerCsvInventario(await readFile(archivo, "utf8"));
      expect(errores).toEqual([]);
      expect(filas).toHaveLength(total);
    });
  });
});
