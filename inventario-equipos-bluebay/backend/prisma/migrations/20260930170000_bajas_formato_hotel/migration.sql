-- Parte 5b: el acta de baja sigue el formato del hotel "Bajas de equipo
-- operacional": cada renglón tiene su propio motivo y condiciones, las firmas
-- se hacen a mano y se pueden incluir artículos sin número de serie
-- (baterías, tóners…) que no están en el inventario.

-- Primero las reglas que dependen de las columnas que se quitan.
ALTER TABLE `bajas`
    DROP CHECK `chk_bajas_dictamen_no_vacio`,
    DROP CHECK `chk_bajas_destino_no_vacio`,
    DROP CHECK `chk_bajas_autorizo_no_vacio`;

-- AlterTable
ALTER TABLE `bajas` DROP COLUMN `autorizo`,
    DROP COLUMN `destinoFinal`,
    DROP COLUMN `dictamen`,
    DROP COLUMN `motivo`;

-- AlterTable
ALTER TABLE `equipos` ADD COLUMN `observacionBaja` VARCHAR(255) NULL;

-- CreateTable
CREATE TABLE `bajas_articulos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bajaId` INTEGER NOT NULL,
    `descripcion` VARCHAR(150) NOT NULL,
    `cantidad` INTEGER NOT NULL,
    `costo` DECIMAL(10, 2) NULL,
    `aniosUso` INTEGER NULL,
    `observaciones` VARCHAR(255) NOT NULL,

    INDEX `bajas_articulos_bajaId_idx`(`bajaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bajas_articulos` ADD CONSTRAINT `bajas_articulos_bajaId_fkey` FOREIGN KEY (`bajaId`) REFERENCES `bajas`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Reglas de integridad (Prisma no administra CHECK).
-- Un equipo dado de baja lleva su motivo; uno que no lo está, no.
ALTER TABLE `equipos`
    ADD CONSTRAINT `chk_equipos_observacion_solo_con_acta`
        CHECK ((`bajaId` IS NULL AND `observacionBaja` IS NULL)
            OR (`bajaId` IS NOT NULL AND TRIM(`observacionBaja`) <> ''));

ALTER TABLE `bajas_articulos`
    ADD CONSTRAINT `chk_bajas_articulos_descripcion_no_vacia`    CHECK (TRIM(`descripcion`) <> ''),
    ADD CONSTRAINT `chk_bajas_articulos_observaciones_no_vacias` CHECK (TRIM(`observaciones`) <> ''),
    ADD CONSTRAINT `chk_bajas_articulos_cantidad_positiva`       CHECK (`cantidad` > 0),
    ADD CONSTRAINT `chk_bajas_articulos_costo_no_negativo`       CHECK (`costo` IS NULL OR `costo` >= 0),
    ADD CONSTRAINT `chk_bajas_articulos_anios_validos`           CHECK (`aniosUso` IS NULL OR `aniosUso` BETWEEN 0 AND 100);

-- Los renglones de un acta tampoco se borran.
CREATE TRIGGER `trg_bajas_articulos_no_borrar`
BEFORE DELETE ON `bajas_articulos`
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = '[BAJA_PERMANENTE] Un renglón de un acta de baja no se puede borrar.';
END;
