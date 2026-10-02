import { inflateSync } from "node:zlib";

// Node decodifica "windows-1252" como Latin-1 y pierde estos caracteres (0x80–0x9F).
const WINDOWS_1252: Record<number, string> = { 0x80: "€", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—" };
const decodificar = (bytes: Buffer) => [...bytes].map((b) => WINDOWS_1252[b] ?? String.fromCharCode(b)).join("");

/**
 * Extrae el texto de un PDF generado con PDFKit: descomprime cada stream y
 * decodifica los textos (que PDFKit escribe en hexadecimal, en Windows-1252).
 * Los fragmentos quedan pegados, así que se busca con toContain.
 */
export function textoDelPdf(pdf: Buffer): string {
  const bruto = pdf.toString("latin1");
  let texto = "";
  for (const coincidencia of bruto.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let contenido: string;
    try {
      contenido = inflateSync(Buffer.from(coincidencia[1]!, "latin1")).toString("latin1");
    } catch {
      continue; // imágenes u otros streams que no son texto
    }
    for (const bloque of contenido.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      for (const hex of bloque[1]!.matchAll(/<([0-9a-fA-F]+)>/g)) {
        texto += decodificar(Buffer.from(hex[1]!, "hex"));
      }
      texto += " ";
    }
  }
  return texto;
}

/** Número de páginas del PDF. */
export function paginasDelPdf(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g)?.length ?? 0;
}
