import "../src/lib/entorno.ts";
import { recrearBaseDePrueba } from "./helpers/baseDePrueba.ts";

export default async function prepararBaseDePrueba(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Falta TEST_DATABASE_URL en el archivo .env");
  await recrearBaseDePrueba(url);
}
