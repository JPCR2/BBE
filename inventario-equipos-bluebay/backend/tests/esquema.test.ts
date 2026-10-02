import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fechaATexto, fechaDesdeTexto, hoyEnElHotel, sumarDias } from "../src/lib/fechas.ts";
import { crearDepartamento, crearEmpleado, crearEquipo, crearUsuario, db, limpiarTablas, limpiarUsuarios, rechazo } from "./helpers/contexto.ts";

beforeEach(limpiarTablas);
afterAll(() => db.$disconnect());

// =============================================================================
describe("Estructura de la base de datos", () => {
  it("tiene las 9 tablas, los 4 triggers y las 26 restricciones CHECK", async () => {
    const tablas = await db.$queryRaw<{ nombre: string }[]>`
      SELECT TABLE_NAME AS nombre FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`;
    expect(tablas.map((t) => t.nombre)).toEqual(["asignaciones", "bajas", "bajas_articulos", "departamentos", "empleados", "equipos", "mantenimientos", "sesiones", "usuarios"]);

    const triggers = await db.$queryRaw<{ nombre: string }[]>`
      SELECT TRIGGER_NAME AS nombre FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY TRIGGER_NAME`;
    expect(triggers.map((t) => t.nombre)).toEqual([
      "trg_asignaciones_una_vigente_insert",
      "trg_asignaciones_una_vigente_update",
      "trg_bajas_articulos_no_borrar",
      "trg_bajas_no_borrar",
    ]);

    const checks = await db.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM information_schema.CHECK_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME LIKE 'chk\\_%'`;
    expect(Number(checks[0]!.total)).toBe(26);
  });
});

// =============================================================================
describe("Equipo", () => {
  it("registra un equipo con los datos mínimos y aplica los valores por defecto", async () => {
    const equipo = await db.equipo.create({
      data: { numeroSerie: "ABC123", tipo: "ESCRITORIO", marca: "HP", modelo: "ProDesk 400" },
    });
    expect(equipo).toMatchObject({ numeroSerie: "ABC123", estado: "ACTIVO", costo: null, fechaAdquisicion: null, ubicacion: null });
    expect(equipo.creadoEn).toBeInstanceOf(Date);
  });

  it("normaliza el número de serie: quita espacios y pasa a mayúsculas", async () => {
    const equipo = await crearEquipo({ numeroSerie: "  5cd 12ab-x9 " });
    expect(equipo.numeroSerie).toBe("5CD12AB-X9");
  });

  it("encuentra un equipo por número de serie aunque se escriba distinto", async () => {
    await crearEquipo({ numeroSerie: "5CD12AB" });
    const encontrado = await db.equipo.findUnique({ where: { numeroSerie: " 5cd 12ab " } });
    expect(encontrado?.numeroSerie).toBe("5CD12AB");
  });

  it("rechaza un número de serie repetido", async () => {
    await crearEquipo({ numeroSerie: "DUP-001" });
    const error = await rechazo(crearEquipo({ numeroSerie: "DUP-001" }));
    expect(error.code).toBe("P2002");
    expect(error.message).toMatch(/equipos_numeroSerie_key/);
  });

  it("rechaza el repetido aunque cambien mayúsculas o espacios (también saltándose Prisma)", async () => {
    await crearEquipo({ numeroSerie: "abc-1" });
    expect((await rechazo(crearEquipo({ numeroSerie: " ABC-1 " }))).code).toBe("P2002");

    // Insertando con SQL directo (sin la normalización de la app), la base lo sigue detectando.
    await db.$executeRaw`INSERT INTO equipos (numeroSerie, tipo, marca, modelo, actualizadoEn) VALUES ('xyz-2', 'LAPTOP', 'HP', 'X', NOW(3))`;
    const error = await rechazo(
      db.$executeRaw`INSERT INTO equipos (numeroSerie, tipo, marca, modelo, actualizadoEn) VALUES ('XYZ-2', 'LAPTOP', 'HP', 'X', NOW(3))`,
    );
    expect(error.message).toMatch(/Duplicate entry/);
  });

  it.each([
    ["vacío", ""],
    ["solo espacios", "     "],
  ])("rechaza un número de serie %s", async (_caso, numeroSerie) => {
    const error = await rechazo(crearEquipo({ numeroSerie }));
    expect(error.message).toMatch(/chk_equipos_serie_no_vacia/);
  });

  it("rechaza marca o modelo vacíos", async () => {
    expect((await rechazo(crearEquipo({ marca: "  " }))).message).toMatch(/chk_equipos_marca_no_vacia/);
    expect((await rechazo(crearEquipo({ modelo: "" }))).message).toMatch(/chk_equipos_modelo_no_vacio/);
  });

  it("rechaza costo negativo y acepta costo cero", async () => {
    expect((await rechazo(crearEquipo({ costo: -0.01 }))).message).toMatch(/chk_equipos_costo_no_negativo/);
    const gratis = await crearEquipo({ costo: 0 });
    expect(gratis.costo?.toString()).toBe("0");
  });

  it("guarda el costo con exactitud de centavos (sin errores de punto flotante)", async () => {
    const equipo = await crearEquipo({ costo: "18499.99" });
    expect(equipo.costo?.toFixed(2)).toBe("18499.99");
    const suma = await crearEquipo({ costo: 0.1 + 0.2 }); // 0.30000000000000004 en JavaScript
    expect(suma.costo?.toFixed(2)).toBe("0.30");
  });

  it("rechaza un costo que no cabe en DECIMAL(10,2) (máximo 99,999,999.99)", async () => {
    await rechazo(crearEquipo({ costo: "100000000.00" }));
  });

  it("rechaza un tipo de equipo que no existe en el catálogo", async () => {
    const error = await rechazo(
      // @ts-expect-error: se envía a propósito un valor que no está en el enum
      db.equipo.create({ data: { numeroSerie: "T-1", tipo: "TABLET", marca: "X", modelo: "Y" } }),
    );
    expect(error.name).toBe("PrismaClientValidationError");
  });

  it("la base rechaza una fecha inexistente (30 de febrero) si llega como texto", async () => {
    const error = await rechazo(
      db.$executeRaw`INSERT INTO equipos (numeroSerie, tipo, marca, modelo, fechaAdquisicion, actualizadoEn)
                     VALUES ('F-1', 'LAPTOP', 'HP', 'X', '2026-02-30', NOW(3))`,
    );
    expect(error.message).toMatch(/Incorrect date value/);
  });

  it("guarda las fechas de calendario sin corrimiento de zona horaria", async () => {
    const equipo = await db.equipo.create({
      data: { numeroSerie: "F-2", tipo: "LAPTOP", marca: "HP", modelo: "X", fechaAdquisicion: fechaDesdeTexto("2026-10-01") },
    });
    expect(fechaATexto(equipo.fechaAdquisicion!)).toBe("2026-10-01");
    const [fila] = await db.$queryRaw<{ f: string }[]>`SELECT CAST(fechaAdquisicion AS CHAR) AS f FROM equipos WHERE id = ${equipo.id}`;
    expect(fila!.f).toBe("2026-10-01");
  });

  it("no permite borrar un equipo que tiene asignaciones o mantenimientos", async () => {
    const conAsignacion = await crearEquipo();
    await db.asignacion.create({ data: { equipoId: conAsignacion.id, empleadoId: (await crearEmpleado()).id } });
    expect((await rechazo(db.equipo.delete({ where: { id: conAsignacion.id } }))).code).toBe("P2003");

    const conMantenimiento = await crearEquipo();
    await db.mantenimiento.create({
      data: { equipoId: conMantenimiento.id, tipo: "CORRECTIVO", estado: "REALIZADO", fechaRealizacion: fechaDesdeTexto("2026-09-01"), descripcion: "Cambio de fuente" },
    });
    expect((await rechazo(db.equipo.delete({ where: { id: conMantenimiento.id } }))).code).toBe("P2003");
  });
});

// =============================================================================
describe("Departamento", () => {
  it("rechaza nombres duplicados aunque cambien acentos o mayúsculas", async () => {
    await crearDepartamento("Recepción");
    const error = await rechazo(crearDepartamento("RECEPCION"));
    expect(error.code).toBe("P2002");
  });

  it("rechaza un nombre vacío", async () => {
    expect((await rechazo(crearDepartamento("   "))).message).toMatch(/chk_departamentos_nombre_no_vacio/);
  });

  it("no permite borrar un departamento que tiene empleados", async () => {
    const departamento = await crearDepartamento("Contabilidad");
    await crearEmpleado({ departamentoId: departamento.id });
    expect((await rechazo(db.departamento.delete({ where: { id: departamento.id } }))).code).toBe("P2003");
  });
});

// =============================================================================
describe("Empleado", () => {
  it("registra un empleado activo por defecto y ligado a su departamento", async () => {
    const departamento = await crearDepartamento("Sistemas");
    const empleado = await crearEmpleado({ numeroEmpleado: "1001", departamentoId: departamento.id });
    const leido = await db.empleado.findUniqueOrThrow({ where: { id: empleado.id }, include: { departamento: true } });
    expect(leido.activo).toBe(true);
    expect(leido.departamento.nombre).toBe("Sistemas");
  });

  it("limpia los espacios del número de empleado", async () => {
    const empleado = await crearEmpleado({ numeroEmpleado: "  1002 " });
    expect(empleado.numeroEmpleado).toBe("1002");
  });

  it("rechaza un número de empleado repetido", async () => {
    await crearEmpleado({ numeroEmpleado: "1003" });
    const error = await rechazo(crearEmpleado({ numeroEmpleado: "1003" }));
    expect(error.code).toBe("P2002");
    expect(error.message).toMatch(/empleados_numeroEmpleado_key/);
  });

  it.each([
    ["numeroEmpleado", "chk_empleados_numero_no_vacio"],
    ["nombre", "chk_empleados_nombre_no_vacio"],
    ["apellidos", "chk_empleados_apellidos_no_vacio"],
    ["puesto", "chk_empleados_puesto_no_vacio"],
  ])("rechaza %s vacío", async (campo, restriccion) => {
    const error = await rechazo(crearEmpleado({ [campo]: "   " }));
    expect(error.message).toMatch(new RegExp(restriccion));
  });

  it("rechaza un departamento que no existe", async () => {
    const error = await rechazo(crearEmpleado({ departamentoId: 999_999 }));
    expect(error.code).toBe("P2003");
  });

  it("al desactivar a un empleado se conserva su historial de asignaciones", async () => {
    const empleado = await crearEmpleado();
    const equipo = await crearEquipo();
    await db.asignacion.create({
      data: {
        equipoId: equipo.id,
        empleadoId: empleado.id,
        fechaAsignacion: new Date("2026-01-10T15:00:00Z"),
        fechaDevolucion: new Date("2026-03-01T15:00:00Z"),
      },
    });
    await db.empleado.update({ where: { id: empleado.id }, data: { activo: false } });
    expect(await db.asignacion.count({ where: { empleadoId: empleado.id } })).toBe(1);
  });
});

// =============================================================================
describe("Asignacion", () => {
  it("asigna un equipo y la asignación queda vigente", async () => {
    const asignacion = await db.asignacion.create({
      data: { equipoId: (await crearEquipo()).id, empleadoId: (await crearEmpleado()).id },
    });
    expect(asignacion.fechaDevolucion).toBeNull();
    expect(Math.abs(asignacion.fechaAsignacion.getTime() - Date.now())).toBeLessThan(10_000);
  });

  it("rechaza una segunda asignación vigente del mismo equipo, aunque sea a otra persona", async () => {
    const equipo = await crearEquipo();
    await db.asignacion.create({ data: { equipoId: equipo.id, empleadoId: (await crearEmpleado()).id } });
    const error = await rechazo(db.asignacion.create({ data: { equipoId: equipo.id, empleadoId: (await crearEmpleado()).id } }));
    expect(error.message).toMatch(/\[ASIGNACION_VIGENTE\]/);
  });

  it("permite devolver y reasignar el equipo, conservando el historial", async () => {
    const equipo = await crearEquipo();
    const primera = await db.asignacion.create({ data: { equipoId: equipo.id, empleadoId: (await crearEmpleado()).id } });
    await db.asignacion.update({ where: { id: primera.id }, data: { fechaDevolucion: new Date() } });
    await db.asignacion.create({ data: { equipoId: equipo.id, empleadoId: (await crearEmpleado()).id } });

    expect(await db.asignacion.count({ where: { equipoId: equipo.id } })).toBe(2);
    expect(await db.asignacion.count({ where: { equipoId: equipo.id, fechaDevolucion: null } })).toBe(1);
  });

  it("rechaza reabrir una asignación cerrada si el equipo ya tiene otra vigente", async () => {
    const equipo = await crearEquipo();
    const vieja = await db.asignacion.create({
      data: {
        equipoId: equipo.id,
        empleadoId: (await crearEmpleado()).id,
        fechaAsignacion: new Date("2026-01-10T15:00:00Z"),
        fechaDevolucion: new Date("2026-03-01T15:00:00Z"),
      },
    });
    await db.asignacion.create({ data: { equipoId: equipo.id, empleadoId: (await crearEmpleado()).id } });
    const error = await rechazo(db.asignacion.update({ where: { id: vieja.id }, data: { fechaDevolucion: null } }));
    expect(error.message).toMatch(/\[ASIGNACION_VIGENTE\]/);
  });

  it("rechaza mover una asignación vigente a un equipo que ya está asignado", async () => {
    const equipoA = await crearEquipo();
    const equipoB = await crearEquipo();
    const enA = await db.asignacion.create({ data: { equipoId: equipoA.id, empleadoId: (await crearEmpleado()).id } });
    await db.asignacion.create({ data: { equipoId: equipoB.id, empleadoId: (await crearEmpleado()).id } });
    const error = await rechazo(db.asignacion.update({ where: { id: enA.id }, data: { equipoId: equipoB.id } }));
    expect(error.message).toMatch(/\[ASIGNACION_VIGENTE\]/);
  });

  it("permite editar las observaciones de la asignación vigente (el trigger no se bloquea a sí mismo)", async () => {
    const asignacion = await db.asignacion.create({ data: { equipoId: (await crearEquipo()).id, empleadoId: (await crearEmpleado()).id } });
    const editada = await db.asignacion.update({ where: { id: asignacion.id }, data: { observaciones: "Incluye cargador" } });
    expect(editada.observaciones).toBe("Incluye cargador");
  });

  it("permite capturar asignaciones históricas (ya cerradas) aunque haya una vigente", async () => {
    const equipo = await crearEquipo();
    await db.asignacion.create({ data: { equipoId: equipo.id, empleadoId: (await crearEmpleado()).id } });
    const historica = await db.asignacion.create({
      data: {
        equipoId: equipo.id,
        empleadoId: (await crearEmpleado()).id,
        fechaAsignacion: new Date("2024-01-10T15:00:00Z"),
        fechaDevolucion: new Date("2024-06-30T15:00:00Z"),
      },
    });
    expect(historica.id).toBeGreaterThan(0);
  });

  it("un empleado puede tener varios equipos vigentes a la vez", async () => {
    const empleado = await crearEmpleado();
    for (let i = 0; i < 3; i++) {
      await db.asignacion.create({ data: { equipoId: (await crearEquipo()).id, empleadoId: empleado.id } });
    }
    expect(await db.asignacion.count({ where: { empleadoId: empleado.id, fechaDevolucion: null } })).toBe(3);
  });

  it("rechaza una devolución con fecha anterior a la asignación", async () => {
    const error = await rechazo(
      db.asignacion.create({
        data: {
          equipoId: (await crearEquipo()).id,
          empleadoId: (await crearEmpleado()).id,
          fechaAsignacion: new Date("2026-09-10T12:00:00Z"),
          fechaDevolucion: new Date("2026-09-09T12:00:00Z"),
        },
      }),
    );
    expect(error.message).toMatch(/chk_asignaciones_devolucion_posterior/);
  });

  it("rechaza asignar a un equipo o empleado que no existen", async () => {
    const empleado = await crearEmpleado();
    const equipo = await crearEquipo();
    expect((await rechazo(db.asignacion.create({ data: { equipoId: 999_999, empleadoId: empleado.id } }))).code).toBe("P2003");
    expect((await rechazo(db.asignacion.create({ data: { equipoId: equipo.id, empleadoId: 999_999 } }))).code).toBe("P2003");
  });
});

// =============================================================================
describe("Mantenimiento", () => {
  it("programa un mantenimiento; el estado por defecto es PROGRAMADO", async () => {
    const mantenimiento = await db.mantenimiento.create({
      data: { equipoId: (await crearEquipo()).id, tipo: "PREVENTIVO", fechaProgramada: fechaDesdeTexto("2026-10-15"), descripcion: "Limpieza" },
    });
    expect(mantenimiento.estado).toBe("PROGRAMADO");
    expect(fechaATexto(mantenimiento.fechaProgramada!)).toBe("2026-10-15");
  });

  it("rechaza un mantenimiento programado sin fecha", async () => {
    const error = await rechazo(
      db.mantenimiento.create({ data: { equipoId: (await crearEquipo()).id, tipo: "PREVENTIVO", descripcion: "Limpieza" } }),
    );
    expect(error.message).toMatch(/chk_mantenimientos_programado_con_fecha/);
  });

  it("cierra un mantenimiento: de PROGRAMADO a REALIZADO con su fecha", async () => {
    const programado = await db.mantenimiento.create({
      data: { equipoId: (await crearEquipo()).id, tipo: "PREVENTIVO", fechaProgramada: fechaDesdeTexto("2026-09-20"), descripcion: "Limpieza" },
    });
    const realizado = await db.mantenimiento.update({
      where: { id: programado.id },
      data: { estado: "REALIZADO", fechaRealizacion: fechaDesdeTexto("2026-09-21"), responsable: "Técnico de prueba" },
    });
    expect(realizado.estado).toBe("REALIZADO");
  });

  it("rechaza marcarlo REALIZADO sin fecha de realización", async () => {
    const programado = await db.mantenimiento.create({
      data: { equipoId: (await crearEquipo()).id, tipo: "PREVENTIVO", fechaProgramada: fechaDesdeTexto("2026-09-20"), descripcion: "Limpieza" },
    });
    const error = await rechazo(db.mantenimiento.update({ where: { id: programado.id }, data: { estado: "REALIZADO" } }));
    expect(error.message).toMatch(/chk_mantenimientos_realizado_con_fecha/);
  });

  it("permite registrar un correctivo ya realizado, sin fecha programada", async () => {
    const correctivo = await db.mantenimiento.create({
      data: {
        equipoId: (await crearEquipo()).id,
        tipo: "CORRECTIVO",
        estado: "REALIZADO",
        fechaRealizacion: fechaDesdeTexto("2026-09-18"),
        descripcion: "Cambio de disco duro",
      },
    });
    expect(correctivo.fechaProgramada).toBeNull();
  });

  it("permite cancelar un mantenimiento programado", async () => {
    const programado = await db.mantenimiento.create({
      data: { equipoId: (await crearEquipo()).id, tipo: "PREVENTIVO", fechaProgramada: fechaDesdeTexto("2026-11-01"), descripcion: "Revisión" },
    });
    const cancelado = await db.mantenimiento.update({ where: { id: programado.id }, data: { estado: "CANCELADO" } });
    expect(cancelado.estado).toBe("CANCELADO");
  });

  it("rechaza una descripción vacía", async () => {
    const error = await rechazo(
      db.mantenimiento.create({
        data: { equipoId: (await crearEquipo()).id, tipo: "PREVENTIVO", fechaProgramada: fechaDesdeTexto("2026-11-01"), descripcion: "  " },
      }),
    );
    expect(error.message).toMatch(/chk_mantenimientos_descripcion_no_vacia/);
  });

  it("vencidos y próximos se obtienen consultando fechaProgramada (sin guardarlos)", async () => {
    const hoy = fechaDesdeTexto(hoyEnElHotel());
    const equipoId = (await crearEquipo()).id;
    for (const [dias, descripcion] of [[-2, "vencido"], [2, "proximo"], [30, "lejano"]] as const) {
      await db.mantenimiento.create({ data: { equipoId, tipo: "PREVENTIVO", fechaProgramada: sumarDias(hoy, dias), descripcion } });
    }
    const vencidos = await db.mantenimiento.findMany({ where: { estado: "PROGRAMADO", fechaProgramada: { lt: hoy } } });
    const proximos = await db.mantenimiento.findMany({
      where: { estado: "PROGRAMADO", fechaProgramada: { gte: hoy, lte: sumarDias(hoy, 7) } },
    });
    expect(vencidos.map((m) => m.descripcion)).toEqual(["vencido"]);
    expect(proximos.map((m) => m.descripcion)).toEqual(["proximo"]);
  });
});

// =============================================================================
describe("Usuario y Sesion", () => {
  beforeEach(limpiarUsuarios);

  it("la base rechaza nombres de usuario con mayúsculas, espacios, acentos o muy cortos", async () => {
    for (const usuario of ["JPolanco", "j polanco", "josé", "ab", ""]) {
      const error = await rechazo(db.usuario.create({ data: { usuario, nombre: "X", contrasenaHash: "x" } }));
      expect(error.message, usuario).toMatch(/chk_usuarios_usuario/);
    }
    await expect(db.usuario.create({ data: { usuario: "j.polanco-2_b", nombre: "Joel", contrasenaHash: "x" } })).resolves.toBeTruthy();
  });

  it("no permite dos usuarios con el mismo nombre de usuario", async () => {
    await crearUsuario({ usuario: "jpolanco" });
    const error = await rechazo(db.usuario.create({ data: { usuario: "jpolanco", nombre: "Otro", contrasenaHash: "x" } }));
    expect(error.message).toMatch(/usuarios_usuario_key/);
  });

  it("el rol por defecto es TECNICO y el usuario empieza activo y sin intentos fallidos", async () => {
    const usuario = await db.usuario.create({ data: { usuario: "nuevo", nombre: "Nuevo", contrasenaHash: "x" } });
    expect(usuario).toMatchObject({ rol: "TECNICO", activo: true, intentosFallidos: 0, bloqueadoHasta: null, ultimoAcceso: null });
  });

  it("el id de sesión distingue mayúsculas de minúsculas", async () => {
    const expiraEn = new Date(Date.now() + 60_000);
    await db.sesion.create({ data: { id: "AbC123", datos: "{}", expiraEn } });
    await db.sesion.create({ data: { id: "abc123", datos: "{}", expiraEn } });
    expect(await db.sesion.findUnique({ where: { id: "ABC123" } })).toBeNull();
    expect((await db.sesion.findUnique({ where: { id: "AbC123" } }))?.id).toBe("AbC123");
  });

  it("al borrar un usuario se borran sus sesiones", async () => {
    const usuario = await crearUsuario();
    await db.sesion.create({ data: { id: "s1", usuarioId: usuario.id, datos: "{}", expiraEn: new Date(Date.now() + 60_000) } });
    await db.usuario.delete({ where: { id: usuario.id } });
    expect(await db.sesion.count()).toBe(0);
  });
});

// =============================================================================
describe("Horas y zona horaria", () => {
  it("creadoEn y actualizadoEn coinciden con la hora real, aunque el servidor esté en UTC−5", async () => {
    const departamento = await crearDepartamento();
    expect(Math.abs(departamento.creadoEn.getTime() - Date.now())).toBeLessThan(10_000);
    expect(Math.abs(departamento.creadoEn.getTime() - departamento.actualizadoEn.getTime())).toBeLessThan(1_000);
  });
});
