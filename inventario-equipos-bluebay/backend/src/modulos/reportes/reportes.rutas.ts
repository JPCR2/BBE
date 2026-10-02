import { Router } from "express";
import type { ClientePrisma } from "../../lib/clientePrisma.ts";
import { noEncontrado } from "../../lib/errores.ts";
import { fechaATexto, hoyEnElHotel } from "../../lib/fechas.ts";
import { esquemaId, validar } from "../../lib/validacion.ts";
import type { ServicioBajas } from "../bajas/bajas.modulo.ts";
import { esquemaReporteAlta, generarPdfAlta } from "./reporteAlta.ts";
import { generarPdfBaja } from "./reporteBaja.ts";

/** Reportes imprimibles en PDF (/api/reportes). Se abren en otra pestaña del navegador. */
export function rutasReportes(db: ClientePrisma, bajas: ServicioBajas, reloj: () => Date = () => new Date()): Router {
  const rutas = Router();

  /** GET /api/reportes/alta?ids=1,2,3 */
  rutas.get("/alta", async (req, res) => {
    const { ids } = validar(esquemaReporteAlta, req.query);
    const equipos = await db.equipo.findMany({ where: { id: { in: ids } }, orderBy: { numeroSerie: "asc" } });
    const faltantes = ids.filter((id) => !equipos.some((e) => e.id === id));
    if (faltantes.length > 0) {
      throw noEncontrado(`No ${faltantes.length === 1 ? "existe el equipo" : "existen los equipos"} con id ${faltantes.join(", ")}.`);
    }

    const fechaEmision = hoyEnElHotel(reloj());
    const pdf = await generarPdfAlta(
      equipos.map((e) => ({
        tipo: e.tipo,
        marca: e.marca,
        modelo: e.modelo,
        numeroSerie: e.numeroSerie,
        costo: e.costo ? e.costo.toFixed(2) : null,
        folioFactura: e.folioFactura,
        fechaVencimientoGarantia: e.fechaVencimientoGarantia ? fechaATexto(e.fechaVencimientoGarantia) : null,
      })),
      { fechaEmision },
    );
    res
      .type("application/pdf")
      .set("Content-Disposition", `inline; filename="reporte-alta-${fechaEmision}.pdf"`)
      .send(pdf);
  });

  /** GET /api/reportes/baja/:id — el acta de baja con ese id. */
  rutas.get("/baja/:id", async (req, res) => {
    const baja = await bajas.obtener(validar(esquemaId, req.params.id));
    const pdf = await generarPdfBaja(baja);
    res
      .type("application/pdf")
      .set("Content-Disposition", `inline; filename="reporte-${baja.folio.toLowerCase()}.pdf"`)
      .send(pdf);
  });

  return rutas;
}
