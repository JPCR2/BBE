-- Parte 4b: datos del alta que pide el hotel (folio de factura y garantía).
-- Las columnas son opcionales en la base porque los equipos anteriores al
-- sistema pueden no tenerlos; la API los exige en las altas nuevas.

-- AlterTable
ALTER TABLE `equipos` ADD COLUMN `fechaVencimientoGarantia` DATE NULL,
    ADD COLUMN `folioFactura` VARCHAR(50) NULL;

-- CreateIndex
CREATE INDEX `equipos_folioFactura_idx` ON `equipos`(`folioFactura`);

-- Reglas de integridad (Prisma no administra CHECK).
ALTER TABLE `equipos`
    ADD CONSTRAINT `chk_equipos_folio_no_vacio`
        CHECK (`folioFactura` IS NULL OR TRIM(`folioFactura`) <> ''),
    ADD CONSTRAINT `chk_equipos_garantia_posterior_adquisicion`
        CHECK (`fechaVencimientoGarantia` IS NULL OR `fechaAdquisicion` IS NULL OR `fechaVencimientoGarantia` >= `fechaAdquisicion`);
