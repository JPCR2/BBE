import { vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

/**
 * Simula la API: cada llamada a fetch responde con lo que devuelva `responder`.
 * Los avisos de mantenimiento (que la campana del encabezado consulta en todas
 * las pantallas) responden "sin avisos" y no se registran en `llamadas`, salvo
 * que la prueba pida manejarlos ella misma con `{ avisos: true }`.
 */
export function simularApi(
  responder: (url: string, init?: RequestInit) => { estado?: number; cuerpo: unknown },
  opciones: { avisos?: boolean } = {},
) {
  const llamadas: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/mantenimientos/avisos") && !opciones.avisos) {
      return new Response(JSON.stringify(sinAvisos), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    llamadas.push({ url, init });
    const { estado = 200, cuerpo } = responder(url, init);
    return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
  }));
  return llamadas;
}

export const sinAvisos = { hoy: "2026-09-22", diasAviso: 7, total: 0, vencidos: [], proximos: [] };

const Vacia = { template: "<div />" };
export function crearRouterDePrueba() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "inicio", component: Vacia },
      { path: "/inventario", name: "inventario", component: Vacia },
      { path: "/inventario/nuevo", name: "alta-equipo", component: Vacia },
      { path: "/inventario/:id", name: "ficha-equipo", component: Vacia },
      { path: "/inventario/:id/editar", name: "editar-equipo", component: Vacia },
      { path: "/empleados", name: "empleados", component: Vacia },
      { path: "/mantenimiento", name: "mantenimiento", component: Vacia },
      { path: "/bajas", name: "bajas", component: Vacia },
      { path: "/bajas/nueva", name: "nueva-baja", component: Vacia },
      { path: "/usuarios", name: "usuarios", component: Vacia },
      { path: "/iniciar-sesion", name: "iniciar-sesion", component: Vacia },
    ],
  });
}

export const equipoDemo = (id: number, numeroSerie: string, asignado = true) => ({
  id, numeroSerie, tipo: "LAPTOP", marca: "Dell", modelo: "Latitude 5440", ubicacion: "Recepción", estado: "ACTIVO",
  asignacionVigente: asignado
    ? { id: 1, fechaAsignacion: "2025-08-14T15:00:00.000Z", empleado: { id: 1, numeroEmpleado: "DEMO-001", nombre: "Laura", apellidos: "Méndez Cruz", puesto: "Recepcionista", departamento: "Recepción", activo: true } }
    : null,
});

/** Mantenimiento programado de DEMO-SN-0001 con los campos que calcula la API. */
export const mantenimientoDemo = (id: number, fecha: string, cambios: Record<string, unknown> = {}) => ({
  id, tipo: "PREVENTIVO", estado: "PROGRAMADO", situacion: "PROGRAMADO",
  fechaProgramada: fecha, fechaRealizacion: null, fecha, diasRestantes: 3,
  descripcion: "Limpieza interna y revisión de ventiladores", responsable: null,
  equipo: { id: 1, numeroSerie: "DEMO-SN-0001", tipo: "LAPTOP", marca: "Dell", modelo: "Latitude 5440", ubicacion: "Recepción", estado: "ACTIVO" },
  ...cambios,
});

/** Respuesta JSON de error con el formato de la API. */
export const errorApi = (estado: number, codigo: string, mensaje: string, campos?: Record<string, string>) => ({
  estado, cuerpo: { error: { codigo, mensaje, ...(campos ? { campos } : {}) } },
});

export const adminDemo = { id: 1, usuario: "jpolanco", nombre: "Joel Polanco Cruz", rol: "ADMIN" as const };
export const tecnicoDemo = { id: 2, usuario: "alopez", nombre: "Ana López", rol: "TECNICO" as const };
