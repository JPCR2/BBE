/**
 * Carga equipos al inventario desde un archivo CSV (por ejemplo, la relación
 * de un Excel de bajas), para que después se puedan dar de baja en el sistema.
 *
 * Uso:
 *   npm run inventario:importar -- ../../../datos-importacion/inventario-baja-bbge-2026-10.csv
 *   npm run inventario:importar -- ../../../datos-importacion/inventario-baja-bbge-2026-10.csv --simular
 *
 * Los CSV son datos reales del hotel: se guardan fuera del repositorio
 * (C:\Pa donde\Down Proyect\datos-importacion\) y nunca se suben a GitHub.
 *
 * Columnas (la primera fila son los títulos):
 *   numeroSerie,tipo,marca,modelo,costo,ubicacion,especificaciones
 *
 * Reglas:
 *  - El número de serie se normaliza igual que en el sistema (sin espacios, en mayúsculas).
 *  - Un número de serie que ya existe en el inventario no se vuelve a crear.
 *  - Una fila con datos inválidos no se carga y se reporta con su número de línea.
 *  - Con --simular solo revisa el archivo y dice qué haría, sin guardar nada.
 */
import "../src/lib/entorno.ts";
import { readFile } from "node:fs/promises";
import { normalizarNumeroSerie } from "../src/lib/clientePrisma.ts";
import { TipoEquipo } from "../src/generated/prisma/enums.ts";

export interface FilaInventario {
  linea: number;
  numeroSerie: string;
  tipo: TipoEquipo;
  marca: string;
  modelo: string;
  costo: string | null;
  ubicacion: string | null;
  especificaciones: string | null;
}

const COLUMNAS = ["numeroSerie", "tipo", "marca", "modelo", "costo", "ubicacion", "especificaciones"] as const;

/** Separa una línea de CSV respetando comillas ("Teclado, USB" o comillas dobles ""). */
export function separarLineaCsv(linea: string): string[] {
  const celdas: string[] = [];
  let actual = "";
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const caracter = linea[i]!;
    if (entreComillas) {
      if (caracter === '"' && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else if (caracter === '"') entreComillas = false;
      else actual += caracter;
    } else if (caracter === '"') entreComillas = true;
    else if (caracter === ",") {
      celdas.push(actual);
      actual = "";
    } else actual += caracter;
  }
  celdas.push(actual);
  return celdas;
}

/** Lee el CSV y separa las filas válidas de las que tienen errores. */
export function leerCsvInventario(texto: string): { filas: FilaInventario[]; errores: string[] } {
  const lineas = texto.replace(/^﻿/, "").split(/\r?\n/);
  const titulos = separarLineaCsv(lineas[0] ?? "").map((t) => t.trim());
  const faltantes = COLUMNAS.filter((c) => !titulos.includes(c));
  if (faltantes.length > 0) return { filas: [], errores: [`Faltan columnas en la primera fila: ${faltantes.join(", ")}.`] };

  const filas: FilaInventario[] = [];
  const errores: string[] = [];
  const vistos = new Map<string, number>();
  lineas.slice(1).forEach((linea, i) => {
    const numero = i + 2;
    if (linea.trim() === "") return;
    const celdas = separarLineaCsv(linea);
    const valor = (columna: (typeof COLUMNAS)[number]) => (celdas[titulos.indexOf(columna)] ?? "").trim();

    const numeroSerie = normalizarNumeroSerie(valor("numeroSerie"));
    const tipo = valor("tipo").toUpperCase();
    const marca = valor("marca");
    const modelo = valor("modelo");
    const costo = valor("costo").replace(/[\s,$]/g, "");
    const problemas: string[] = [];
    if (numeroSerie === "") problemas.push("falta el número de serie");
    else if (numeroSerie.length > 100) problemas.push("el número de serie pasa de 100 caracteres");
    if (!(tipo in TipoEquipo)) problemas.push(`el tipo «${valor("tipo")}» no existe`);
    if (marca === "") problemas.push("falta la marca");
    if (modelo === "") problemas.push("falta el modelo");
    if (costo !== "" && !/^\d{1,8}(\.\d{1,2})?$/.test(costo)) problemas.push(`el costo «${valor("costo")}» no es válido`);
    if (numeroSerie !== "" && vistos.has(numeroSerie)) problemas.push(`el número de serie ${numeroSerie} ya venía en la línea ${vistos.get(numeroSerie)}`);
    if (problemas.length > 0) {
      errores.push(`Línea ${numero}: ${problemas.join("; ")}.`);
      return;
    }
    vistos.set(numeroSerie, numero);
    filas.push({
      linea: numero,
      numeroSerie,
      tipo: tipo as TipoEquipo,
      marca: marca.slice(0, 80),
      modelo: modelo.slice(0, 100),
      costo: costo === "" ? null : costo,
      ubicacion: valor("ubicacion").slice(0, 150) || null,
      especificaciones: valor("especificaciones") || null,
    });
  });
  return { filas, errores };
}

async function principal() {
  const argumentos = process.argv.slice(2);
  const simular = argumentos.includes("--simular");
  const archivo = argumentos.find((a) => !a.startsWith("--"));
  if (!archivo) {
    console.error("Indica el archivo CSV. Ejemplo: npm run inventario:importar -- ../../../datos-importacion/inventario-baja-bbge-2026-10.csv");
    process.exit(1);
  }

  const { filas, errores } = leerCsvInventario(await readFile(archivo, "utf8"));
  const { prisma } = await import("../src/lib/prisma.ts");
  try {
    const existentes = new Set(
      (await prisma.equipo.findMany({ where: { numeroSerie: { in: filas.map((f) => f.numeroSerie) } }, select: { numeroSerie: true } })).map((e) => e.numeroSerie),
    );
    const nuevas = filas.filter((f) => !existentes.has(f.numeroSerie));
    if (!simular && nuevas.length > 0) {
      await prisma.equipo.createMany({
        data: nuevas.map((f) => ({
          numeroSerie: f.numeroSerie, tipo: f.tipo, marca: f.marca, modelo: f.modelo,
          costo: f.costo, ubicacion: f.ubicacion, especificaciones: f.especificaciones,
        })),
      });
    }
    console.log(`${simular ? "[SIMULACIÓN] " : ""}Archivo: ${archivo}`);
    console.log(`  Filas válidas: ${filas.length}`);
    console.log(`  ${simular ? "Se crearían" : "Equipos creados"}: ${nuevas.length}`);
    console.log(`  Ya estaban en el inventario: ${filas.length - nuevas.length}`);
    console.log(`  Filas con errores: ${errores.length}`);
    for (const error of errores) console.log(`    - ${error}`);
  } finally {
    await prisma.$disconnect();
  }
}

// Solo se ejecuta al llamarlo como script (las pruebas importan las funciones).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("importar-inventario.ts")) {
  await principal();
}
