/**
 * Crea un usuario ADMINISTRADOR desde la consola:   npm run usuario:admin
 *
 * Sirve para dar de alta al primer administrador y también para recuperar el
 * acceso: si el usuario ya existe, le pone la contraseña nueva, lo activa, le
 * quita el bloqueo y lo deja como administrador.
 */
import { createInterface } from "node:readline";
import { prisma } from "../src/lib/prisma.ts";
import { validar } from "../src/lib/validacion.ts";
import { ErrorHttp } from "../src/lib/errores.ts";
import { cifrarContrasena, esquemaContrasenaNueva, esquemaNombreUsuario } from "../src/modulos/autenticacion/autenticacion.modulo.ts";

const consola = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let ocultar = false;
// Mientras se escribe la contraseña, la consola muestra * en lugar de las letras.
const escribirOriginal = (consola as unknown as { _writeToOutput: (texto: string) => void })._writeToOutput.bind(consola);
(consola as unknown as { _writeToOutput: (texto: string) => void })._writeToOutput = (texto: string) => {
  if (!ocultar || texto.includes("\n") || texto.includes("\r")) return escribirOriginal(texto);
  escribirOriginal("*".repeat(texto.length));
};

function preguntar(pregunta: string, oculta = false): Promise<string> {
  return new Promise((resolver) => {
    consola.question(pregunta, (respuesta) => {
      ocultar = false;
      resolver(respuesta);
    });
    ocultar = oculta;
  });
}

/** Repite la pregunta hasta que la respuesta sea válida. */
async function pedirValido<T>(pregunta: string, revisar: (texto: string) => T, oculta = false): Promise<T> {
  for (;;) {
    const texto = await preguntar(pregunta, oculta);
    try {
      return revisar(texto);
    } catch (error) {
      if (!(error instanceof ErrorHttp)) throw error;
      console.log(`  ✗ ${Object.values(error.campos ?? {})[0] ?? error.message}`);
    }
  }
}

try {
  console.log("\nCrear o recuperar un usuario ADMINISTRADOR del inventario\n");
  const usuario = await pedirValido("Usuario (p. ej. jpolanco): ", (t) => validar(esquemaNombreUsuario, t));
  const existente = await prisma.usuario.findUnique({ where: { usuario } });
  if (existente) console.log(`  El usuario «${usuario}» ya existe (${existente.nombre}); se le pondrá una contraseña nueva.`);

  const nombre = existente?.nombre ?? (await pedirValido("Nombre completo: ", (t) => {
    const limpio = t.trim();
    if (limpio === "" || limpio.length > 100) throw new ErrorHttp(400, "DATOS_INVALIDOS", "Escribe el nombre completo (máximo 100 caracteres).");
    return limpio;
  }));

  let contrasena = "";
  for (;;) {
    contrasena = await pedirValido("Contraseña (mínimo 8 caracteres): ", (t) => validar(esquemaContrasenaNueva, t), true);
    if ((await preguntar("Repite la contraseña: ", true)) === contrasena) break;
    console.log("  ✗ Las contraseñas no coinciden; inténtalo de nuevo.");
  }

  const datos = { nombre, rol: "ADMIN" as const, activo: true, intentosFallidos: 0, bloqueadoHasta: null, contrasenaHash: await cifrarContrasena(contrasena) };
  await prisma.$transaction([
    prisma.usuario.upsert({ where: { usuario }, create: { usuario, ...datos }, update: datos }),
    // Si se recupera el acceso, se cierran las sesiones que hubiera abiertas.
    prisma.sesion.deleteMany({ where: { usuario: { usuario } } }),
  ]);
  console.log(`\n  ✓ Listo: «${usuario}» ya puede entrar como administrador.\n`);
} finally {
  consola.close();
  await prisma.$disconnect();
}
