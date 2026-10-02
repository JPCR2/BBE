-- Corrige chk_equipos_observacion_solo_con_acta: en MySQL, TRIM(NULL) <> ''
-- da NULL y un CHECK con resultado NULL se acepta, así que un equipo podía
-- quedar ligado a un acta sin motivo. Ahora se exige explícitamente.
ALTER TABLE `equipos` DROP CHECK `chk_equipos_observacion_solo_con_acta`;

ALTER TABLE `equipos`
    ADD CONSTRAINT `chk_equipos_observacion_solo_con_acta`
        CHECK ((`bajaId` IS NULL AND `observacionBaja` IS NULL)
            OR (`bajaId` IS NOT NULL AND `observacionBaja` IS NOT NULL AND TRIM(`observacionBaja`) <> ''));
