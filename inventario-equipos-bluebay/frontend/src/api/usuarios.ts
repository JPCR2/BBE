import type { RolUsuario } from "./autenticacion";
import { pedir } from "./cliente";

export interface Usuario {
  id: number;
  usuario: string;
  nombre: string;
  rol: RolUsuario;
  activo: boolean;
  /** true mientras dura el bloqueo por intentos fallidos. */
  bloqueado: boolean;
  bloqueadoHasta: string | null;
  ultimoAcceso: string | null;
  creadoEn: string;
}

export interface DatosUsuarioNuevo { usuario: string; nombre: string; rol: RolUsuario; contrasena: string }
export type CambiosUsuario = Partial<{ nombre: string; rol: RolUsuario; activo: boolean }>;

export function listarUsuarios() {
  return pedir<{ datos: Usuario[] }>("/usuarios");
}

export function crearUsuario(datos: DatosUsuarioNuevo) {
  return pedir<Usuario>("/usuarios", { metodo: "POST", cuerpo: datos });
}

export function editarUsuario(id: number, cambios: CambiosUsuario) {
  return pedir<Usuario>(`/usuarios/${id}`, { metodo: "PATCH", cuerpo: cambios });
}

export function restablecerContrasena(id: number, contrasena: string) {
  return pedir<Usuario>(`/usuarios/${id}/restablecer-contrasena`, { metodo: "POST", cuerpo: { contrasena } });
}
