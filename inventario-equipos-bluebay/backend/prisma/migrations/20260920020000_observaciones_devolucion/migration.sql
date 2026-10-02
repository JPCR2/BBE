-- Notas que se capturan al registrar la devolución de un equipo.
-- Se guardan aparte de las notas de entrega para no perder ninguna de las dos.
ALTER TABLE `asignaciones` ADD COLUMN `observacionesDevolucion` VARCHAR(255) NULL;
