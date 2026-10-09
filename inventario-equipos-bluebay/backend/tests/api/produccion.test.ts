import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { crearApp } from "../../src/app.ts";
import { configuracionConCertificado } from "../../src/lib/clientePrisma.ts";
import { CONTRASENA_PRUEBA, crearUsuario, db, limpiarUsuarios } from "../helpers/contexto.ts";

// Pantallas compiladas de mentira, como las que deja "npm run build" en frontend/dist.
let carpetaFrontend: string;
beforeAll(() => {
  carpetaFrontend = mkdtempSync(path.join(tmpdir(), "frontend-dist-"));
  mkdirSync(path.join(carpetaFrontend, "assets"));
  writeFileSync(path.join(carpetaFrontend, "index.html"), "<!doctype html><div id=app></div>");
  writeFileSync(path.join(carpetaFrontend, "assets", "app-123.js"), "console.log('hola')");
});
afterAll(async () => {
  rmSync(carpetaFrontend, { recursive: true, force: true });
  await db.$disconnect();
});
beforeEach(limpiarUsuarios);

const entrar = (app: ReturnType<typeof crearApp>, contrasena = CONTRASENA_PRUEBA, ip?: string) => {
  const peticion = request(app).post("/api/auth/iniciar-sesion");
  if (ip) peticion.set("X-Forwarded-For", ip);
  return peticion.send({ usuario: "jpolanco", contrasena });
};

// =============================================================================
describe("Límite de intentos por IP", () => {
  it("tras el límite responde 429 en el formato de la API, aunque se pruebe con otros usuarios", async () => {
    const app = crearApp({ db, intentosPorIp: 3 });
    await crearUsuario({ usuario: "jpolanco" });
    for (let i = 0; i < 3; i++) expect((await entrar(app, "mala")).status).toBe(401);
    const res = await request(app).post("/api/auth/iniciar-sesion").send({ usuario: "otro-usuario", contrasena: "x" });
    expect(res.status).toBe(429);
    expect(res.body.error).toEqual({ codigo: "DEMASIADAS_PETICIONES", mensaje: "Demasiados intentos desde esta computadora. Espera 15 minutos e inténtalo de nuevo." });
    // Ni siquiera con la contraseña correcta.
    expect((await entrar(app)).status).toBe(429);
  });

  it("solo cuenta los inicios de sesión, no el resto de la API", async () => {
    const app = crearApp({ db, intentosPorIp: 1 });
    await crearUsuario({ usuario: "jpolanco" });
    const sesion = request.agent(app);
    await sesion.post("/api/auth/iniciar-sesion").send({ usuario: "jpolanco", contrasena: CONTRASENA_PRUEBA }).expect(200);
    for (let i = 0; i < 5; i++) expect((await sesion.get("/api/equipos")).status).toBe(200);
  });

  it("en producción cuenta por la IP real del visitante que manda el proxy", async () => {
    const app = crearApp({ db, intentosPorIp: 2, produccion: true });
    await crearUsuario({ usuario: "jpolanco" });
    await entrar(app, "mala", "200.1.1.1");
    await entrar(app, "mala", "200.1.1.1");
    expect((await entrar(app, "mala", "200.1.1.1")).status).toBe(429);
    // Otra persona, desde otra IP, no queda bloqueada por la primera.
    expect((await entrar(app, CONTRASENA_PRUEBA, "189.2.2.2")).status).toBe(200);
  });
});

// =============================================================================
describe("Modo producción", () => {
  it("la cookie solo viaja por HTTPS (Secure) y sigue siendo HttpOnly", async () => {
    await crearUsuario({ usuario: "jpolanco" });
    const res = await entrar(crearApp({ db, produccion: true, intentosPorIp: 100 })).set("X-Forwarded-Proto", "https");
    expect(res.status).toBe(200);
    const cookie = ([] as string[]).concat(res.headers["set-cookie"] ?? [])[0]!;
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/HttpOnly/);
  });

  it("en la computadora (sin HTTPS) la cookie no lleva Secure, para que el login funcione en localhost", async () => {
    await crearUsuario({ usuario: "jpolanco" });
    const res = await entrar(crearApp({ db, intentosPorIp: 100 }));
    expect(([] as string[]).concat(res.headers["set-cookie"] ?? [])[0]).not.toMatch(/Secure/);
  });

  it("manda encabezados de seguridad (helmet)", async () => {
    const res = await request(crearApp({ db })).get("/api/salud");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toMatch(/default-src 'self'/);
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("Reportes PDF", () => {
  it("no llevan CSP (para que el visor de PDF del navegador no quede en blanco), pero sí el resto de encabezados", async () => {
    const app = crearApp({ db, intentosPorIp: 100 });
    await crearUsuario({ usuario: "jpolanco" });
    const equipo = await db.equipo.create({ data: { numeroSerie: "PDF-CSP-1", tipo: "LAPTOP", marca: "Dell", modelo: "Latitude" } });
    const sesion = request.agent(app);
    await sesion.post("/api/auth/iniciar-sesion").send({ usuario: "jpolanco", contrasena: CONTRASENA_PRUEBA }).expect(200);
    const res = await sesion.get(`/api/reportes/alta?ids=${equipo.id}`);
    await db.equipo.delete({ where: { id: equipo.id } });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-security-policy"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

// =============================================================================
describe("Pantallas servidas por la API", () => {
  it("entrega index.html en la raíz y en cualquier ruta de Vue (/inventario/7, /usuarios…)", async () => {
    const app = crearApp({ db, carpetaFrontend });
    for (const ruta of ["/", "/inventario/7", "/usuarios", "/iniciar-sesion?redirigir=/bajas"]) {
      const res = await request(app).get(ruta);
      expect(res.status, ruta).toBe(200);
      expect(res.text, ruta).toContain("<div id=app>");
      expect(res.headers["cache-control"], ruta).toBe("no-cache");
    }
  });

  it("entrega los archivos compilados tal cual", async () => {
    const res = await request(crearApp({ db, carpetaFrontend })).get("/assets/app-123.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.text).toContain("hola");
  });

  it("una ruta de la API que no existe sigue respondiendo JSON, no la página", async () => {
    const res = await request(crearApp({ db, carpetaFrontend })).get("/api/no-existe");
    expect(res.status).toBe(401); // sin sesión, primero se pide iniciar sesión
    expect(res.body.error.codigo).toBe("NO_AUTENTICADO");
    expect((await request(crearApp({ db, carpetaFrontend })).get("/api/salud")).body).toEqual({ estado: "ok" });
  });

  it("no deja salir de la carpeta con ../", async () => {
    const res = await request(crearApp({ db, carpetaFrontend })).get("/assets/..%2f..%2fpackage.json");
    expect(res.text).not.toContain("inventario-equipos-bluebay-backend");
  });

  it("si la carpeta no existe (como en desarrollo con Vite) no sirve nada fuera de /api", async () => {
    const res = await request(crearApp({ db, carpetaFrontend: path.join(carpetaFrontend, "no-existe") })).get("/inventario");
    expect(res.status).toBe(404);
  });
});

// =============================================================================
describe("Conexión cifrada a la base en la nube", () => {
  it("arma la configuración desde la URL, con usuario y contraseña con caracteres especiales", () => {
    const config = configuracionConCertificado(
      "mysql://avnadmin:cl%40ve%3Asecreta@mysql-demo.aivencloud.com:12345/defaultdb?ssl-mode=REQUIRED",
      "-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----",
    );
    expect(config).toMatchObject({
      host: "mysql-demo.aivencloud.com", port: 12345, user: "avnadmin", password: "cl@ve:secreta", database: "defaultdb",
      ssl: { rejectUnauthorized: true, ca: "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----" },
    });
  });

  it("usa el puerto 3306 si la URL no trae uno", () => {
    expect(configuracionConCertificado("mysql://u:p@servidor/base", "x").port).toBe(3306);
  });
});
