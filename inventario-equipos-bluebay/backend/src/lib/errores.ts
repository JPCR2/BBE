import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "../generated/prisma/client.ts";

/**
 * Error con estado HTTP y un código estable que el frontend puede interpretar.
 * Formato de respuesta: { error: { codigo, mensaje, campos? } }
 */
export class ErrorHttp extends Error {
  constructor(
    public readonly estado: number,
    public readonly codigo: string,
    mensaje: string,
    public readonly campos?: Record<string, string>,
  ) {
    super(mensaje);
    this.name = "ErrorHttp";
  }
}

export function noEncontrado(mensaje: string): ErrorHttp {
  return new ErrorHttp(404, "NO_ENCONTRADO", mensaje);
}

/** Respuesta 404 en JSON para rutas de la API que no existen. */
export const rutaNoEncontrada: RequestHandler = (req, _res, next) => {
  next(new ErrorHttp(404, "RUTA_NO_ENCONTRADA", `No existe la ruta ${req.method} ${req.originalUrl}.`));
};

/** Valores únicos de la base de datos y el mensaje que se muestra si se repiten. */
const DUPLICADOS: Record<string, { campo: string; mensaje: string }> = {
  equipos_numeroSerie_key: { campo: "numeroSerie", mensaje: "Ya existe un equipo con ese número de serie." },
  empleados_numeroEmpleado_key: { campo: "numeroEmpleado", mensaje: "Ya existe un empleado con ese número." },
  usuarios_usuario_key: { campo: "usuario", mensaje: "Ya existe un usuario con ese nombre." },
  departamentos_nombre_key: { campo: "nombre", mensaje: "Ya existe un departamento con ese nombre." },
};

/** Traduce errores de Prisma/MariaDB y de Express a respuestas claras. */
export function traducirError(error: unknown): ErrorHttp {
  if (error instanceof ErrorHttp) return error;

  if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.parse.failed") {
    return new ErrorHttp(400, "JSON_INVALIDO", "El cuerpo de la petición no es un JSON válido.");
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const mensaje = error.message;
    if (error.code === "P2002") {
      const clave = Object.keys(DUPLICADOS).find((k) => mensaje.includes(k));
      const duplicado = clave ? DUPLICADOS[clave]! : { campo: "_", mensaje: "Ya existe un registro con ese valor." };
      return new ErrorHttp(409, "DUPLICADO", duplicado.mensaje, { [duplicado.campo]: duplicado.mensaje });
    }
    if (error.code === "P2003") {
      return new ErrorHttp(409, "EN_USO", "La operación no es posible porque el registro está relacionado con otros datos.");
    }
    if (error.code === "P2025") return noEncontrado("El registro no existe.");
    if (mensaje.includes("[ASIGNACION_VIGENTE]")) {
      return new ErrorHttp(409, "ASIGNACION_VIGENTE", "El equipo ya tiene una asignación vigente; registra la devolución antes de reasignarlo.");
    }
    if (mensaje.includes("[BAJA_PERMANENTE]")) {
      return new ErrorHttp(409, "BAJA_PERMANENTE", "Un acta de baja no se puede borrar.");
    }
    const restriccion = /chk_[a-z_]+/.exec(mensaje);
    if (restriccion) {
      return new ErrorHttp(400, "REGLA_DE_DATOS", `Los datos no cumplen la regla "${restriccion[0]}".`);
    }
  }

  return new ErrorHttp(500, "ERROR_INTERNO", "Ocurrió un error inesperado en el servidor.");
}

/** Último middleware de Express: convierte cualquier error en la respuesta JSON estándar. */
export const manejarErrores: ErrorRequestHandler = (error, _req, res, _next) => {
  const http = traducirError(error);
  if (http.estado >= 500) console.error(error);
  res.status(http.estado).json({
    error: { codigo: http.codigo, mensaje: http.message, ...(http.campos ? { campos: http.campos } : {}) },
  });
};
