/** Error devuelto por la API, con el formato { error: { codigo, mensaje, campos? } }. */
export class ErrorApi extends Error {
  constructor(
    public readonly estado: number,
    public readonly codigo: string,
    mensaje: string,
    public readonly campos: Record<string, string> = {},
  ) {
    super(mensaje);
    this.name = "ErrorApi";
  }
}

/**
 * Se llama cuando la API responde 401 a mitad del trabajo (la sesión venció o
 * desactivaron al usuario). El router lo usa para mandar a la pantalla de inicio de sesión.
 */
let alPerderSesion: (() => void) | undefined;
export function cuandoSePierdaLaSesion(funcion: () => void) {
  alPerderSesion = funcion;
}

type Consulta = Record<string, string | number | undefined | null>;

interface OpcionesPeticion {
  metodo?: "GET" | "POST" | "PATCH" | "DELETE";
  cuerpo?: unknown;
  consulta?: Consulta;
  senal?: AbortSignal;
}

/** Llama a la API del backend y devuelve el JSON, o lanza un ErrorApi claro. */
export async function pedir<T>(ruta: string, opciones: OpcionesPeticion = {}): Promise<T> {
  const parametros = new URLSearchParams();
  for (const [clave, valor] of Object.entries(opciones.consulta ?? {})) {
    if (valor !== undefined && valor !== null && valor !== "") parametros.set(clave, String(valor));
  }
  const url = `/api${ruta}${parametros.size > 0 ? `?${parametros}` : ""}`;

  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      method: opciones.metodo ?? "GET",
      headers: opciones.cuerpo !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined,
      credentials: "same-origin",
      signal: opciones.senal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ErrorApi(0, "SIN_CONEXION", "No se pudo conectar con el servidor. Revisa que la API esté encendida.");
  }

  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    const error = datos?.error;
    // El 401 del propio inicio de sesión es "contraseña incorrecta", no una sesión perdida.
    if (respuesta.status === 401 && !ruta.startsWith("/auth/")) alPerderSesion?.();
    throw new ErrorApi(
      respuesta.status,
      error?.codigo ?? "ERROR",
      error?.mensaje ?? "Ocurrió un error inesperado.",
      error?.campos ?? {},
    );
  }
  return datos as T;
}
