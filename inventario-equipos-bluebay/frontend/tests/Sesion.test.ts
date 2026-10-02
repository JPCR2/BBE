import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listarEquipos } from "../src/api/equipos";
import { avisos } from "../src/composables/useAvisos";
import { establecerUsuario, inicialesDe, revisarSesion, sesion } from "../src/composables/useSesion";
import { protegerRuta, router } from "../src/router";
import { adminDemo, errorApi, simularApi, tecnicoDemo } from "./ayudantes";

const errorUsuario = errorApi(401, "NO_AUTENTICADO", "Tu sesión terminó. Vuelve a iniciar sesión.");

/** Simula a dónde se quiere ir. */
const ir = (fullPath: string, meta: Record<string, unknown> = {}, query: Record<string, string> = {}) =>
  protegerRuta({ fullPath, meta, query } as unknown as Parameters<typeof protegerRuta>[0]);

beforeEach(() => {
  sesion.usuario = null;
  sesion.revisada = false;
  avisos.splice(0);
});
afterEach(() => vi.unstubAllGlobals());

describe("Protección de las pantallas", () => {
  it("sin sesión manda a iniciar sesión y recuerda a dónde se quería ir", async () => {
    simularApi(() => errorApi(401, "NO_AUTENTICADO", "Inicia sesión para continuar."));
    expect(await ir("/inventario/7")).toEqual({ name: "iniciar-sesion", query: { redirigir: "/inventario/7" } });
  });

  it("desde el inicio no agrega ?redirigir (la URL queda limpia)", async () => {
    simularApi(() => errorApi(401, "NO_AUTENTICADO", "Inicia sesión para continuar."));
    expect(await ir("/")).toEqual({ name: "iniciar-sesion", query: {} });
  });

  it("pregunta a la API una sola vez por la sesión, no en cada cambio de pantalla", async () => {
    const llamadas = simularApi(() => ({ cuerpo: { usuario: tecnicoDemo } }));
    expect(await ir("/inventario")).toBe(true);
    expect(await ir("/empleados")).toBe(true);
    expect(await ir("/bajas")).toBe(true);
    expect(llamadas.filter((l) => l.url === "/api/auth/sesion")).toHaveLength(1);
  });

  it("con sesión abierta, la pantalla de inicio de sesión lleva directo al sistema", async () => {
    establecerUsuario(adminDemo);
    expect(await ir("/iniciar-sesion", { publica: true })).toBe("/");
    expect(await ir("/iniciar-sesion?redirigir=/bajas", { publica: true }, { redirigir: "/bajas" })).toBe("/bajas");
  });

  it("un técnico no entra a Usuarios: regresa al inicio con un aviso", async () => {
    establecerUsuario(tecnicoDemo);
    expect(await ir("/usuarios", { soloAdmin: true })).toEqual({ name: "inicio" });
    expect(avisos.map((a) => a.texto)).toContain("Esa sección es solo para administradores.");
    establecerUsuario(adminDemo);
    expect(await ir("/usuarios", { soloAdmin: true })).toBe(true);
  });

  it("si la API está apagada muestra la pantalla de inicio de sesión y lo vuelve a intentar después", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await ir("/inventario")).toEqual({ name: "iniciar-sesion", query: { redirigir: "/inventario" } });
    expect(sesion.revisada).toBe(false);
    simularApi(() => ({ cuerpo: { usuario: tecnicoDemo } }));
    expect(await revisarSesion()).toEqual(tecnicoDemo);
  });
});

describe("Sesión perdida a mitad del trabajo", () => {
  it("si la API responde 401, avisa y lleva a iniciar sesión volviendo después a la misma página", async () => {
    establecerUsuario(tecnicoDemo);
    await router.push("/inventario?pagina=2");
    simularApi(() => errorUsuario);
    await expect(listarEquipos({})).rejects.toThrow();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("iniciar-sesion"));
    expect(router.currentRoute.value.query.redirigir).toBe("/inventario?pagina=2");
    expect(sesion.usuario).toBeNull();
    expect(avisos.map((a) => a.texto)).toContain("Tu sesión terminó. Vuelve a iniciar sesión para continuar.");
  });

  it("varias peticiones con 401 a la vez dan un solo aviso", async () => {
    establecerUsuario(tecnicoDemo);
    await router.push("/empleados");
    simularApi(() => errorUsuario);
    await Promise.allSettled([listarEquipos({}), listarEquipos({}), listarEquipos({})]);
    expect(avisos.filter((a) => a.texto.startsWith("Tu sesión terminó"))).toHaveLength(1);
  });

  it("un 401 de 'contraseña incorrecta' en el inicio de sesión no cuenta como sesión perdida", async () => {
    establecerUsuario(tecnicoDemo);
    simularApi(() => errorApi(401, "CREDENCIALES_INVALIDAS", "Usuario o contraseña incorrectos."));
    const { iniciarSesion } = await import("../src/api/autenticacion");
    await expect(iniciarSesion("x", "y")).rejects.toThrow("Usuario o contraseña incorrectos.");
    expect(sesion.usuario).toEqual(tecnicoDemo);
  });
});

describe("Iniciales del usuario", () => {
  it("toma la primera letra de las dos primeras palabras", () => {
    expect(inicialesDe("Joel Polanco Cruz")).toBe("JP");
    expect(inicialesDe("  ana   lópez ")).toBe("AL");
    expect(inicialesDe("Admin")).toBe("A");
    expect(inicialesDe("   ")).toBe("?");
  });
});
