import { Router } from "express";
import { esquemaId, validar } from "../../lib/validacion.ts";
import { esquemaCrearEquipo, esquemaEditarEquipo, esquemaListarEquipos } from "./equipos.esquemas.ts";
import type { ServicioEquipos } from "./equipos.servicio.ts";

/** Rutas HTTP del módulo de Inventario (/api/equipos). */
export function rutasEquipos(servicio: ServicioEquipos): Router {
  const rutas = Router();

  rutas.get("/", async (req, res) => {
    res.json(await servicio.listar(validar(esquemaListarEquipos, req.query)));
  });

  rutas.get("/serie/:numeroSerie", async (req, res) => {
    res.json(await servicio.obtenerPorSerie(req.params.numeroSerie));
  });

  rutas.get("/:id", async (req, res) => {
    res.json(await servicio.obtenerFicha(validar(esquemaId, req.params.id)));
  });

  rutas.post("/", async (req, res) => {
    res.status(201).json(await servicio.crear(validar(esquemaCrearEquipo, req.body)));
  });

  rutas.patch("/:id", async (req, res) => {
    const id = validar(esquemaId, req.params.id);
    res.json(await servicio.editar(id, validar(esquemaEditarEquipo, req.body)));
  });

  return rutas;
}
