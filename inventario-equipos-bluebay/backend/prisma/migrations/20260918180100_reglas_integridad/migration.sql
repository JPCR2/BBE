-- =============================================================================
-- Reglas de integridad que Prisma no puede expresar en schema.prisma.
-- Migración escrita a mano (Prisma no administra CHECK ni triggers, así que
-- no los borra en migraciones futuras).
--
-- Son la SEGUNDA barrera: la primera es la validación de la API. Si algo se
-- cuela (un error de programación, un script, una consulta manual), la base
-- de datos lo rechaza de todos modos.
--
-- Nota: no usar "DELIMITER" aquí; Prisma envía el archivo completo al
-- servidor y MariaDB interpreta correctamente los bloques BEGIN ... END.
-- =============================================================================

-- ---------------------------------------------------------------- departamentos
ALTER TABLE `departamentos`
    ADD CONSTRAINT `chk_departamentos_nombre_no_vacio` CHECK (TRIM(`nombre`) <> '');

-- ------------------------------------------------------------------- empleados
ALTER TABLE `empleados`
    ADD CONSTRAINT `chk_empleados_numero_no_vacio`    CHECK (TRIM(`numeroEmpleado`) <> ''),
    ADD CONSTRAINT `chk_empleados_nombre_no_vacio`    CHECK (TRIM(`nombre`) <> ''),
    ADD CONSTRAINT `chk_empleados_apellidos_no_vacio` CHECK (TRIM(`apellidos`) <> ''),
    ADD CONSTRAINT `chk_empleados_puesto_no_vacio`    CHECK (TRIM(`puesto`) <> '');

-- --------------------------------------------------------------------- equipos
ALTER TABLE `equipos`
    ADD CONSTRAINT `chk_equipos_serie_no_vacia`   CHECK (TRIM(`numeroSerie`) <> ''),
    ADD CONSTRAINT `chk_equipos_marca_no_vacia`   CHECK (TRIM(`marca`) <> ''),
    ADD CONSTRAINT `chk_equipos_modelo_no_vacio`  CHECK (TRIM(`modelo`) <> ''),
    ADD CONSTRAINT `chk_equipos_costo_no_negativo` CHECK (`costo` IS NULL OR `costo` >= 0);

-- ---------------------------------------------------------------- asignaciones
ALTER TABLE `asignaciones`
    ADD CONSTRAINT `chk_asignaciones_devolucion_posterior`
        CHECK (`fechaDevolucion` IS NULL OR `fechaDevolucion` >= `fechaAsignacion`);

-- Un equipo solo puede tener UNA asignación vigente (fechaDevolucion vacía).
-- MariaDB no tiene índices únicos condicionales, por eso se usa un trigger.
CREATE TRIGGER `trg_asignaciones_una_vigente_insert`
BEFORE INSERT ON `asignaciones`
FOR EACH ROW
BEGIN
    IF NEW.`fechaDevolucion` IS NULL AND EXISTS (
        SELECT 1 FROM `asignaciones`
        WHERE `equipoId` = NEW.`equipoId` AND `fechaDevolucion` IS NULL
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = '[ASIGNACION_VIGENTE] El equipo ya tiene una asignación vigente; registra la devolución antes de reasignarlo.';
    END IF;
END;

-- Misma regla al editar (reabrir una asignación o cambiarla de equipo).
CREATE TRIGGER `trg_asignaciones_una_vigente_update`
BEFORE UPDATE ON `asignaciones`
FOR EACH ROW
BEGIN
    IF NEW.`fechaDevolucion` IS NULL AND EXISTS (
        SELECT 1 FROM `asignaciones`
        WHERE `equipoId` = NEW.`equipoId` AND `fechaDevolucion` IS NULL AND `id` <> NEW.`id`
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = '[ASIGNACION_VIGENTE] El equipo ya tiene una asignación vigente; registra la devolución antes de reasignarlo.';
    END IF;
END;

-- -------------------------------------------------------------- mantenimientos
ALTER TABLE `mantenimientos`
    ADD CONSTRAINT `chk_mantenimientos_descripcion_no_vacia` CHECK (TRIM(`descripcion`) <> ''),
    ADD CONSTRAINT `chk_mantenimientos_programado_con_fecha`
        CHECK (`estado` <> 'PROGRAMADO' OR `fechaProgramada` IS NOT NULL),
    ADD CONSTRAINT `chk_mantenimientos_realizado_con_fecha`
        CHECK (`estado` <> 'REALIZADO' OR `fechaRealizacion` IS NOT NULL);
