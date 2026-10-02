import { Router } from "express";
import { z } from "zod";
import type { ClientePrisma } from "../../lib/clientePrisma.ts";
import { ErrorHttp, noEncontrado } from "../../lib/errores.ts";
import { esquemaId, textoObligatorio, validar } from "../../lib/validacion.ts";

const nombre = textoObligatorio("Escribe el nombre del departamento.", 100);
export const esquemaCrearDepartamento = z.strictObject({ nombre });
export const esquemaEditarDepartamento = z.strictObject({ nombre });

/**
 * Catálogo de departamentos del hotel. La intercalación de MariaDB no
 * distingue mayúsculas ni acentos, así que "Recepción" y "RECEPCION" son el
 * mismo departamento.
 */
export function crearServicioDepartamentos(db: ClientePrisma) {
  async function verificarNombreLibre(nombre: string, idPropio?: number) {
    const otro = await db.departamento.findFirst({ where: { nombre } });
    if (otro && otro.id !== idPropio) {
      const mensaje = `Ya existe el departamento «${otro.nombre}».`;
      throw new ErrorHttp(409, "DEPARTAMENTO_DUPLICADO", mensaje, { nombre: mensaje });
    }
  }

  return {
    /** Lista alfabética con cuántos empleados activos tiene cada departamento. */
    async listar() {
      const departamentos = await db.departamento.findMany({
        orderBy: { nombre: "asc" },
        select: { id: true, nombre: true, _count: { select: { empleados: { where: { activo: true } } } } },
      });
      return {
        datos: departamentos.map((d) => ({ id: d.id, nombre: d.nombre, empleadosActivos: d._count.empleados })),
      };
    },

    async crear(datos: { nombre: string }) {
      await verificarNombreLibre(datos.nombre);
      const creado = await db.departamento.create({ data: datos });
      return { id: creado.id, nombre: creado.nombre, empleadosActivos: 0 };
    },

    async editar(id: number, datos: { nombre: string }) {
      const actual = await db.departamento.findUnique({ where: { id } });
      if (!actual) throw noEncontrado(`No existe el departamento con id ${id}.`);
      await verificarNombreLibre(datos.nombre, id);
      const guardado = await db.departamento.update({
        where: { id },
        data: datos,
        select: { id: true, nombre: true, _count: { select: { empleados: { where: { activo: true } } } } },
      });
      return { id: guardado.id, nombre: guardado.nombre, empleadosActivos: guardado._count.empleados };
    },
  };
}

export type ServicioDepartamentos = ReturnType<typeof crearServicioDepartamentos>;

export function rutasDepartamentos(servicio: ServicioDepartamentos): Router {
  const rutas = Router();

  rutas.get("/", async (_req, res) => {
    res.json(await servicio.listar());
  });

  rutas.post("/", async (req, res) => {
    res.status(201).json(await servicio.crear(validar(esquemaCrearDepartamento, req.body)));
  });

  rutas.patch("/:id", async (req, res) => {
    const id = validar(esquemaId, req.params.id);
    res.json(await servicio.editar(id, validar(esquemaEditarDepartamento, req.body)));
  });

  return rutas;
}
