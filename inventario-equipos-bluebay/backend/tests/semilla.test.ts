import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sembrarDatosDemo } from "../prisma/datos-demo.ts";
import { fechaDesdeTexto, hoyEnElHotel, sumarDias } from "../src/lib/fechas.ts";
import { db, limpiarTablas } from "./helpers/contexto.ts";

beforeAll(limpiarTablas);
afterAll(() => db.$disconnect());

describe("Datos demo (seed)", () => {
  it("inserta los datos demo completos en una base vacía", async () => {
    const resultado = await sembrarDatosDemo(db);
    expect(resultado).toEqual({ omitido: false, departamentos: 6, empleados: 5, equipos: 6, asignaciones: 5, mantenimientos: 7 });

    expect(await db.asignacion.count({ where: { fechaDevolucion: null } })).toBe(4);

    const hoy = fechaDesdeTexto(hoyEnElHotel());
    const vencidos = await db.mantenimiento.count({ where: { estado: "PROGRAMADO", fechaProgramada: { lt: hoy } } });
    const proximos = await db.mantenimiento.count({
      where: { estado: "PROGRAMADO", fechaProgramada: { gte: hoy, lte: sumarDias(hoy, 7) } },
    });
    expect({ vencidos, proximos }).toEqual({ vencidos: 1, proximos: 2 });
  });

  it("no duplica ni mezcla datos si se ejecuta otra vez", async () => {
    const segunda = await sembrarDatosDemo(db);
    expect(segunda.omitido).toBe(true);
    expect(await db.equipo.count()).toBe(6);
    expect(await db.empleado.count()).toBe(5);
  });
});
