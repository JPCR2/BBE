/** Mismas reglas que la API para una contraseña nueva. */
export const MINIMO_CONTRASENA = 8;

export function errorContrasenaNueva(valor: string): string | undefined {
  if (valor === "") return "Escribe la contraseña.";
  if (valor.length < MINIMO_CONTRASENA) return `Debe tener al menos ${MINIMO_CONTRASENA} caracteres.`;
  if (valor.trim() === "") return "La contraseña no puede ser solo espacios.";
  // bcrypt solo toma en cuenta 72 bytes (una "ñ" o un acento ocupan 2).
  if (new TextEncoder().encode(valor).length > 72) return "Es demasiado larga (máximo 72 caracteres).";
  return undefined;
}

/** Mismas reglas que la API para el nombre de usuario (ya recortado y en minúsculas). */
export function errorNombreUsuario(valor: string): string | undefined {
  if (valor === "") return "Escribe el nombre de usuario.";
  if (!/^[a-z0-9._-]{3,40}$/.test(valor)) return "Usa de 3 a 40 letras sin acentos, números, punto, guion o guion bajo.";
  return undefined;
}

/** Sugerencia de usuario a partir del nombre: "José Pérez Cruz" → "jperez". */
export function sugerirUsuario(nombre: string): string {
  const partes = nombre
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z\s]/g, "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "";
  if (partes.length === 1) return partes[0]!.slice(0, 40);
  return (partes[0]![0] + partes[1]!).slice(0, 40);
}
