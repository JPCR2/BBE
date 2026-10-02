import { pedir } from "./cliente";

export type RolUsuario = "ADMIN" | "TECNICO";

export interface UsuarioSesion {
  id: number;
  usuario: string;
  nombre: string;
  rol: RolUsuario;
}

export const ETIQUETAS_ROL: Record<RolUsuario, string> = { ADMIN: "Administrador", TECNICO: "Técnico" };

export function iniciarSesion(usuario: string, contrasena: string) {
  return pedir<{ usuario: UsuarioSesion }>("/auth/iniciar-sesion", { metodo: "POST", cuerpo: { usuario, contrasena } });
}

export function cerrarSesion() {
  return pedir<null>("/auth/cerrar-sesion", { metodo: "POST" });
}

/** Usuario con la sesión abierta; lanza 401 si no hay sesión. */
export function obtenerSesion() {
  return pedir<{ usuario: UsuarioSesion }>("/auth/sesion");
}

export function cambiarContrasena(contrasenaActual: string, contrasenaNueva: string) {
  return pedir<null>("/auth/cambiar-contrasena", { metodo: "POST", cuerpo: { contrasenaActual, contrasenaNueva } });
}
