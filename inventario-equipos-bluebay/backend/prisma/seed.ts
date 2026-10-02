import { prisma } from "../src/lib/prisma.ts";
import { sembrarDatosDemo } from "./datos-demo.ts";

try {
  const resultado = await sembrarDatosDemo(prisma);
  if (resultado.omitido) {
    console.log(`Seed omitido: ${resultado.motivo}`);
  } else {
    const { omitido, ...conteo } = resultado;
    console.log("Datos demo insertados:", conteo);
  }
} finally {
  await prisma.$disconnect();
}
