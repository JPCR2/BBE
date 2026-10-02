import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { avisos } from "../src/composables/useAvisos";
import { destinoSeguro, establecerUsuario, sesion } from "../src/composables/useSesion";
import LoginVista from "../src/vistas/LoginVista.vue";
import { adminDemo, crearRouterDePrueba, errorApi, simularApi } from "./ayudantes";

beforeEach(() => {
  establecerUsuario(null);
  avisos.splice(0);
});
afterEach(() => vi.unstubAllGlobals());

async function montar(ruta = "/iniciar-sesion", responder: Parameters<typeof simularApi>[0] = () => ({ cuerpo: { usuario: adminDemo } })) {
  const llamadas = simularApi(responder);
  const router = crearRouterDePrueba();
  router.push(ruta);
  await router.isReady();
  const envoltura = mount(LoginVista, { global: { plugins: [router] }, attachTo: document.body });
  return { envoltura, router, llamadas };
}

const escribir = async (envoltura: Awaited<ReturnType<typeof montar>>["envoltura"], usuario: string, contrasena: string) => {
  await envoltura.find("#usuario-login").setValue(usuario);
  await envoltura.find("#contrasena-login").setValue(contrasena);
  await envoltura.find("form").trigger("submit");
  await flushPromises();
};

describe("Pantalla de inicio de sesión", () => {
  it("pone el cursor en el usuario al abrir", async () => {
    const { envoltura } = await montar();
    expect(document.activeElement?.id).toBe("usuario-login");
    envoltura.unmount();
  });

  it("si faltan datos lo dice junto a cada campo y no llama a la API", async () => {
    const { envoltura, llamadas } = await montar();
    await escribir(envoltura, "   ", "");
    expect(envoltura.text()).toContain("Escribe tu usuario.");
    expect(envoltura.text()).toContain("Escribe tu contraseña.");
    expect(envoltura.find("#usuario-login").attributes("aria-invalid")).toBe("true");
    expect(llamadas).toHaveLength(0);
    // Al corregir el campo, su error desaparece.
    await envoltura.find("#usuario-login").setValue("jpolanco");
    expect(envoltura.text()).not.toContain("Escribe tu usuario.");
    envoltura.unmount();
  });

  it("con datos correctos guarda la sesión y entra al inicio", async () => {
    const { envoltura, router, llamadas } = await montar();
    await escribir(envoltura, "jpolanco", "Contrasena-1");
    expect(llamadas[0]!.url).toBe("/api/auth/iniciar-sesion");
    expect(JSON.parse(llamadas[0]!.init!.body as string)).toEqual({ usuario: "jpolanco", contrasena: "Contrasena-1" });
    expect(sesion.usuario).toEqual(adminDemo);
    expect(router.currentRoute.value.fullPath).toBe("/");
    envoltura.unmount();
  });

  it("regresa a la página que se quería abrir antes de iniciar sesión", async () => {
    const { envoltura, router } = await montar("/iniciar-sesion?redirigir=%2Finventario%2F7");
    await escribir(envoltura, "jpolanco", "Contrasena-1");
    expect(router.currentRoute.value.fullPath).toBe("/inventario/7");
    envoltura.unmount();
  });

  it("nunca redirige fuera del sistema", () => {
    for (const malo of ["//sitio-falso.com", "/\\sitio-falso.com", "https://sitio-falso.com", "javascript:alert(1)", "/iniciar-sesion", undefined, ["/bajas"]]) {
      expect(destinoSeguro(malo), String(malo)).toBe("/");
    }
    expect(destinoSeguro("/bajas?pagina=2")).toBe("/bajas?pagina=2");
  });

  it("con contraseña incorrecta muestra el mensaje, borra la contraseña y la enfoca", async () => {
    const { envoltura } = await montar("/iniciar-sesion", () => errorApi(401, "CREDENCIALES_INVALIDAS", "Usuario o contraseña incorrectos."));
    await escribir(envoltura, "jpolanco", "mala");
    expect(envoltura.find("[role=alert]").text()).toBe("Usuario o contraseña incorrectos.");
    expect((envoltura.find("#contrasena-login").element as HTMLInputElement).value).toBe("");
    expect(document.activeElement?.id).toBe("contrasena-login");
    // El usuario se conserva para no volver a escribirlo.
    expect((envoltura.find("#usuario-login").element as HTMLInputElement).value).toBe("jpolanco");
    expect(sesion.usuario).toBeNull();
    envoltura.unmount();
  });

  it("muestra el aviso de usuario bloqueado tal como lo manda la API", async () => {
    const mensaje = "Por seguridad, el usuario está bloqueado por demasiados intentos fallidos. Intenta de nuevo en 12 minutos.";
    const { envoltura } = await montar("/iniciar-sesion", () => errorApi(429, "USUARIO_BLOQUEADO", mensaje));
    await escribir(envoltura, "jpolanco", "lo-que-sea");
    expect(envoltura.find("[role=alert]").text()).toBe(mensaje);
    envoltura.unmount();
  });

  it("si la API está apagada lo explica en lugar de quedarse cargando", async () => {
    const { envoltura } = await montar();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await escribir(envoltura, "jpolanco", "Contrasena-1");
    expect(envoltura.find("[role=alert]").text()).toMatch(/No se pudo conectar con el servidor/);
    expect(envoltura.find("button[type=submit]").text()).toBe("Entrar");
    envoltura.unmount();
  });

  it("desactiva el botón mientras espera la respuesta (no se envía dos veces)", async () => {
    let responder!: (r: Response) => void;
    const { envoltura } = await montar();
    const fetchFalso = vi.fn(() => new Promise<Response>((r) => (responder = r)));
    vi.stubGlobal("fetch", fetchFalso);
    await envoltura.find("#usuario-login").setValue("jpolanco");
    await envoltura.find("#contrasena-login").setValue("Contrasena-1");
    await envoltura.find("form").trigger("submit");
    const boton = envoltura.find("button[type=submit]");
    expect(boton.text()).toBe("Entrando…");
    expect(boton.attributes("disabled")).toBeDefined();
    await envoltura.find("form").trigger("submit");
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    responder(new Response(JSON.stringify({ usuario: adminDemo }), { status: 200 }));
    await flushPromises();
    envoltura.unmount();
  });

  it("el botón del ojo muestra y oculta la contraseña", async () => {
    const { envoltura } = await montar();
    const campo = envoltura.find("#contrasena-login");
    const ojo = envoltura.find("button[aria-label='Mostrar contraseña']");
    expect(campo.attributes("type")).toBe("password");
    await ojo.trigger("click");
    expect(campo.attributes("type")).toBe("text");
    expect(ojo.attributes("aria-pressed")).toBe("true");
    expect(ojo.attributes("aria-label")).toBe("Ocultar contraseña");
    envoltura.unmount();
  });

  it("avisa cuando Bloq Mayús está activado", async () => {
    const { envoltura } = await montar();
    const campo = envoltura.find("#contrasena-login");
    const evento = new KeyboardEvent("keyup", { key: "A" });
    Object.defineProperty(evento, "getModifierState", { value: (tecla: string) => tecla === "CapsLock" });
    campo.element.dispatchEvent(evento);
    await flushPromises();
    expect(envoltura.text()).toContain("Bloq Mayús está activado.");
    envoltura.unmount();
  });
});
