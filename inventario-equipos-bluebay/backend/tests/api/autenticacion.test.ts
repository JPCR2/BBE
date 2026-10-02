import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { crearApp } from "../../src/app.ts";
import { AlmacenSesionesPrisma } from "../../src/lib/almacenSesiones.ts";
import { CONTRASENA_PRUEBA, crearUsuario, db, iniciarSesionDePrueba, limpiarUsuarios } from "../helpers/contexto.ts";

const SECRETO = "secreto-de-pruebas";
let ahora = new Date("2026-10-02T15:00:00Z");
const relojAcceso = () => ahora;
const app = crearApp({ db, relojAcceso, secretoSesion: SECRETO });
const api = () => request(app);

const minutos = (n: number) => new Date(ahora.getTime() + n * 60_000);
const horas = (n: number) => minutos(n * 60);

beforeEach(async () => {
  ahora = new Date("2026-10-02T15:00:00Z");
  await limpiarUsuarios();
});
afterAll(() => db.$disconnect());

/** Intenta iniciar sesión con un cliente nuevo (sin cookie). */
const entrar = (usuario: string, contrasena: string = CONTRASENA_PRUEBA) =>
  api().post("/api/auth/iniciar-sesion").send({ usuario, contrasena });

const cookieDe = (res: request.Response) => ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.startsWith("inventario.sid="));

// =============================================================================
describe("Rutas protegidas", () => {
  it("sin sesión, todas las rutas de datos responden 401", async () => {
    for (const ruta of ["/api/resumen", "/api/equipos", "/api/empleados", "/api/departamentos", "/api/mantenimientos/avisos", "/api/bajas", "/api/usuarios", "/api/reportes/bajas/1/pdf", "/api/auth/sesion"]) {
      const res = await api().get(ruta);
      expect(res.status, ruta).toBe(401);
      expect(res.body.error.codigo, ruta).toBe("NO_AUTENTICADO");
    }
  });

  it("sin sesión tampoco se puede escribir (POST/PATCH/DELETE)", async () => {
    expect((await api().post("/api/equipos").send({ numeroSerie: "X" })).status).toBe(401);
    expect((await api().patch("/api/equipos/1").send({ marca: "X" })).status).toBe(401);
    expect((await api().post("/api/bajas").send({})).status).toBe(401);
    expect(await db.equipo.count()).toBe(0);
  });

  it("/api/salud funciona sin sesión (para revisar que la API está encendida)", async () => {
    const res = await api().get("/api/salud");
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("una cookie inventada o alterada no sirve", async () => {
    const sesion = await iniciarSesionDePrueba(app);
    const res = await sesion.get("/api/auth/sesion");
    expect(res.status).toBe(200);
    for (const cookie of ["inventario.sid=s%3Ainventada.firmaFalsa", "inventario.sid=abc"]) {
      const falsa = await api().get("/api/equipos").set("Cookie", cookie);
      expect(falsa.status).toBe(401);
    }
  });
});

// =============================================================================
describe("Iniciar sesión", () => {
  it("con usuario y contraseña correctos devuelve el usuario (sin el hash) y una cookie segura", async () => {
    const usuario = await crearUsuario({ usuario: "jpolanco", nombre: "Joel Polanco", rol: "ADMIN" });
    const res = await entrar("jpolanco");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ usuario: { id: usuario.id, usuario: "jpolanco", nombre: "Joel Polanco", rol: "ADMIN" } });
    expect(JSON.stringify(res.body)).not.toMatch(/contrasena|hash/i);

    const cookie = cookieDe(res)!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/api/);
    // Sin fecha de vencimiento: el navegador la borra al cerrarse.
    expect(cookie).not.toMatch(/Expires|Max-Age/i);

    const guardado = await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(guardado.ultimoAcceso).toEqual(ahora);
  });

  it("con la sesión iniciada se puede usar la API y consultar quién soy", async () => {
    const sesion = request.agent(app);
    await crearUsuario({ usuario: "tecnico1", nombre: "Ana Técnica" });
    await sesion.post("/api/auth/iniciar-sesion").send({ usuario: "tecnico1", contrasena: CONTRASENA_PRUEBA }).expect(200);
    expect((await sesion.get("/api/equipos")).status).toBe(200);
    const yo = await sesion.get("/api/auth/sesion");
    expect(yo.body.usuario).toMatchObject({ usuario: "tecnico1", nombre: "Ana Técnica", rol: "TECNICO" });
  });

  it("el usuario no distingue mayúsculas ni espacios alrededor", async () => {
    await crearUsuario({ usuario: "jpolanco" });
    expect((await entrar("  JPolanco ")).status).toBe(200);
  });

  it("la contraseña SÍ distingue mayúsculas y espacios", async () => {
    await crearUsuario({ usuario: "jpolanco" });
    for (const mala of [CONTRASENA_PRUEBA.toUpperCase(), ` ${CONTRASENA_PRUEBA}`, `${CONTRASENA_PRUEBA} `]) {
      expect((await entrar("jpolanco", mala)).status, mala).toBe(401);
    }
  });

  it("contraseña incorrecta y usuario inexistente dan el MISMO mensaje (no revela qué usuarios existen)", async () => {
    await crearUsuario({ usuario: "jpolanco" });
    const mala = await entrar("jpolanco", "otra-contrasena");
    const inexistente = await entrar("nadie", "otra-contrasena");
    expect(mala.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(mala.body).toEqual(inexistente.body);
    expect(mala.body.error).toMatchObject({ codigo: "CREDENCIALES_INVALIDAS", mensaje: "Usuario o contraseña incorrectos." });
    expect(cookieDe(mala)).toBeUndefined();
  });

  it("pide los dos campos si llegan vacíos", async () => {
    const res = await api().post("/api/auth/iniciar-sesion").send({ usuario: "  ", contrasena: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.campos).toEqual({ usuario: "Escribe tu usuario.", contrasena: "Escribe tu contraseña." });
  });

  it("rechaza tipos raros, campos de más y JSON mal formado sin tronar", async () => {
    await crearUsuario({ usuario: "jpolanco" });
    expect((await api().post("/api/auth/iniciar-sesion").send({ usuario: ["jpolanco"], contrasena: { $ne: "" } })).status).toBe(400);
    expect((await api().post("/api/auth/iniciar-sesion").send({ usuario: "jpolanco", contrasena: CONTRASENA_PRUEBA, rol: "ADMIN" })).status).toBe(400);
    const json = await api().post("/api/auth/iniciar-sesion").set("Content-Type", "application/json").send("{usuario:");
    expect(json.status).toBe(400);
    expect(json.body.error.codigo).toBe("JSON_INVALIDO");
  });

  it("textos enormes se rechazan de inmediato (400) sin llegar a bcrypt", async () => {
    await crearUsuario({ usuario: "jpolanco" });
    expect((await entrar("jpolanco", "x".repeat(5000))).status).toBe(400);
    expect((await entrar("u".repeat(500))).status).toBe(400);
  });

  it("al iniciar sesión cambia el id de sesión (no se puede fijar la cookie de antemano)", async () => {
    await crearUsuario({ usuario: "jpolanco" });
    const sesion = request.agent(app);
    const primera = cookieDe(await sesion.post("/api/auth/iniciar-sesion").send({ usuario: "jpolanco", contrasena: CONTRASENA_PRUEBA }));
    const segunda = cookieDe(await sesion.post("/api/auth/iniciar-sesion").send({ usuario: "jpolanco", contrasena: CONTRASENA_PRUEBA }));
    expect(primera).toBeDefined();
    expect(segunda).toBeDefined();
    expect(segunda!.split(";")[0]).not.toBe(primera!.split(";")[0]);
    // La sesión anterior ya no existe en la base.
    expect(await db.sesion.count()).toBe(1);
  });

  it("un usuario desactivado no puede entrar aunque escriba bien la contraseña", async () => {
    await crearUsuario({ usuario: "exempleado", activo: false });
    const res = await entrar("exempleado");
    expect(res.status).toBe(403);
    expect(res.body.error.codigo).toBe("USUARIO_INACTIVO");
    // Con contraseña incorrecta no se revela que existe ni que está desactivado.
    expect((await entrar("exempleado", "mala-contrasena")).body.error.codigo).toBe("CREDENCIALES_INVALIDAS");
  });
});

// =============================================================================
describe("Bloqueo por intentos fallidos", () => {
  it("al 5.º intento fallido bloquea 15 minutos, aunque luego la contraseña sea correcta", async () => {
    await crearUsuario({ usuario: "jpolanco" });
    for (let i = 1; i <= 4; i++) expect((await entrar("jpolanco", "mala")).status, `intento ${i}`).toBe(401);
    const quinto = await entrar("jpolanco", "mala");
    expect(quinto.status).toBe(429);
    expect(quinto.body.error).toMatchObject({ codigo: "USUARIO_BLOQUEADO" });
    expect(quinto.body.error.mensaje).toMatch(/15 minutos/);

    ahora = minutos(10);
    const correcta = await entrar("jpolanco");
    expect(correcta.status).toBe(429);
    expect(correcta.body.error.mensaje).toMatch(/en 5 minutos/);

    ahora = minutos(5);
    expect((await entrar("jpolanco")).status).toBe(200);
  });

  it("dice 'en 1 minuto' (singular) cuando falta menos de un minuto", async () => {
    const usuario = await crearUsuario({ usuario: "jpolanco" });
    await db.usuario.update({ where: { id: usuario.id }, data: { bloqueadoHasta: new Date(ahora.getTime() + 20_000) } });
    expect((await entrar("jpolanco")).body.error.mensaje).toMatch(/en 1 minuto /);
  });

  it("un inicio de sesión correcto reinicia el contador", async () => {
    await crearUsuario({ usuario: "jpolanco" });
    for (let i = 0; i < 4; i++) await entrar("jpolanco", "mala");
    expect((await entrar("jpolanco")).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await entrar("jpolanco", "mala")).status).toBe(401);
  });

  it("vencido el bloqueo, se vuelve a contar desde cero", async () => {
    await crearUsuario({ usuario: "jpolanco" });
    for (let i = 0; i < 5; i++) await entrar("jpolanco", "mala");
    ahora = minutos(16);
    for (let i = 0; i < 4; i++) expect((await entrar("jpolanco", "mala")).status).toBe(401);
    expect((await entrar("jpolanco", "mala")).status).toBe(429);
  });

  it("el bloqueo es por usuario: no afecta a los demás", async () => {
    await crearUsuario({ usuario: "jpolanco" });
    await crearUsuario({ usuario: "otro" });
    for (let i = 0; i < 5; i++) await entrar("jpolanco", "mala");
    expect((await entrar("otro")).status).toBe(200);
  });

  it("intentos con usuarios que no existen no crean nada en la base", async () => {
    for (let i = 0; i < 6; i++) expect((await entrar("fantasma", "mala")).status).toBe(401);
    expect(await db.usuario.count()).toBe(0);
  });
});

// =============================================================================
describe("Cerrar sesión y vencimiento", () => {
  it("al cerrar sesión la cookie deja de servir y se borra de la base", async () => {
    const sesion = await iniciarSesionDePrueba(app);
    expect(await db.sesion.count()).toBe(1);
    const res = await sesion.post("/api/auth/cerrar-sesion");
    expect(res.status).toBe(204);
    expect(cookieDe(res)).toMatch(/inventario.sid=;/);
    expect((await sesion.get("/api/equipos")).status).toBe(401);
    expect(await db.sesion.count()).toBe(0);
  });

  it("cerrar sesión sin haberla iniciado no da error", async () => {
    expect((await api().post("/api/auth/cerrar-sesion")).status).toBe(204);
  });

  it("cerrar sesión en una computadora no cierra la de otra", async () => {
    const pc1 = await iniciarSesionDePrueba(app);
    const pc2 = await iniciarSesionDePrueba(app);
    await pc1.post("/api/auth/cerrar-sesion");
    expect((await pc2.get("/api/equipos")).status).toBe(200);
  });

  it("vence tras 12 horas sin usarse", async () => {
    const sesion = await iniciarSesionDePrueba(app);
    ahora = horas(11);
    expect((await sesion.get("/api/equipos")).status).toBe(200);
    // Se usó a las 11 h: cuenta 12 h desde entonces.
    ahora = horas(11);
    expect((await sesion.get("/api/equipos")).status).toBe(200);
    ahora = horas(12.1);
    expect((await sesion.get("/api/equipos")).status).toBe(401);
    expect(await db.sesion.count()).toBe(0);
  });

  it("si se desactiva al usuario, su sesión abierta deja de funcionar en la siguiente petición", async () => {
    const sesion = await iniciarSesionDePrueba(app);
    await db.usuario.update({ where: { usuario: "prueba.tecnico" }, data: { activo: false } });
    const res = await sesion.get("/api/equipos");
    expect(res.status).toBe(401);
    expect(res.body.error.mensaje).toMatch(/Tu sesión terminó/);
  });

  it("la sesión sobrevive a un reinicio de la API (mismo secreto) pero no con otro secreto", async () => {
    await crearUsuario({ usuario: "jpolanco" });
    const cookie = cookieDe(await entrar("jpolanco"))!.split(";")[0]!;
    const reiniciada = crearApp({ db, relojAcceso, secretoSesion: SECRETO });
    expect((await request(reiniciada).get("/api/equipos").set("Cookie", cookie)).status).toBe(200);
    const otroSecreto = crearApp({ db, relojAcceso, secretoSesion: "otro-secreto" });
    expect((await request(otroSecreto).get("/api/equipos").set("Cookie", cookie)).status).toBe(401);
  });

  it("la limpieza periódica borra solo las sesiones vencidas", async () => {
    await iniciarSesionDePrueba(app);
    ahora = horas(6);
    await iniciarSesionDePrueba(app, { usuario: "otro" });
    const almacen = new AlmacenSesionesPrisma(db, relojAcceso);
    ahora = horas(7); // la primera vence a las 12 h, la segunda a las 18 h
    expect(await almacen.limpiarVencidas()).toBe(1);
    expect(await db.sesion.count()).toBe(1);
  });
});

// =============================================================================
describe("Cambiar mi contraseña", () => {
  const cambiar = (sesion: ReturnType<typeof request.agent>, cuerpo: object) => sesion.post("/api/auth/cambiar-contrasena").send(cuerpo);

  it("cambia la contraseña: la vieja deja de servir y la nueva funciona", async () => {
    const sesion = await iniciarSesionDePrueba(app);
    const res = await cambiar(sesion, { contrasenaActual: CONTRASENA_PRUEBA, contrasenaNueva: "Nueva-Contrasena-9" });
    expect(res.status).toBe(204);
    expect((await entrar("prueba.tecnico")).status).toBe(401);
    expect((await entrar("prueba.tecnico", "Nueva-Contrasena-9")).status).toBe(200);
    // La sesión desde la que se cambió sigue abierta.
    expect((await sesion.get("/api/equipos")).status).toBe(200);
  });

  it("cierra las sesiones del mismo usuario en otras computadoras", async () => {
    const aqui = await iniciarSesionDePrueba(app);
    const otraPc = await iniciarSesionDePrueba(app);
    const deOtro = await iniciarSesionDePrueba(app, { usuario: "otro" });
    await cambiar(aqui, { contrasenaActual: CONTRASENA_PRUEBA, contrasenaNueva: "Nueva-Contrasena-9" }).expect(204);
    expect((await aqui.get("/api/equipos")).status).toBe(200);
    expect((await otraPc.get("/api/equipos")).status).toBe(401);
    expect((await deOtro.get("/api/equipos")).status).toBe(200);
  });

  it("exige la contraseña actual correcta", async () => {
    const sesion = await iniciarSesionDePrueba(app);
    const res = await cambiar(sesion, { contrasenaActual: "equivocada", contrasenaNueva: "Nueva-Contrasena-9" });
    expect(res.status).toBe(400);
    expect(res.body.error.campos).toEqual({ contrasenaActual: "La contraseña actual no es correcta." });
  });

  it("valida la nueva: mínimo 8, no solo espacios, máximo 72 bytes y distinta de la actual", async () => {
    const sesion = await iniciarSesionDePrueba(app);
    const casos: [string, RegExp][] = [
      ["corta", /al menos 8/],
      ["         ", /solo espacios/],
      ["ñ".repeat(37), /demasiado larga/], // 37 ñ = 74 bytes
      [CONTRASENA_PRUEBA, /distinta de la actual/],
    ];
    for (const [nueva, mensaje] of casos) {
      const res = await cambiar(sesion, { contrasenaActual: CONTRASENA_PRUEBA, contrasenaNueva: nueva });
      expect(res.status, nueva).toBe(400);
      expect(res.body.error.campos.contrasenaNueva, nueva).toMatch(mensaje);
    }
    // 36 ñ = 72 bytes: justo en el límite, sí se acepta.
    expect((await cambiar(sesion, { contrasenaActual: CONTRASENA_PRUEBA, contrasenaNueva: "ñ".repeat(36) })).status).toBe(204);
  });

  it("sin sesión no se puede cambiar", async () => {
    const res = await api().post("/api/auth/cambiar-contrasena").send({ contrasenaActual: "x", contrasenaNueva: "12345678" });
    expect(res.status).toBe(401);
  });
});

// =============================================================================
describe("Usuarios (solo administradores)", () => {
  const nuevo = { usuario: " Ana.Lopez ", nombre: "  Ana López  ", rol: "TECNICO", contrasena: "Bienvenida-2026" };

  it("un técnico no puede ver ni crear usuarios", async () => {
    const tecnico = await iniciarSesionDePrueba(app);
    for (const res of [await tecnico.get("/api/usuarios"), await tecnico.post("/api/usuarios").send(nuevo), await tecnico.patch("/api/usuarios/1").send({ activo: false })]) {
      expect(res.status).toBe(403);
      expect(res.body.error.codigo).toBe("SIN_PERMISO");
    }
    expect(await db.usuario.count()).toBe(1);
  });

  it("el administrador lista los usuarios sin exponer contraseñas, activos primero", async () => {
    const admin = await iniciarSesionDePrueba(app, { usuario: "admin", nombre: "Zoe Admin", rol: "ADMIN" });
    await crearUsuario({ usuario: "beto", nombre: "Beto Inactivo", activo: false });
    const bloqueado = await crearUsuario({ usuario: "carla", nombre: "Carla" });
    await db.usuario.update({ where: { id: bloqueado.id }, data: { bloqueadoHasta: minutos(5) } });

    const res = await admin.get("/api/usuarios");
    expect(res.status).toBe(200);
    expect(res.body.datos.map((u: { usuario: string }) => u.usuario)).toEqual(["carla", "admin", "beto"]);
    expect(res.body.datos[0]).toMatchObject({ bloqueado: true, activo: true, rol: "TECNICO" });
    expect(res.body.datos[1]).toMatchObject({ bloqueado: false });
    expect(JSON.stringify(res.body)).not.toMatch(/contrasenaHash|intentosFallidos/);
  });

  it("crea un usuario normalizando el nombre de usuario, y este ya puede entrar", async () => {
    const admin = await iniciarSesionDePrueba(app, { usuario: "admin", rol: "ADMIN" });
    const res = await admin.post("/api/usuarios").send(nuevo);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ usuario: "ana.lopez", nombre: "Ana López", rol: "TECNICO", activo: true, bloqueado: false, ultimoAcceso: null });
    expect(res.body.contrasenaHash).toBeUndefined();
    const guardado = await db.usuario.findUniqueOrThrow({ where: { usuario: "ana.lopez" } });
    expect(guardado.contrasenaHash).toMatch(/^\$2[aby]\$10\$/);
    expect(guardado.contrasenaHash).not.toContain("Bienvenida");
    expect((await entrar("ana.lopez", "Bienvenida-2026")).status).toBe(200);
  });

  it("no permite repetir el usuario aunque se escriba en mayúsculas", async () => {
    const admin = await iniciarSesionDePrueba(app, { usuario: "admin", rol: "ADMIN" });
    await admin.post("/api/usuarios").send(nuevo).expect(201);
    const res = await admin.post("/api/usuarios").send({ ...nuevo, usuario: "ANA.LOPEZ" });
    expect(res.status).toBe(409);
    expect(res.body.error.campos.usuario).toMatch(/Ya existe el usuario «ana.lopez»/);
  });

  it("valida los datos del usuario nuevo", async () => {
    const admin = await iniciarSesionDePrueba(app, { usuario: "admin", rol: "ADMIN" });
    const res = await admin.post("/api/usuarios").send({ usuario: "josé pérez", nombre: " ", rol: "JEFE", contrasena: "1234" });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.campos).sort()).toEqual(["contrasena", "nombre", "rol", "usuario"]);
    expect(res.body.error.campos.usuario).toMatch(/sin acentos/);

    // No se puede mandar el hash ni otros campos internos.
    const extra = await admin.post("/api/usuarios").send({ ...nuevo, contrasenaHash: "x", activo: false });
    expect(extra.status).toBe(400);
    expect(Object.keys(extra.body.error.campos).sort()).toEqual(["activo", "contrasenaHash"]);
  });

  it("edita nombre y rol; el cambio de rol aplica de inmediato, sin volver a entrar", async () => {
    const admin = await iniciarSesionDePrueba(app, { usuario: "admin", rol: "ADMIN" });
    const tecnico = await iniciarSesionDePrueba(app, { usuario: "ana" });
    const ana = await db.usuario.findUniqueOrThrow({ where: { usuario: "ana" } });
    expect((await tecnico.get("/api/usuarios")).status).toBe(403);

    const res = await admin.patch(`/api/usuarios/${ana.id}`).send({ nombre: "Ana López", rol: "ADMIN" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ nombre: "Ana López", rol: "ADMIN" });
    expect((await tecnico.get("/api/usuarios")).status).toBe(200);
    expect((await tecnico.get("/api/auth/sesion")).body.usuario.rol).toBe("ADMIN");
  });

  it("al desactivar a un usuario se le cierran las sesiones; al reactivarlo puede volver a entrar", async () => {
    const admin = await iniciarSesionDePrueba(app, { usuario: "admin", rol: "ADMIN" });
    const tecnico = await iniciarSesionDePrueba(app, { usuario: "ana" });
    const ana = await db.usuario.findUniqueOrThrow({ where: { usuario: "ana" } });

    await admin.patch(`/api/usuarios/${ana.id}`).send({ activo: false }).expect(200);
    expect(await db.sesion.count({ where: { usuarioId: ana.id } })).toBe(0);
    expect((await tecnico.get("/api/equipos")).status).toBe(401);
    expect((await entrar("ana")).status).toBe(403);

    await admin.patch(`/api/usuarios/${ana.id}`).send({ activo: true }).expect(200);
    expect((await entrar("ana")).status).toBe(200);
  });

  it("un administrador no puede desactivarse ni quitarse el rol a sí mismo (siempre queda uno)", async () => {
    const admin = await iniciarSesionDePrueba(app, { usuario: "admin", rol: "ADMIN" });
    const yo = await db.usuario.findUniqueOrThrow({ where: { usuario: "admin" } });
    for (const cambio of [{ activo: false }, { rol: "TECNICO" }]) {
      const res = await admin.patch(`/api/usuarios/${yo.id}`).send(cambio);
      expect(res.status).toBe(409);
      expect(res.body.error.codigo).toBe("ACCION_SOBRE_SI_MISMO");
    }
    // Sí puede corregir su nombre, y mandar su mismo rol no es un cambio.
    expect((await admin.patch(`/api/usuarios/${yo.id}`).send({ nombre: "Admin Principal", rol: "ADMIN", activo: true })).status).toBe(200);
    expect((await admin.get("/api/auth/sesion")).body.usuario.nombre).toBe("Admin Principal");
  });

  it("al editar: cuerpo vacío, id inválido o inexistente dan errores claros", async () => {
    const admin = await iniciarSesionDePrueba(app, { usuario: "admin", rol: "ADMIN" });
    expect((await admin.patch("/api/usuarios/1").send({})).body.error.campos._).toBe("No hay cambios que guardar.");
    expect((await admin.patch("/api/usuarios/abc").send({ nombre: "X" })).status).toBe(400);
    expect((await admin.patch("/api/usuarios/999999").send({ nombre: "X" })).status).toBe(404);
    expect((await admin.patch("/api/usuarios/1").send({ activo: "no" })).status).toBe(400);
  });

  it("restablece la contraseña de otro: le quita el bloqueo y le cierra las sesiones", async () => {
    const admin = await iniciarSesionDePrueba(app, { usuario: "admin", rol: "ADMIN" });
    const tecnico = await iniciarSesionDePrueba(app, { usuario: "ana" });
    for (let i = 0; i < 5; i++) await entrar("ana", "mala");
    const ana = await db.usuario.findUniqueOrThrow({ where: { usuario: "ana" } });
    expect(ana.bloqueadoHasta).not.toBeNull();

    const res = await admin.post(`/api/usuarios/${ana.id}/restablecer-contrasena`).send({ contrasena: "Temporal-2026" });
    expect(res.status).toBe(200);
    expect(res.body.bloqueado).toBe(false);
    expect((await tecnico.get("/api/equipos")).status).toBe(401);
    expect((await entrar("ana")).status).toBe(401);
    expect((await entrar("ana", "Temporal-2026")).status).toBe(200);
  });

  it("no restablece la propia (para eso está 'Cambiar mi contraseña') y valida la nueva", async () => {
    const admin = await iniciarSesionDePrueba(app, { usuario: "admin", rol: "ADMIN" });
    const yo = await db.usuario.findUniqueOrThrow({ where: { usuario: "admin" } });
    const propia = await admin.post(`/api/usuarios/${yo.id}/restablecer-contrasena`).send({ contrasena: "Temporal-2026" });
    expect(propia.status).toBe(409);
    const otro = await crearUsuario({ usuario: "ana" });
    expect((await admin.post(`/api/usuarios/${otro.id}/restablecer-contrasena`).send({ contrasena: "corta" })).status).toBe(400);
    expect((await admin.post("/api/usuarios/999999/restablecer-contrasena").send({ contrasena: "Temporal-2026" })).status).toBe(404);
  });
});
