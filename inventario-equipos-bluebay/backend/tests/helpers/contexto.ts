import "../../src/lib/entorno.ts";
import type { Express } from "express";
import request from "supertest";
import { expect } from "vitest";
import { crearClientePrisma } from "../../src/lib/clientePrisma.ts";
import { cifrarContrasena } from "../../src/modulos/autenticacion/autenticacion.modulo.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("Falta TEST_DATABASE_URL en el archivo .env");

/** Cliente conectado a la base de PRUEBAS (nunca a la real). */
export const db = crearClientePrisma(url);

/** Vacía las tablas respetando el orden de las llaves foráneas. */
export async function limpiarTablas(): Promise<void> {
  await db.mantenimiento.deleteMany();
  await db.asignacion.deleteMany();
  await db.equipo.deleteMany();
  await vaciarBajas();
  await db.empleado.deleteMany();
  await db.departamento.deleteMany();
}

/**
 * Las actas de baja y sus renglones no se pueden borrar (triggers trg_bajas_no_borrar y trg_bajas_articulos_no_borrar). TRUNCATE
 * no dispara triggers; se desactivan las llaves foráneas en la misma conexión
 * porque MySQL no permite truncar una tabla referenciada.
 */
async function vaciarBajas(): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
    await tx.$executeRawUnsafe("TRUNCATE TABLE `bajas_articulos`");
    await tx.$executeRawUnsafe("TRUNCATE TABLE `bajas`");
    await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
  });
}

type ErrorConCodigo = Error & { code?: string };

/**
 * Espera que la operación sea RECHAZADA y devuelve el error para revisarlo.
 * Si la operación se completa, la prueba falla.
 */
export async function rechazo(operacion: Promise<unknown>): Promise<ErrorConCodigo> {
  const resultado = await operacion.then(
    () => null,
    (error: unknown) => error as ErrorConCodigo,
  );
  expect(resultado, "se esperaba que la base de datos rechazara la operación").not.toBeNull();
  return resultado!;
}

let consecutivo = 0;
const siguiente = () => ++consecutivo;

export async function crearDepartamento(nombre = `Departamento ${siguiente()}`) {
  return db.departamento.create({ data: { nombre } });
}

export async function crearEmpleado(datos: Partial<{ numeroEmpleado: string; nombre: string; apellidos: string; puesto: string; departamentoId: number }> = {}) {
  const departamentoId = datos.departamentoId ?? (await crearDepartamento()).id;
  return db.empleado.create({
    data: {
      numeroEmpleado: `E-${siguiente()}`,
      nombre: "Nombre",
      apellidos: "Apellido Prueba",
      puesto: "Puesto de prueba",
      ...datos,
      departamentoId,
    },
  });
}

export async function crearEquipo(datos: Partial<{ numeroSerie: string; marca: string; modelo: string; costo: string | number }> = {}) {
  return db.equipo.create({
    data: { numeroSerie: `SN-${siguiente()}`, tipo: "LAPTOP", marca: "Marca", modelo: "Modelo", ...datos },
  });
}

// -----------------------------------------------------------------------------
// Usuarios y sesiones
// -----------------------------------------------------------------------------

export const CONTRASENA_PRUEBA = "Contrasena-de-prueba-1";
let hashPrueba: Promise<string> | undefined;

/** Crea (o reactiva) un usuario con la contraseña CONTRASENA_PRUEBA. */
export async function crearUsuario(datos: Partial<{ usuario: string; nombre: string; rol: "ADMIN" | "TECNICO"; activo: boolean }> = {}) {
  const usuario = datos.usuario ?? `usuario${siguiente()}`;
  hashPrueba ??= cifrarContrasena(CONTRASENA_PRUEBA);
  const fila = {
    nombre: datos.nombre ?? "Usuario de Prueba", rol: datos.rol ?? "TECNICO", activo: datos.activo ?? true,
    contrasenaHash: await hashPrueba, intentosFallidos: 0, bloqueadoHasta: null,
  };
  return db.usuario.upsert({ where: { usuario }, create: { usuario, ...fila }, update: fila });
}

/** Vacía usuarios y sesiones (solo las pruebas de acceso lo necesitan). */
export async function limpiarUsuarios(): Promise<void> {
  await db.sesion.deleteMany();
  await db.usuario.deleteMany();
}

/**
 * Devuelve un cliente de supertest que ya inició sesión (guarda la cookie).
 * Se usa igual que request(app): sesion.get("/api/equipos").
 */
export async function iniciarSesionDePrueba(app: Express, datos: Parameters<typeof crearUsuario>[0] = {}) {
  const usuario = await crearUsuario({ usuario: "prueba.tecnico", ...datos });
  const agente = request.agent(app);
  const res = await agente.post("/api/auth/iniciar-sesion").send({ usuario: usuario.usuario, contrasena: CONTRASENA_PRUEBA });
  expect(res.status, "no se pudo iniciar la sesión de prueba").toBe(200);
  return agente;
}
