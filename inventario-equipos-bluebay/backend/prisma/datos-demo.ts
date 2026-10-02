// =============================================================================
// DATOS FICTICIOS DE PRUEBA
// No corresponden al personal ni al inventario real del hotel. Todos los
// números de empleado y de serie llevan el prefijo DEMO para distinguirlos.
// Las fechas de mantenimiento son relativas a "hoy", para que el calendario
// siempre muestre casos vencidos, próximos y futuros.
// =============================================================================
import type { ClientePrisma } from "../src/lib/clientePrisma.ts";
import { fechaDesdeTexto, hoyEnElHotel, sumarDias } from "../src/lib/fechas.ts";
import type { EstadoEquipo, TipoEquipo } from "../src/generated/prisma/enums.ts";

type DatoEquipoDemo = {
  numeroSerie: string;
  tipo: TipoEquipo;
  marca: string;
  modelo: string;
  ubicacion: string;
  fechaAdquisicion?: string;
  costo?: string;
  folioFactura?: string;
  fechaVencimientoGarantia?: string;
  estado?: EstadoEquipo;
};

export type ResultadoSemilla =
  | { omitido: true; motivo: string }
  | { omitido: false; departamentos: number; empleados: number; equipos: number; asignaciones: number; mantenimientos: number };

export async function sembrarDatosDemo(db: ClientePrisma): Promise<ResultadoSemilla> {
  // Protección: nunca mezclar datos demo con un inventario que ya tiene datos.
  if ((await db.equipo.count()) > 0 || (await db.empleado.count()) > 0) {
    return { omitido: true, motivo: "La base ya tiene equipos o empleados; no se insertaron datos demo." };
  }

  const hoy = fechaDesdeTexto(hoyEnElHotel());
  const hace = (dias: number) => sumarDias(hoy, -dias);
  const dentroDe = (dias: number) => sumarDias(hoy, dias);

  return db.$transaction(async (tx) => {
    const nombresDepartamentos = ["Sistemas", "Recepción", "Contabilidad", "Ama de Llaves", "Alimentos y Bebidas", "Recursos Humanos"];
    const departamentos: Record<string, number> = {};
    for (const nombre of nombresDepartamentos) {
      departamentos[nombre] = (await tx.departamento.create({ data: { nombre } })).id;
    }

    const datosEmpleados = [
      { numeroEmpleado: "DEMO-001", nombre: "Laura", apellidos: "Méndez Cruz", puesto: "Recepcionista", departamento: "Recepción" },
      { numeroEmpleado: "DEMO-002", nombre: "Carlos", apellidos: "Pech Canul", puesto: "Auxiliar contable", departamento: "Contabilidad" },
      { numeroEmpleado: "DEMO-003", nombre: "Mariana", apellidos: "Uc Tzab", puesto: "Coordinadora", departamento: "Ama de Llaves" },
      { numeroEmpleado: "DEMO-004", nombre: "Jorge", apellidos: "Ramírez Soto", puesto: "Técnico de soporte", departamento: "Sistemas" },
      { numeroEmpleado: "DEMO-005", nombre: "Sofía", apellidos: "Díaz Herrera", puesto: "Analista de nómina", departamento: "Recursos Humanos" },
    ];
    const empleados: Record<string, number> = {};
    for (const { departamento, ...datos } of datosEmpleados) {
      const empleado = await tx.empleado.create({ data: { ...datos, departamentoId: departamentos[departamento]! } });
      empleados[datos.numeroEmpleado] = empleado.id;
    }

    const datosEquipos: DatoEquipoDemo[] = [
      { numeroSerie: "DEMO-SN-0001", tipo: "LAPTOP", marca: "Dell", modelo: "Latitude 5440", ubicacion: "Recepción", fechaAdquisicion: "2023-03-15", costo: "21500.00", folioFactura: "DEMO-FAC-1001", fechaVencimientoGarantia: "2026-03-15" },
      { numeroSerie: "DEMO-SN-0002", tipo: "ESCRITORIO", marca: "HP", modelo: "ProDesk 400 G7", ubicacion: "Contabilidad", fechaAdquisicion: "2021-08-02", costo: "14800.00", folioFactura: "DEMO-FAC-0877", fechaVencimientoGarantia: "2022-08-02" },
      { numeroSerie: "DEMO-SN-0003", tipo: "ALL_IN_ONE", marca: "Lenovo", modelo: "IdeaCentre AIO 3", ubicacion: "Ama de Llaves", fechaAdquisicion: "2022-01-20", costo: "16990.00", folioFactura: "DEMO-FAC-0912", fechaVencimientoGarantia: "2025-01-20" },
      { numeroSerie: "DEMO-SN-0004", tipo: "MONITOR", marca: "Samsung", modelo: "S24C310", ubicacion: "Sistemas" },
      { numeroSerie: "DEMO-SN-0005", tipo: "IMPRESORA", marca: "Epson", modelo: "EcoTank L3250", ubicacion: "Recepción", fechaAdquisicion: "2024-05-10", costo: "4599.00", folioFactura: "DEMO-FAC-1001", fechaVencimientoGarantia: "2026-11-10" },
      { numeroSerie: "DEMO-SN-0006", tipo: "LAPTOP", marca: "Lenovo", modelo: "ThinkPad E14", ubicacion: "Sistemas", fechaAdquisicion: "2020-11-05", costo: "19200.00", estado: "EN_MANTENIMIENTO" },
    ];
    const equipos: Record<string, number> = {};
    for (const { fechaAdquisicion, fechaVencimientoGarantia, ...datos } of datosEquipos) {
      const equipo = await tx.equipo.create({
        data: {
          ...datos,
          ...(fechaAdquisicion ? { fechaAdquisicion: fechaDesdeTexto(fechaAdquisicion) } : {}),
          ...(fechaVencimientoGarantia ? { fechaVencimientoGarantia: fechaDesdeTexto(fechaVencimientoGarantia) } : {}),
        },
      });
      equipos[datos.numeroSerie] = equipo.id;
    }

    const asignaciones = [
      { equipoId: equipos["DEMO-SN-0001"]!, empleadoId: empleados["DEMO-001"]!, fechaAsignacion: hace(400) },
      { equipoId: equipos["DEMO-SN-0002"]!, empleadoId: empleados["DEMO-002"]!, fechaAsignacion: hace(700) },
      { equipoId: equipos["DEMO-SN-0003"]!, empleadoId: empleados["DEMO-003"]!, fechaAsignacion: hace(500) },
      { equipoId: equipos["DEMO-SN-0004"]!, empleadoId: empleados["DEMO-004"]!, fechaAsignacion: hace(120) },
      // Historial: la laptop 0006 estuvo asignada y se devolvió al entrar a mantenimiento.
      { equipoId: equipos["DEMO-SN-0006"]!, empleadoId: empleados["DEMO-005"]!, fechaAsignacion: hace(200), fechaDevolucion: hace(10), observaciones: "Devuelta por falla de teclado" },
    ];
    for (const datos of asignaciones) await tx.asignacion.create({ data: datos });

    const mantenimientos = [
      { equipoId: equipos["DEMO-SN-0002"]!, tipo: "PREVENTIVO", estado: "PROGRAMADO", fechaProgramada: hace(5), descripcion: "Limpieza interna y revisión de ventiladores" },
      { equipoId: equipos["DEMO-SN-0001"]!, tipo: "PREVENTIVO", estado: "PROGRAMADO", fechaProgramada: dentroDe(3), descripcion: "Actualización del sistema operativo y respaldo" },
      { equipoId: equipos["DEMO-SN-0006"]!, tipo: "CORRECTIVO", estado: "PROGRAMADO", fechaProgramada: dentroDe(1), descripcion: "Reemplazo de teclado" },
      { equipoId: equipos["DEMO-SN-0003"]!, tipo: "PREVENTIVO", estado: "PROGRAMADO", fechaProgramada: dentroDe(30), descripcion: "Limpieza general y revisión de disco" },
      { equipoId: equipos["DEMO-SN-0002"]!, tipo: "PREVENTIVO", estado: "REALIZADO", fechaProgramada: hace(92), fechaRealizacion: hace(90), descripcion: "Limpieza interna", responsable: "Jorge Ramírez Soto" },
      { equipoId: equipos["DEMO-SN-0005"]!, tipo: "CORRECTIVO", estado: "REALIZADO", fechaRealizacion: hace(40), descripcion: "Limpieza de cabezales por impresión con rayas", responsable: "Jorge Ramírez Soto" },
      { equipoId: equipos["DEMO-SN-0005"]!, tipo: "PREVENTIVO", estado: "CANCELADO", fechaProgramada: hace(15), descripcion: "Revisión general (cancelada: se hizo el correctivo)" },
    ] as const;
    for (const datos of mantenimientos) await tx.mantenimiento.create({ data: datos });

    return {
      omitido: false as const,
      departamentos: nombresDepartamentos.length,
      empleados: datosEmpleados.length,
      equipos: datosEquipos.length,
      asignaciones: asignaciones.length,
      mantenimientos: mantenimientos.length,
    };
  });
}
