import session from "express-session";
import type { ClientePrisma } from "./clientePrisma.ts";

/**
 * La cookie dura hasta cerrar el navegador, pero algunos navegadores la
 * "reviven" al restaurar pestañas. Por eso el servidor también vence la
 * sesión si pasan estas horas sin usarla.
 */
export const HORAS_INACTIVIDAD_SESION = 12;
const DURACION_MS = HORAS_INACTIVIDAD_SESION * 60 * 60 * 1000;
/** Para no escribir en la base en cada clic: solo se renueva si ya pasó este tiempo. */
const RENOVAR_CADA_MS = 5 * 60 * 1000;

type Callback = (error?: unknown) => void;

/**
 * Guarda las sesiones de express-session en la tabla `sesiones`.
 * Así sobreviven a un reinicio de la API y se pueden cerrar todas las de un
 * usuario (al desactivarlo o cambiarle la contraseña).
 */
export class AlmacenSesionesPrisma extends session.Store {
  constructor(
    private readonly db: ClientePrisma,
    private readonly reloj: () => Date = () => new Date(),
  ) {
    super();
  }

  private vencimiento(): Date {
    return new Date(this.reloj().getTime() + DURACION_MS);
  }

  override get(id: string, callback: (error: unknown, sesion?: session.SessionData | null) => void): void {
    this.db.sesion
      .findUnique({ where: { id } })
      .then(async (fila) => {
        if (!fila) return callback(null, null);
        if (fila.expiraEn <= this.reloj()) {
          await this.db.sesion.deleteMany({ where: { id } });
          return callback(null, null);
        }
        callback(null, JSON.parse(fila.datos) as session.SessionData);
      })
      .catch((error: unknown) => callback(error));
  }

  override set(id: string, datos: session.SessionData, callback?: Callback): void {
    const fila = { datos: JSON.stringify(datos), usuarioId: datos.usuarioId ?? null, expiraEn: this.vencimiento() };
    this.db.sesion
      .upsert({ where: { id }, create: { id, ...fila }, update: fila })
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  override destroy(id: string, callback?: Callback): void {
    this.db.sesion
      .deleteMany({ where: { id } })
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  override touch(id: string, _datos: session.SessionData, callback?: Callback): void {
    const nuevo = this.vencimiento();
    this.db.sesion
      .updateMany({ where: { id, expiraEn: { lt: new Date(nuevo.getTime() - RENOVAR_CADA_MS) } }, data: { expiraEn: nuevo } })
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  /** Borra las sesiones vencidas. La API lo llama cada hora. */
  async limpiarVencidas(): Promise<number> {
    const { count } = await this.db.sesion.deleteMany({ where: { expiraEn: { lte: this.reloj() } } });
    return count;
  }
}

declare module "express-session" {
  interface SessionData {
    usuarioId: number;
  }
}
