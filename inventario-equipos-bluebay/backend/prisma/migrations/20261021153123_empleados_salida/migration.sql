-- Baja de empleados (renuncia, despido…) con anonimización.
-- Un empleado dado de baja conserva su historial de asignaciones, pero se
-- borran su nombre, apellidos y número de empleado (datos personales).

-- AlterTable
ALTER TABLE `empleados` ADD COLUMN `anonimizadoEn` DATETIME(3) NULL,
    ADD COLUMN `fechaSalida` DATE NULL,
    ADD COLUMN `motivoSalida` ENUM('RENUNCIA', 'DESPIDO', 'FIN_CONTRATO', 'OTRO') NULL,
    ADD COLUMN `observacionSalida` VARCHAR(255) NULL;

ALTER TABLE `empleados`
    -- Fecha y motivo de salida van juntos.
    ADD CONSTRAINT `chk_empleados_salida_completa` CHECK ((`fechaSalida` IS NULL) = (`motivoSalida` IS NULL)),
    -- Solo un empleado inactivo puede tener salida o estar anonimizado.
    ADD CONSTRAINT `chk_empleados_salida_solo_inactivo` CHECK (`fechaSalida` IS NULL OR `activo` = 0),
    ADD CONSTRAINT `chk_empleados_anonimizado_con_salida` CHECK (`anonimizadoEn` IS NULL OR (`fechaSalida` IS NOT NULL AND `activo` = 0));
