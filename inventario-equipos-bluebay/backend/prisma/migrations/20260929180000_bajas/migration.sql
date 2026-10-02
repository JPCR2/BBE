-- Parte 5: bajas de equipos.
-- Una baja es un acta (folio, fecha, motivo, dictamen y firmas) que agrupa uno
-- o varios equipos. El equipo nunca se borra: pasa a estado BAJA y guarda la
-- referencia a su acta.

-- AlterTable
ALTER TABLE `equipos` ADD COLUMN `bajaId` INTEGER NULL;

-- CreateTable
CREATE TABLE `bajas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `folio` VARCHAR(20) NOT NULL,
    `fechaBaja` DATE NOT NULL,
    `motivo` ENUM('OBSOLESCENCIA', 'DANO_IRREPARABLE', 'REPARACION_INCOSTEABLE', 'ROBO_O_EXTRAVIO', 'OTRO') NOT NULL,
    `dictamen` TEXT NOT NULL,
    `destinoFinal` VARCHAR(150) NULL,
    `elaboro` VARCHAR(100) NOT NULL,
    `autorizo` VARCHAR(100) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bajas_folio_key`(`folio`),
    INDEX `bajas_fechaBaja_idx`(`fechaBaja`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `equipos_bajaId_idx` ON `equipos`(`bajaId`);

-- AddForeignKey
-- ON UPDATE RESTRICT (y no CASCADE): MySQL no permite una restricción CHECK
-- sobre una columna con acciones en cascada.
ALTER TABLE `equipos` ADD CONSTRAINT `equipos_bajaId_fkey` FOREIGN KEY (`bajaId`) REFERENCES `bajas`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Reglas de integridad (Prisma no administra CHECK).
ALTER TABLE `bajas`
    ADD CONSTRAINT `chk_bajas_folio_no_vacio`    CHECK (TRIM(`folio`) <> ''),
    ADD CONSTRAINT `chk_bajas_dictamen_no_vacio` CHECK (TRIM(`dictamen`) <> ''),
    ADD CONSTRAINT `chk_bajas_elaboro_no_vacio`  CHECK (TRIM(`elaboro`) <> ''),
    ADD CONSTRAINT `chk_bajas_destino_no_vacio`  CHECK (`destinoFinal` IS NULL OR TRIM(`destinoFinal`) <> ''),
    ADD CONSTRAINT `chk_bajas_autorizo_no_vacio` CHECK (`autorizo` IS NULL OR TRIM(`autorizo`) <> '');

-- Un equipo ligado a un acta de baja debe estar en estado BAJA.
ALTER TABLE `equipos`
    ADD CONSTRAINT `chk_equipos_acta_solo_en_baja` CHECK (`bajaId` IS NULL OR `estado` = 'BAJA');

-- Un acta de baja es un documento firmado: no se borra.
CREATE TRIGGER `trg_bajas_no_borrar`
BEFORE DELETE ON `bajas`
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = '[BAJA_PERMANENTE] Un acta de baja no se puede borrar.';
END;
