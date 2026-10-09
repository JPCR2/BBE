import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { Prisma, PrismaClient } from "../generated/prisma/client.ts";

// -----------------------------------------------------------------------------
// Normalización de identificadores
// -----------------------------------------------------------------------------

/**
 * Deja el número de serie en una forma única: sin espacios y en mayúsculas.
 * "  5cd 1234xyz " -> "5CD1234XYZ". Así el mismo equipo no se registra dos
 * veces por una diferencia de captura.
 */
export function normalizarNumeroSerie(valor: string): string {
  return valor.replace(/\s+/g, "").toUpperCase();
}

/** Quita espacios al inicio y al final del número de empleado. */
export function normalizarNumeroEmpleado(valor: string): string {
  return valor.trim();
}

type Normalizador = (valor: string) => string;

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}

/** Normaliza un campo tanto en su forma simple ("X") como en { set: "X" }. */
function normalizarCampo(datos: unknown, campo: string, normalizar: Normalizador): void {
  if (!esObjeto(datos)) return;
  const valor = datos[campo];
  if (typeof valor === "string") {
    datos[campo] = normalizar(valor);
  } else if (esObjeto(valor) && typeof valor.set === "string") {
    valor.set = normalizar(valor.set);
  }
}

/**
 * Aplica la normalización a los datos de escritura (data / create / update)
 * y a la búsqueda exacta por ese campo (where), para que buscar " abc 123 "
 * encuentre el equipo "ABC123".
 */
function normalizarArgumentos(args: unknown, campo: string, normalizar: Normalizador): void {
  if (!esObjeto(args)) return;
  for (const clave of ["data", "create", "update"]) {
    const datos = args[clave];
    if (Array.isArray(datos)) datos.forEach((item) => normalizarCampo(item, campo, normalizar));
    else normalizarCampo(datos, campo, normalizar);
  }
  normalizarCampo(args.where, campo, (valor) => normalizar(valor));
}

const extensionNormalizacion = Prisma.defineExtension({
  name: "normalizacion-identificadores",
  query: {
    equipo: {
      async $allOperations({ args, query }) {
        normalizarArgumentos(args, "numeroSerie", normalizarNumeroSerie);
        return query(args);
      },
    },
    empleado: {
      async $allOperations({ args, query }) {
        normalizarArgumentos(args, "numeroEmpleado", normalizarNumeroEmpleado);
        return query(args);
      },
    },
  },
});

// -----------------------------------------------------------------------------
// Cliente
// -----------------------------------------------------------------------------

/**
 * Convierte "mysql://usuario:clave@host:puerto/base" en la configuración del
 * conector, agregando la conexión cifrada (TLS) con el certificado de la nube.
 */
export function configuracionConCertificado(urlBaseDeDatos: string, certificadoCa: string) {
  const url = new URL(urlBaseDeDatos);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    // Variables de entorno de una sola línea: se aceptan los saltos escritos como "\n".
    ssl: { ca: certificadoCa.replace(/\\n/g, "\n"), rejectUnauthorized: true },
    prepareCacheLength: 0,
  };
}

/** Crea un cliente de Prisma conectado a MariaDB/MySQL mediante el adaptador oficial. */
export function crearClientePrisma(urlBaseDeDatos: string, opciones: { certificadoCa?: string } = {}) {
  const certificadoCa = opciones.certificadoCa?.trim();
  const adaptador = new PrismaMariaDb(certificadoCa ? configuracionConCertificado(urlBaseDeDatos, certificadoCa) : urlBaseDeDatos);
  return new PrismaClient({ adapter: adaptador }).$extends(extensionNormalizacion);
}

export type ClientePrisma = ReturnType<typeof crearClientePrisma>;
