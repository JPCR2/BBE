import { computed, reactive } from "vue";
import { obtenerSesion, type UsuarioSesion } from "../api/autenticacion";
import { ErrorApi } from "../api/cliente";

/** Usuario con la sesión abierta. Lo comparten el router, el encabezado y la barra lateral. */
export const sesion = reactive<{ usuario: UsuarioSesion | null; revisada: boolean }>({ usuario: null, revisada: false });

export const esAdmin = computed(() => sesion.usuario?.rol === "ADMIN");

export function establecerUsuario(usuario: UsuarioSesion | null) {
  sesion.usuario = usuario;
  sesion.revisada = true;
}

/**
 * Pregunta a la API si hay sesión abierta (una sola vez al abrir el sistema).
 * Si la API no responde, el error se deja pasar para mostrarlo en pantalla.
 */
export async function revisarSesion(): Promise<UsuarioSesion | null> {
  if (sesion.revisada) return sesion.usuario;
  try {
    establecerUsuario((await obtenerSesion()).usuario);
  } catch (error) {
    if (!(error instanceof ErrorApi && error.estado === 401)) throw error;
    establecerUsuario(null);
  }
  return sesion.usuario;
}

/** Iniciales para el botón del usuario: "Joel Polanco Cruz" → "JP". */
export function inicialesDe(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Solo se regresa a rutas internas ("/inventario"), nunca a otra página web. */
export function destinoSeguro(valor: unknown): string {
  return typeof valor === "string" && valor.startsWith("/") && !/^\/[/\\]/.test(valor) && !valor.startsWith("/iniciar-sesion") ? valor : "/";
}
