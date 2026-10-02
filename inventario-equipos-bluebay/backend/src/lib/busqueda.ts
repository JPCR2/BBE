/**
 * En MariaDB, "%" y "_" son comodines de LIKE y Prisma no los escapa en
 * `contains`: buscar "%" devolvería toda la tabla. Se buscan literalmente.
 */
export function escaparComodines(texto: string): string {
  return texto.replace(/[\\%_]/g, "\\$&");
}

/** Divide lo que escribió la persona en palabras: "dell latitude" → ["dell", "latitude"]. */
export function palabrasDe(busqueda: string | undefined): string[] {
  return (busqueda ?? "").split(/\s+/).filter(Boolean);
}
