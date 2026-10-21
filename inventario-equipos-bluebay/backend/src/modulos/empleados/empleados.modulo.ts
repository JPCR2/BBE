import { Router } from "express";
import { z } from "zod";
import type { MotivoSalida, Prisma } from "../../generated/prisma/client.ts";
import { escaparComodines, palabrasDe } from "../../lib/busqueda.ts";
import type { ClientePrisma } from "../../lib/clientePrisma.ts";
import { ErrorHttp, noEncontrado } from "../../lib/errores.ts";
import { fechaATexto, fechaDesdeTexto, hoyEnElHotel } from "../../lib/fechas.ts";
import { esquemaId, fechaCalendario, textoObligatorio, textoOpcional, validar } from "../../lib/validacion.ts";

const vacioAUndefined = (valor: unknown) => (typeof valor === "string" && valor.trim() === "" ? undefined : valor);

const camposEmpleado = {
  numeroEmpleado: textoObligatorio("Escribe el número de empleado.", 20),
  nombre: textoObligatorio("Escribe el nombre.", 80),
  apellidos: textoObligatorio("Escribe los apellidos.", 100),
  puesto: textoObligatorio("Escribe el puesto.", 100),
  departamentoId: z.coerce.number({ error: "Selecciona un departamento." }).int().positive("Selecciona un departamento."),
};

export const esquemaCrearEmpleado = z.strictObject(camposEmpleado);

export const esquemaEditarEmpleado = z
  .strictObject({ ...camposEmpleado, activo: z.boolean({ error: "El valor debe ser verdadero o falso." }) })
  .partial()
  .refine((datos) => Object.keys(datos).length > 0, { message: "Envía al menos un campo para modificar." });

export const esquemaListarEmpleados = z.object({
  busqueda: z.preprocess(vacioAUndefined, z.string().trim().max(100, "Máximo 100 caracteres.").optional()),
  departamentoId: z.preprocess(vacioAUndefined, z.coerce.number().int().positive().optional()),
  estado: z.preprocess(
    vacioAUndefined,
    z.enum(["activos", "inactivos", "todos"], { error: "Usa activos, inactivos o todos." }).default("activos"),
  ),
  pagina: z.preprocess(vacioAUndefined, z.coerce.number().int().min(1, "La página empieza en 1.").default(1)),
  porPagina: z.preprocess(vacioAUndefined, z.coerce.number().int().min(1).max(100, "Máximo 100 por página.").default(20)),
});

/** Baja del empleado: fecha, motivo y notas opcionales. */
export const esquemaBajaEmpleado = z.strictObject({
  fechaSalida: fechaCalendario("Elige la fecha de salida."),
  motivo: z.enum(["RENUNCIA", "DESPIDO", "FIN_CONTRATO", "OTRO"], { error: "Elige el motivo de la salida." }),
  observaciones: textoOpcional(255),
});

export const ETIQUETAS_MOTIVO_SALIDA: Record<MotivoSalida, string> = {
  RENUNCIA: "Renuncia",
  DESPIDO: "Despido",
  FIN_CONTRATO: "Fin de contrato",
  OTRO: "Otro",
};

type DatosCrear = z.output<typeof esquemaCrearEmpleado>;
type DatosEditar = z.output<typeof esquemaEditarEmpleado>;
type Filtros = z.output<typeof esquemaListarEmpleados>;

const conDepartamentoYConteo = {
  include: {
    departamento: true,
    _count: { select: { asignaciones: { where: { fechaDevolucion: null } } } },
  },
} satisfies { include: Prisma.EmpleadoInclude };

type EmpleadoConConteo = Prisma.EmpleadoGetPayload<typeof conDepartamentoYConteo>;

function empleadoDto(empleado: EmpleadoConConteo) {
  return {
    id: empleado.id,
    numeroEmpleado: empleado.numeroEmpleado,
    nombre: empleado.nombre,
    apellidos: empleado.apellidos,
    puesto: empleado.puesto,
    activo: empleado.activo,
    departamento: { id: empleado.departamento.id, nombre: empleado.departamento.nombre },
    equiposAsignados: empleado._count.asignaciones,
    salida: empleado.fechaSalida && empleado.motivoSalida
      ? { fecha: fechaATexto(empleado.fechaSalida), motivo: empleado.motivoSalida, observaciones: empleado.observacionSalida }
      : null,
    anonimizado: empleado.anonimizadoEn !== null,
  };
}

const mensajeAnonimizado =
  "Este empleado ya se dio de baja y sus datos personales se borraron; no se puede modificar. Si regresa al hotel, regístralo de nuevo.";

export function crearServicioEmpleados(db: ClientePrisma, reloj: () => Date = () => new Date()) {
  async function verificarNumeroLibre(numeroEmpleado: string, idPropio?: number) {
    const otro = await db.empleado.findFirst({ where: { numeroEmpleado } });
    if (otro && otro.id !== idPropio) {
      const mensaje = `Ya existe un empleado con el número ${otro.numeroEmpleado}.`;
      throw new ErrorHttp(409, "NUMERO_EMPLEADO_DUPLICADO", mensaje, { numeroEmpleado: mensaje });
    }
  }

  async function verificarDepartamento(departamentoId: number) {
    const departamento = await db.departamento.findUnique({ where: { id: departamentoId } });
    if (!departamento) {
      throw new ErrorHttp(400, "DATOS_INVALIDOS", "Revisa los datos marcados.", {
        departamentoId: "El departamento seleccionado no existe.",
      });
    }
  }

  return {
    async listar(filtros: Filtros) {
      const palabras = palabrasDe(filtros.busqueda);
      const where: Prisma.EmpleadoWhereInput = {
        ...(filtros.estado === "todos" ? {} : { activo: filtros.estado === "activos" }),
        ...(filtros.departamentoId ? { departamentoId: filtros.departamentoId } : {}),
        AND: palabras.map((palabra) => ({
          OR: [
            { nombre: { contains: escaparComodines(palabra) } },
            { apellidos: { contains: escaparComodines(palabra) } },
            { numeroEmpleado: { contains: escaparComodines(palabra) } },
            { puesto: { contains: escaparComodines(palabra) } },
          ],
        })),
      };
      const [total, empleados, activos, inactivos] = await db.$transaction([
        db.empleado.count({ where }),
        db.empleado.findMany({
          where,
          ...conDepartamentoYConteo,
          orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
          skip: (filtros.pagina - 1) * filtros.porPagina,
          take: filtros.porPagina,
        }),
        db.empleado.count({ where: { activo: true } }),
        db.empleado.count({ where: { activo: false } }),
      ]);
      return {
        datos: empleados.map(empleadoDto),
        total,
        pagina: filtros.pagina,
        porPagina: filtros.porPagina,
        conteos: { activos, inactivos },
      };
    },

    /** Ficha del empleado: sus equipos vigentes y todo su historial. */
    async obtenerFicha(id: number) {
      const empleado = await db.empleado.findUnique({
        where: { id },
        include: {
          departamento: true,
          _count: { select: { asignaciones: { where: { fechaDevolucion: null } } } },
          asignaciones: { include: { equipo: true }, orderBy: [{ fechaAsignacion: "desc" }, { id: "desc" }] },
        },
      });
      if (!empleado) throw noEncontrado(`No existe el empleado con id ${id}.`);
      const aLinea = (a: (typeof empleado.asignaciones)[number]) => ({
        id: a.id,
        fechaAsignacion: a.fechaAsignacion.toISOString(),
        fechaDevolucion: a.fechaDevolucion ? a.fechaDevolucion.toISOString() : null,
        observaciones: a.observaciones,
        observacionesDevolucion: a.observacionesDevolucion,
        equipo: {
          id: a.equipo.id,
          numeroSerie: a.equipo.numeroSerie,
          tipo: a.equipo.tipo,
          marca: a.equipo.marca,
          modelo: a.equipo.modelo,
          estado: a.equipo.estado,
        },
      });
      return {
        ...empleadoDto(empleado),
        creadoEn: empleado.creadoEn.toISOString(),
        equiposVigentes: empleado.asignaciones.filter((a) => a.fechaDevolucion === null).map(aLinea),
        historial: empleado.asignaciones.map(aLinea),
        // Solo se borra de verdad a quien nunca tuvo equipos (capturado por error).
        puedeEliminar: empleado.asignaciones.length === 0,
      };
    },

    async crear(datos: DatosCrear) {
      await verificarNumeroLibre(datos.numeroEmpleado);
      await verificarDepartamento(datos.departamentoId);
      const creado = await db.empleado.create({ data: datos });
      return this.obtenerFicha(creado.id);
    },

    async editar(id: number, datos: DatosEditar) {
      const actual = await db.empleado.findUnique({
        where: { id },
        include: { _count: { select: { asignaciones: { where: { fechaDevolucion: null } } } } },
      });
      if (!actual) throw noEncontrado(`No existe el empleado con id ${id}.`);
      if (actual.anonimizadoEn) throw new ErrorHttp(409, "EMPLEADO_ANONIMIZADO", mensajeAnonimizado);
      // La salida se registra con su fecha y motivo en /baja, no apagando "activo".
      if (datos.activo === false) {
        throw new ErrorHttp(409, "USA_DAR_DE_BAJA", "Para registrar que el empleado dejó el hotel usa «Dar de baja» (pide la fecha y el motivo).");
      }
      if (datos.numeroEmpleado) await verificarNumeroLibre(datos.numeroEmpleado, id);
      if (datos.departamentoId) await verificarDepartamento(datos.departamentoId);
      await db.empleado.update({ where: { id }, data: datos });
      return this.obtenerFicha(id);
    },

    /**
     * Renuncia, despido…: queda inactivo con su fecha y motivo, y se borran sus
     * datos personales (nombre, apellidos y número de empleado). El puesto, el
     * departamento y el historial de equipos se conservan para auditorías.
     * No se puede deshacer.
     */
    async darDeBaja(id: number, datos: z.output<typeof esquemaBajaEmpleado>) {
      const actual = await db.empleado.findUnique({
        where: { id },
        include: { _count: { select: { asignaciones: { where: { fechaDevolucion: null } } } } },
      });
      if (!actual) throw noEncontrado(`No existe el empleado con id ${id}.`);
      if (actual.anonimizadoEn) throw new ErrorHttp(409, "EMPLEADO_YA_DADO_DE_BAJA", "Este empleado ya se dio de baja.");
      const cuantos = actual._count.asignaciones;
      if (cuantos > 0) {
        throw new ErrorHttp(
          409,
          "EMPLEADO_CON_EQUIPOS",
          `Este empleado todavía tiene ${cuantos} ${cuantos === 1 ? "equipo asignado" : "equipos asignados"}. Registra la devolución antes de darlo de baja.`,
        );
      }
      if (datos.fechaSalida > fechaDesdeTexto(hoyEnElHotel(reloj()))) {
        const mensaje = "La fecha de salida no puede ser futura.";
        throw new ErrorHttp(400, "DATOS_INVALIDOS", "Revisa los datos marcados.", { fechaSalida: mensaje });
      }
      await db.empleado.update({
        where: { id },
        data: {
          activo: false,
          fechaSalida: datos.fechaSalida,
          motivoSalida: datos.motivo,
          observacionSalida: datos.observaciones ?? null,
          anonimizadoEn: reloj(),
          nombre: "Ex empleado",
          apellidos: `#${id}`,
          numeroEmpleado: `EX-${id}`,
        },
      });
      return this.obtenerFicha(id);
    },

    /** Borra de la base a un empleado que nunca tuvo equipos (registrado por error). */
    async eliminar(id: number) {
      const actual = await db.empleado.findUnique({ where: { id }, include: { _count: { select: { asignaciones: true } } } });
      if (!actual) throw noEncontrado(`No existe el empleado con id ${id}.`);
      if (actual._count.asignaciones > 0) {
        throw new ErrorHttp(
          409,
          "EMPLEADO_CON_HISTORIAL",
          "Este empleado tiene historial de equipos y no se puede borrar (se perdería quién tuvo cada equipo). Usa «Dar de baja».",
        );
      }
      await db.empleado.delete({ where: { id } });
    },
  };
}

export type ServicioEmpleados = ReturnType<typeof crearServicioEmpleados>;

export function rutasEmpleados(servicio: ServicioEmpleados): Router {
  const rutas = Router();

  rutas.get("/", async (req, res) => {
    res.json(await servicio.listar(validar(esquemaListarEmpleados, req.query)));
  });

  rutas.get("/:id", async (req, res) => {
    res.json(await servicio.obtenerFicha(validar(esquemaId, req.params.id)));
  });

  rutas.post("/", async (req, res) => {
    res.status(201).json(await servicio.crear(validar(esquemaCrearEmpleado, req.body)));
  });

  rutas.patch("/:id", async (req, res) => {
    const id = validar(esquemaId, req.params.id);
    res.json(await servicio.editar(id, validar(esquemaEditarEmpleado, req.body)));
  });

  rutas.post("/:id/baja", async (req, res) => {
    const id = validar(esquemaId, req.params.id);
    res.json(await servicio.darDeBaja(id, validar(esquemaBajaEmpleado, req.body)));
  });

  rutas.delete("/:id", async (req, res) => {
    await servicio.eliminar(validar(esquemaId, req.params.id));
    res.status(204).end();
  });

  return rutas;
}
