-- CreateTable
CREATE TABLE `departamentos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(100) NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `departamentos_nombre_key`(`nombre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `empleados` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `numeroEmpleado` VARCHAR(20) NOT NULL,
    `nombre` VARCHAR(80) NOT NULL,
    `apellidos` VARCHAR(100) NOT NULL,
    `puesto` VARCHAR(100) NOT NULL,
    `departamentoId` INTEGER NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `empleados_numeroEmpleado_key`(`numeroEmpleado`),
    INDEX `empleados_departamentoId_idx`(`departamentoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `equipos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `numeroSerie` VARCHAR(100) NOT NULL,
    `tipo` ENUM('ESCRITORIO', 'LAPTOP', 'ALL_IN_ONE', 'MONITOR', 'IMPRESORA', 'OTRO') NOT NULL,
    `marca` VARCHAR(80) NOT NULL,
    `modelo` VARCHAR(100) NOT NULL,
    `especificaciones` TEXT NULL,
    `ubicacion` VARCHAR(150) NULL,
    `estado` ENUM('ACTIVO', 'EN_MANTENIMIENTO', 'BAJA') NOT NULL DEFAULT 'ACTIVO',
    `fechaAdquisicion` DATE NULL,
    `costo` DECIMAL(10, 2) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `equipos_numeroSerie_key`(`numeroSerie`),
    INDEX `equipos_estado_idx`(`estado`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asignaciones` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `equipoId` INTEGER NOT NULL,
    `empleadoId` INTEGER NOT NULL,
    `fechaAsignacion` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fechaDevolucion` DATETIME(3) NULL,
    `observaciones` VARCHAR(255) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `asignaciones_equipoId_fechaDevolucion_idx`(`equipoId`, `fechaDevolucion`),
    INDEX `asignaciones_empleadoId_idx`(`empleadoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mantenimientos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `equipoId` INTEGER NOT NULL,
    `tipo` ENUM('PREVENTIVO', 'CORRECTIVO') NOT NULL,
    `estado` ENUM('PROGRAMADO', 'REALIZADO', 'CANCELADO') NOT NULL DEFAULT 'PROGRAMADO',
    `fechaProgramada` DATE NULL,
    `fechaRealizacion` DATE NULL,
    `descripcion` TEXT NOT NULL,
    `responsable` VARCHAR(100) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `mantenimientos_equipoId_idx`(`equipoId`),
    INDEX `mantenimientos_estado_fechaProgramada_idx`(`estado`, `fechaProgramada`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `empleados` ADD CONSTRAINT `empleados_departamentoId_fkey` FOREIGN KEY (`departamentoId`) REFERENCES `departamentos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asignaciones` ADD CONSTRAINT `asignaciones_equipoId_fkey` FOREIGN KEY (`equipoId`) REFERENCES `equipos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asignaciones` ADD CONSTRAINT `asignaciones_empleadoId_fkey` FOREIGN KEY (`empleadoId`) REFERENCES `empleados`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mantenimientos` ADD CONSTRAINT `mantenimientos_equipoId_fkey` FOREIGN KEY (`equipoId`) REFERENCES `equipos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
