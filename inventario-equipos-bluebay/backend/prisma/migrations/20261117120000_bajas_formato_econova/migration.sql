-- Parte 5.1: formato de baja de noviembre de 2026 (Econova Sustainability).
-- Tipos de equipo que el hotel da de baja además de computadoras, y tiempo de
-- uso capturable como texto ("5 a 6 años") cuando no hay fecha de adquisición.

-- AlterTable
ALTER TABLE `equipos` MODIFY `tipo` ENUM('ESCRITORIO', 'LAPTOP', 'ALL_IN_ONE', 'MONITOR', 'IMPRESORA', 'TELEFONO', 'SWITCH', 'ACCESS_POINT', 'NO_BREAK', 'TECLADO', 'MOUSE', 'BOCINA', 'LECTOR_HUELLA', 'FUENTE_PODER', 'CARGADOR', 'CAMARA', 'SERVIDOR', 'TPV', 'OTRO') NOT NULL,
    ADD COLUMN `tiempoUsoBaja` VARCHAR(40) NULL;

-- AlterTable
ALTER TABLE `bajas_articulos` ADD COLUMN `tiempoUso` VARCHAR(40) NULL;

-- Reglas de integridad (Prisma no administra CHECK).
-- El tiempo de uso escrito solo existe en equipos dados de baja y no va vacío.
ALTER TABLE `equipos`
    ADD CONSTRAINT `chk_equipos_tiempo_uso_solo_con_acta`
        CHECK (`tiempoUsoBaja` IS NULL OR (`bajaId` IS NOT NULL AND TRIM(`tiempoUsoBaja`) <> ''));

ALTER TABLE `bajas_articulos`
    ADD CONSTRAINT `chk_bajas_articulos_tiempo_uso_no_vacio` CHECK (`tiempoUso` IS NULL OR TRIM(`tiempoUso`) <> '');
