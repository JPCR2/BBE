-- Parte 6: usuarios del sistema y sesiones guardadas en la base.
-- El id de sesión distingue mayúsculas (ascii_bin): es un valor aleatorio.

-- CreateTable
CREATE TABLE `usuarios` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usuario` VARCHAR(40) NOT NULL,
    `nombre` VARCHAR(100) NOT NULL,
    `contrasenaHash` VARCHAR(100) NOT NULL,
    `rol` ENUM('ADMIN', 'TECNICO') NOT NULL DEFAULT 'TECNICO',
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `intentosFallidos` INTEGER NOT NULL DEFAULT 0,
    `bloqueadoHasta` DATETIME(3) NULL,
    `ultimoAcceso` DATETIME(3) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `usuarios_usuario_key`(`usuario`),
    PRIMARY KEY (`id`),
    -- Solo minúsculas, números, punto, guion y guion bajo (lo normaliza la API).
    CONSTRAINT `chk_usuarios_usuario` CHECK (REGEXP_LIKE(`usuario`, '^[a-z0-9._-]{3,40}$', 'c')),
    CONSTRAINT `chk_usuarios_intentos` CHECK (`intentosFallidos` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sesiones` (
    `id` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `usuarioId` INTEGER NULL,
    `datos` TEXT NOT NULL,
    `expiraEn` DATETIME(3) NOT NULL,

    INDEX `sesiones_expiraEn_idx`(`expiraEn`),
    INDEX `sesiones_usuarioId_idx`(`usuarioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sesiones` ADD CONSTRAINT `sesiones_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
