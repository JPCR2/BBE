import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MenuUsuario from "../src/componentes/MenuUsuario.vue";
import { avisos } from "../src/composables/useAvisos";
import { establecerUsuario, sesion } from "../src/composables/useSesion";
import { errorContrasenaNueva, errorNombreUsuario, sugerirUsuario } from "../src/utilidades/contrasena";
import UsuariosVista from "../src/vistas/UsuariosVista.vue";
import { adminDemo, crearRouterDePrueba, errorApi, simularApi } from "./ayudantes";

const usuarioDemo = (id: number, usuario: string, nombre: string, cambios: Record<string, unknown> = {}) => ({
  id, usuario, nombre, rol: "TECNICO", activo: true, bloqueado: false, bloqueadoHasta: null,
  ultimoAcceso: "2026-10-02T15:30:00.000Z", creadoEn: "2026-09-01T12:00:00.000Z", ...cambios,
});

const listado = () => ({
  datos: [
    usuarioDemo(1, "jpolanco", "Joel Polanco Cruz", { rol: "ADMIN" }),
    usuarioDemo(2, "alopez", "Ana López", { bloqueado: true, bloqueadoHasta: "2026-10-02T16:00:00.000Z" }),
    usuarioDemo(3, "bruiz", "Beto Ruiz", { activo: false, ultimoAcceso: null }),
  ],
});

let envoltura: VueWrapper | undefined;
beforeEach(() => {
  establecerUsuario(adminDemo);
  avisos.splice(0);
});
afterEach(() => {
  envoltura?.unmount();
  envoltura = undefined;
  vi.unstubAllGlobals();
});

async function montarVista(responder: Parameters<typeof simularApi>[0]) {
  const llamadas = simularApi(responder);
  const router = crearRouterDePrueba();
  router.push("/usuarios");
  await router.isReady();
  envoltura = mount(UsuariosVista, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return { envoltura, llamadas };
}

const fila = (texto: string) => envoltura!.findAll("tbody tr").find((f) => f.text().includes(texto))!;
const cuerpoDe = (llamada: { init?: RequestInit }) => JSON.parse(llamada.init!.body as string);

// =============================================================================
describe("Reglas de contraseña y usuario (mismas que la API)", () => {
  it("valida la contraseña nueva", () => {
    expect(errorContrasenaNueva("")).toBe("Escribe la contraseña.");
    expect(errorContrasenaNueva("1234567")).toMatch(/al menos 8/);
    expect(errorContrasenaNueva("        ")).toMatch(/solo espacios/);
    expect(errorContrasenaNueva("ñ".repeat(37))).toMatch(/demasiado larga/);
    expect(errorContrasenaNueva("ñ".repeat(36))).toBeUndefined();
    expect(errorContrasenaNueva("una frase larga")).toBeUndefined();
  });

  it("valida el nombre de usuario", () => {
    expect(errorNombreUsuario("")).toMatch(/Escribe/);
    for (const malo of ["ab", "josé", "j polanco", "j@polanco", "x".repeat(41)]) expect(errorNombreUsuario(malo), malo).toMatch(/sin acentos/);
    for (const bueno of ["jpolanco", "j.polanco", "joel_p-2"]) expect(errorNombreUsuario(bueno), bueno).toBeUndefined();
  });

  it("sugiere el usuario a partir del nombre (inicial + primer apellido, sin acentos)", () => {
    expect(sugerirUsuario("José Pérez Cruz")).toBe("jperez");
    expect(sugerirUsuario("  ÑUÑO  ")).toBe("nuno");
    expect(sugerirUsuario("María de la Luz")).toBe("mde");
    expect(sugerirUsuario("123")).toBe("");
  });
});

// =============================================================================
describe("Pantalla de usuarios", () => {
  it("lista los usuarios con su rol, estado y último acceso", async () => {
    await montarVista(() => ({ cuerpo: listado() }));
    expect(envoltura!.findAll("tbody tr")).toHaveLength(3);
    expect(fila("Joel").text()).toContain("Administrador");
    expect(fila("Joel").text()).toContain("02/10/2026, 10:30"); // 15:30 UTC = 10:30 en Playa del Carmen
    expect(fila("Ana").find(".insignia-peligro").text()).toBe("Bloqueado");
    expect(fila("Beto").text()).toContain("Inactivo");
    expect(fila("Beto").text()).toContain("Nunca ha entrado");
    expect(envoltura!.find(".pie-tabla").text()).toBe("2 usuarios activos de 3");
  });

  it("marca la fila propia con 'Tú' y no ofrece desactivarse ni restablecerse a uno mismo", async () => {
    await montarVista(() => ({ cuerpo: listado() }));
    const propia = fila("Joel");
    expect(propia.text()).toContain("Tú");
    expect(propia.findAll("button").map((b) => b.text())).toEqual(["Editar"]);
    expect(fila("Ana").findAll("button").map((b) => b.text())).toEqual(["Editar", "Desbloquear", "Desactivar"]);
    expect(fila("Beto").findAll("button").map((b) => b.text())).toEqual(["Editar", "Contraseña", "Reactivar"]);
  });

  it("si la lista no carga, muestra el error y deja reintentar", async () => {
    let fallar = true;
    await montarVista(() => (fallar ? errorApi(500, "ERROR_INTERNO", "Ocurrió un error inesperado en el servidor.") : { cuerpo: listado() }));
    expect(envoltura!.find("[role=alert]").text()).toContain("Ocurrió un error inesperado");
    fallar = false;
    await envoltura!.find("[role=alert] button").trigger("click");
    await flushPromises();
    expect(envoltura!.findAll("tbody tr")).toHaveLength(3);
  });

  it("desactiva a un usuario tras confirmar", async () => {
    const { llamadas } = await montarVista((url, init) =>
      init?.method === "PATCH" ? { cuerpo: usuarioDemo(2, "alopez", "Ana López", { activo: false }) } : { cuerpo: listado() },
    );
    await fila("Ana").findAll("button").at(-1)!.trigger("click");
    const dialogo = envoltura!.find("dialog");
    expect(dialogo.text()).toContain("ya no podrá entrar al sistema y se cerrarán sus sesiones abiertas");
    await dialogo.find("form").trigger("submit");
    await flushPromises();
    const patch = llamadas.find((l) => l.init?.method === "PATCH")!;
    expect(patch.url).toBe("/api/usuarios/2");
    expect(cuerpoDe(patch)).toEqual({ activo: false });
    expect(fila("Ana").text()).toContain("Inactivo");
    expect(avisos.map((a) => a.texto)).toContain("«alopez» ya no puede entrar al sistema.");
  });
});

// =============================================================================
describe("Nuevo usuario", () => {
  async function abrirAlta(responder: Parameters<typeof simularApi>[0]) {
    const montado = await montarVista(responder);
    await envoltura!.find(".encabezado-pagina button").trigger("click");
    return montado;
  }

  it("sugiere el usuario mientras se escribe el nombre, hasta que se cambia a mano", async () => {
    await abrirAlta(() => ({ cuerpo: listado() }));
    await envoltura!.find("#nombre-usuario").setValue("José Pérez");
    expect((envoltura!.find("#usuario-usuario").element as HTMLInputElement).value).toBe("jperez");
    await envoltura!.find("#usuario-usuario").setValue("pepe");
    await envoltura!.find("#nombre-usuario").setValue("José Pérez Cruz");
    expect((envoltura!.find("#usuario-usuario").element as HTMLInputElement).value).toBe("pepe");
  });

  it("valida antes de enviar y no llama a la API si hay errores", async () => {
    const { llamadas } = await abrirAlta(() => ({ cuerpo: listado() }));
    await envoltura!.find("#usuario-usuario").setValue("José");
    await envoltura!.find("#contrasena-usuario").setValue("corta");
    await envoltura!.find("dialog form").trigger("submit");
    await flushPromises();
    const texto = envoltura!.find("dialog").text();
    expect(texto).toContain("Escribe el nombre completo.");
    expect(texto).toContain("sin acentos");
    expect(texto).toContain("al menos 8");
    expect(llamadas.filter((l) => l.init?.method === "POST")).toHaveLength(0);
    expect(document.activeElement?.id).toBe("nombre-usuario");
  });

  it("crea el usuario como técnico por defecto y lo agrega a la tabla", async () => {
    const { llamadas } = await abrirAlta((url, init) =>
      init?.method === "POST" ? { estado: 201, cuerpo: usuarioDemo(9, "jperez", "José Pérez", { ultimoAcceso: null }) } : { cuerpo: listado() },
    );
    await envoltura!.find("#nombre-usuario").setValue("  José Pérez ");
    await envoltura!.find("#contrasena-usuario").setValue("Bienvenido-2026");
    await envoltura!.find("dialog form").trigger("submit");
    await flushPromises();
    const post = llamadas.find((l) => l.init?.method === "POST")!;
    expect(post.url).toBe("/api/usuarios");
    expect(cuerpoDe(post)).toEqual({ nombre: "José Pérez", usuario: "jperez", rol: "TECNICO", contrasena: "Bienvenido-2026" });
    expect(envoltura!.find("dialog").exists()).toBe(false);
    // Queda en orden alfabético entre los activos (Ana, Joel, José), no al final.
    expect(envoltura!.findAll("tbody tr").map((f) => f.findAll(".persona > span")[1]!.text())).toEqual(["Ana López", "Joel Polanco Cruz", "José Pérez", "Beto Ruiz"]);
    expect(avisos.map((a) => a.texto)).toContain("Usuario «jperez» creado. Ya puede iniciar sesión.");
  });

  it("si el usuario ya existe, muestra el error de la API junto al campo", async () => {
    await abrirAlta((url, init) =>
      init?.method === "POST" ? errorApi(409, "DUPLICADO", "Ya existe el usuario «alopez».", { usuario: "Ya existe el usuario «alopez»." }) : { cuerpo: listado() },
    );
    await envoltura!.find("#nombre-usuario").setValue("Ana López");
    await envoltura!.find("#contrasena-usuario").setValue("Bienvenida-2026");
    await envoltura!.find("dialog form").trigger("submit");
    await flushPromises();
    expect(envoltura!.find("#error-usuario-usuario").text()).toBe("Ya existe el usuario «alopez».");
    expect(document.activeElement?.id).toBe("usuario-usuario");
  });
});

// =============================================================================
describe("Editar y restablecer", () => {
  it("al editarse a sí mismo no puede cambiar su rol, y el nombre nuevo se ve en el encabezado", async () => {
    const { llamadas } = await montarVista((url, init) =>
      init?.method === "PATCH" ? { cuerpo: usuarioDemo(1, "jpolanco", "Joel Polanco", { rol: "ADMIN" }) } : { cuerpo: listado() },
    );
    await fila("Joel").find("button").trigger("click");
    expect(envoltura!.find("fieldset").attributes("disabled")).toBeDefined();
    expect(envoltura!.find("#usuario-usuario").attributes("readonly")).toBeDefined();
    await envoltura!.find("#nombre-usuario").setValue("Joel Polanco");
    await envoltura!.find("dialog form").trigger("submit");
    await flushPromises();
    expect(cuerpoDe(llamadas.find((l) => l.init?.method === "PATCH")!)).toEqual({ nombre: "Joel Polanco" });
    expect(sesion.usuario?.nombre).toBe("Joel Polanco");
  });

  it("si no se cambió nada, cierra sin llamar a la API", async () => {
    const { llamadas } = await montarVista(() => ({ cuerpo: listado() }));
    await fila("Ana").find("button").trigger("click");
    await envoltura!.find("dialog form").trigger("submit");
    await flushPromises();
    expect(llamadas.filter((l) => l.init?.method === "PATCH")).toHaveLength(0);
    expect(envoltura!.find("dialog").exists()).toBe(false);
  });

  it("restablece la contraseña de un usuario bloqueado y lo muestra desbloqueado", async () => {
    const { llamadas } = await montarVista((url, init) =>
      init?.method === "POST" ? { cuerpo: usuarioDemo(2, "alopez", "Ana López") } : { cuerpo: listado() },
    );
    await fila("Ana").findAll("button")[1]!.trigger("click");
    expect(envoltura!.find("dialog").text()).toContain("Se le quitará el bloqueo");
    await envoltura!.find("#contrasena-restablecer").setValue("corta");
    await envoltura!.find("dialog form").trigger("submit");
    await flushPromises();
    expect(envoltura!.find("#contrasena-restablecer-error").text()).toMatch(/al menos 8/);
    expect(llamadas.filter((l) => l.init?.method === "POST")).toHaveLength(0);

    await envoltura!.find("#contrasena-restablecer").setValue("Temporal-2026");
    await envoltura!.find("dialog form").trigger("submit");
    await flushPromises();
    const post = llamadas.find((l) => l.init?.method === "POST")!;
    expect(post.url).toBe("/api/usuarios/2/restablecer-contrasena");
    expect(cuerpoDe(post)).toEqual({ contrasena: "Temporal-2026" });
    expect(fila("Ana").find(".insignia").text()).toBe("Activo");
  });
});

// =============================================================================
describe("Menú del usuario", () => {
  async function montarMenu(responder: Parameters<typeof simularApi>[0] = () => ({ estado: 204, cuerpo: null })) {
    const llamadas = simularApi(responder);
    const router = crearRouterDePrueba();
    router.push("/inventario");
    await router.isReady();
    envoltura = mount(MenuUsuario, { global: { plugins: [router] }, attachTo: document.body });
    await envoltura.find("button[aria-haspopup=menu]").trigger("click");
    return { router, llamadas };
  }

  it("muestra nombre, rol y usuario", async () => {
    await montarMenu();
    expect(envoltura!.text()).toContain("Joel Polanco Cruz");
    expect(envoltura!.text()).toContain("Administrador");
    expect(envoltura!.find(".cuenta").text()).toBe("Usuario: jpolanco");
  });

  it("cerrar sesión avisa a la API, limpia la sesión y lleva a la pantalla de inicio de sesión", async () => {
    const { router, llamadas } = await montarMenu();
    await envoltura!.findAll("[role=menuitem]")[1]!.trigger("click");
    await flushPromises();
    expect(llamadas[0]!.url).toBe("/api/auth/cerrar-sesion");
    expect(sesion.usuario).toBeNull();
    expect(router.currentRoute.value.name).toBe("iniciar-sesion");
    expect(avisos.map((a) => a.texto)).toContain("Cerraste sesión.");
  });

  it("si no hay conexión al cerrar sesión, lo dice y NO aparenta haber salido", async () => {
    const { router } = await montarMenu();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await envoltura!.findAll("[role=menuitem]")[1]!.trigger("click");
    await flushPromises();
    expect(sesion.usuario).toEqual(adminDemo);
    expect(router.currentRoute.value.name).toBe("inventario");
    expect(avisos[0]).toMatchObject({ tipo: "error" });
    expect(avisos[0]!.texto).toMatch(/No se pudo cerrar la sesión/);
  });

  it("Esc cierra el menú y regresa el foco al botón", async () => {
    await montarMenu();
    expect(envoltura!.find("[role=menu]").isVisible()).toBe(true);
    await envoltura!.find(".menu-usuario").trigger("keydown", { key: "Escape" });
    expect(envoltura!.find("[role=menu]").isVisible()).toBe(false);
    expect(document.activeElement).toBe(envoltura!.find("button[aria-haspopup=menu]").element);
  });

  describe("Cambiar mi contraseña", () => {
    async function abrir(responder?: Parameters<typeof simularApi>[0]) {
      const montado = await montarMenu(responder);
      await envoltura!.findAll("[role=menuitem]")[0]!.trigger("click");
      return montado;
    }
    const llenar = async (actual: string, nueva: string, confirmar: string) => {
      await envoltura!.find("#contrasena-actual").setValue(actual);
      await envoltura!.find("#contrasena-nueva").setValue(nueva);
      await envoltura!.find("#contrasena-confirmar").setValue(confirmar);
      await envoltura!.find("dialog form").trigger("submit");
      await flushPromises();
    };

    it("revisa que la confirmación coincida y que la nueva sea distinta", async () => {
      const { llamadas } = await abrir();
      await llenar("Actual-123", "Nueva-12345", "Nueva-1234");
      expect(envoltura!.find("#contrasena-confirmar-error").text()).toBe("No coincide con la nueva contraseña.");
      await llenar("Actual-123", "Actual-123", "Actual-123");
      expect(envoltura!.find("#contrasena-nueva-error").text()).toMatch(/distinta de la actual/);
      expect(llamadas).toHaveLength(0);
    });

    it("si la contraseña actual es incorrecta lo marca en ese campo", async () => {
      await abrir(() => errorApi(400, "DATOS_INVALIDOS", "Revisa los datos marcados.", { contrasenaActual: "La contraseña actual no es correcta." }));
      await llenar("equivocada", "Nueva-12345", "Nueva-12345");
      expect(envoltura!.find("#contrasena-actual-error").text()).toBe("La contraseña actual no es correcta.");
      expect(document.activeElement?.id).toBe("contrasena-actual");
    });

    it("al cambiarla cierra el diálogo y avisa", async () => {
      const { llamadas } = await abrir();
      await llenar("Actual-123", "Nueva-12345", "Nueva-12345");
      expect(cuerpoDe(llamadas[0]!)).toEqual({ contrasenaActual: "Actual-123", contrasenaNueva: "Nueva-12345" });
      expect(envoltura!.find("dialog").exists()).toBe(false);
      expect(avisos[0]!.texto).toMatch(/^Contraseña cambiada/);
    });
  });
});
