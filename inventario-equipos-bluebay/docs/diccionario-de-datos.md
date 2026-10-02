# Diccionario de datos

**Sistema de Gestión de Inventario y Mantenimiento de Equipos de Cómputo — Blue Bay Grand Esmeralda**
Versión del esquema: 1 (parte 1 del prototipo). Gestor: MariaDB. ORM: Prisma 7.

## Convenciones

- Los nombres de tablas están en plural (`equipos`) y los de las entidades en el código en singular (`Equipo`).
- Las columnas se llaman igual que los campos del código (camelCase), sin acentos ni ñ, para mantener la misma terminología en el sistema y en la Memoria.
- Todas las tablas usan `utf8mb4` con intercalación `utf8mb4_unicode_ci`, que no distingue mayúsculas, minúsculas ni acentos al comparar. Por eso "Recepción" y "RECEPCION" se consideran el mismo valor en los campos únicos.
- Todas las tablas tienen `id` (llave primaria autoincremental), `creadoEn` (fecha y hora de registro) y `actualizadoEn` (fecha y hora de la última modificación). Las horas se guardan en UTC.
- Las fechas de calendario (adquisición, mantenimiento) se guardan como `DATE`, sin hora.

## Relaciones

| Relación | Cardinalidad | Regla al borrar |
|---|---|---|
| departamentos → empleados | Un departamento tiene muchos empleados; cada empleado pertenece a un departamento | RESTRICT: no se puede borrar un departamento con empleados |
| equipos → asignaciones | Un equipo tiene muchas asignaciones en su historial; como máximo una vigente | RESTRICT |
| empleados → asignaciones | Un empleado tiene muchas asignaciones y puede tener varios equipos vigentes a la vez | RESTRICT |
| equipos → mantenimientos | Un equipo tiene muchos mantenimientos | RESTRICT |
| bajas → equipos | Un acta de baja agrupa equipos; cada equipo tiene como máximo un acta | RESTRICT (y las actas no se borran) |
| bajas → bajas_articulos | Un acta tiene cero o más artículos sin número de serie | RESTRICT (y los renglones no se borran) |
| usuarios → sesiones | Un usuario puede tener varias sesiones abiertas (una por computadora o navegador) | CASCADE: al borrar un usuario se borran sus sesiones |

`asignaciones` resuelve la relación muchos a muchos entre equipos y empleados a lo largo del tiempo y conserva el historial completo.

## Tabla `departamentos`

Catálogo de departamentos del hotel.

| Campo | Tipo | Nulo | Llave | Por defecto | Descripción |
|---|---|---|---|---|---|
| id | INT | No | PK | autoincremental | Identificador del departamento |
| nombre | VARCHAR(100) | No | Única | — | Nombre del departamento; no puede estar vacío |
| creadoEn | DATETIME(3) | No | — | fecha y hora actual | Fecha y hora de registro |
| actualizadoEn | DATETIME(3) | No | — | — | Fecha y hora de la última modificación |

## Tabla `empleados`

Personal del hotel al que se le asignan equipos.

| Campo | Tipo | Nulo | Llave | Por defecto | Descripción |
|---|---|---|---|---|---|
| id | INT | No | PK | autoincremental | Identificador interno del empleado |
| numeroEmpleado | VARCHAR(20) | No | Única | — | Número de empleado del hotel; se le quitan los espacios de los extremos |
| nombre | VARCHAR(80) | No | — | — | Nombre(s) |
| apellidos | VARCHAR(100) | No | — | — | Apellidos |
| puesto | VARCHAR(100) | No | — | — | Puesto que ocupa |
| departamentoId | INT | No | FK → departamentos.id | — | Departamento al que pertenece |
| activo | BOOLEAN | No | — | verdadero | Falso cuando el empleado deja el hotel; el registro se conserva para no perder su historial |
| creadoEn | DATETIME(3) | No | — | fecha y hora actual | Fecha y hora de registro |
| actualizadoEn | DATETIME(3) | No | — | — | Fecha y hora de la última modificación |

## Tabla `equipos`

Inventario de equipos de cómputo. Cada registro es una unidad física.

| Campo | Tipo | Nulo | Llave | Por defecto | Descripción |
|---|---|---|---|---|---|
| id | INT | No | PK | autoincremental | Identificador interno del equipo |
| numeroSerie | VARCHAR(100) | No | Única | — | Número de serie o Service Tag del fabricante; se guarda sin espacios y en mayúsculas |
| tipo | ENUM | No | — | — | ESCRITORIO, LAPTOP, ALL_IN_ONE, MONITOR, IMPRESORA u OTRO |
| marca | VARCHAR(80) | No | — | — | Marca del equipo |
| modelo | VARCHAR(100) | No | — | — | Modelo del equipo (aparece en el reporte de baja) |
| especificaciones | TEXT | Sí | — | — | Características técnicas (procesador, memoria, disco…) |
| ubicacion | VARCHAR(150) | Sí | — | — | Área física donde se encuentra |
| estado | ENUM | No | — | ACTIVO | ACTIVO, EN_MANTENIMIENTO o BAJA. La baja es lógica: el registro nunca se borra |
| fechaAdquisicion | DATE | Sí | — | — | Fecha de compra; base para calcular el tiempo de funcionamiento |
| costo | DECIMAL(10,2) | Sí | — | — | Costo del equipo en pesos mexicanos; no puede ser negativo |
| folioFactura | VARCHAR(50) | Sí | — | — | Folio de la factura de compra (reporte de alta). La API lo exige en altas nuevas; los equipos anteriores al sistema pueden no tenerlo |
| fechaVencimientoGarantia | DATE | Sí | — | — | Fecha en que vence la garantía; no puede ser anterior a la fecha de adquisición. Obligatoria en altas nuevas |
| bajaId | INT | Sí | FK → bajas.id | — | Acta con la que se dio de baja; solo la tienen los equipos en estado BAJA |
| observacionBaja | VARCHAR(255) | Sí | — | — | Motivo de la baja y condiciones del equipo; obligatorio si tiene acta, vacío si no |
| creadoEn | DATETIME(3) | No | — | fecha y hora actual | Fecha y hora de registro (alta en el sistema) |
| actualizadoEn | DATETIME(3) | No | — | — | Fecha y hora de la última modificación |

Datos que se calculan y no se guardan:
- **Asignado o disponible:** se deduce de si el equipo tiene una asignación vigente.
- **Tiempo de funcionamiento:** se calcula desde `fechaAdquisicion` hasta la fecha de baja.

## Tabla `asignaciones`

Historial de qué empleado ha tenido cada equipo.

| Campo | Tipo | Nulo | Llave | Por defecto | Descripción |
|---|---|---|---|---|---|
| id | INT | No | PK | autoincremental | Identificador de la asignación |
| equipoId | INT | No | FK → equipos.id | — | Equipo asignado |
| empleadoId | INT | No | FK → empleados.id | — | Empleado que recibe el equipo |
| fechaAsignacion | DATETIME(3) | No | — | fecha y hora actual | Momento de la entrega |
| fechaDevolucion | DATETIME(3) | Sí | — | — | Momento de la devolución. Vacía = asignación vigente |
| observaciones | VARCHAR(255) | Sí | — | — | Notas (accesorios entregados, estado del equipo…) |
| creadoEn | DATETIME(3) | No | — | fecha y hora actual | Fecha y hora de registro |
| actualizadoEn | DATETIME(3) | No | — | — | Fecha y hora de la última modificación |

## Tabla `mantenimientos`

Historial y calendario de mantenimiento en una sola tabla.

| Campo | Tipo | Nulo | Llave | Por defecto | Descripción |
|---|---|---|---|---|---|
| id | INT | No | PK | autoincremental | Identificador del mantenimiento |
| equipoId | INT | No | FK → equipos.id | — | Equipo que recibe el mantenimiento |
| tipo | ENUM | No | — | — | PREVENTIVO o CORRECTIVO |
| estado | ENUM | No | — | PROGRAMADO | PROGRAMADO, REALIZADO o CANCELADO |
| fechaProgramada | DATE | Sí | — | — | Fecha planeada; obligatoria si el estado es PROGRAMADO |
| fechaRealizacion | DATE | Sí | — | — | Fecha en que se hizo; obligatoria si el estado es REALIZADO |
| descripcion | TEXT | No | — | — | Qué se hará o qué se hizo; no puede estar vacía |
| responsable | VARCHAR(100) | Sí | — | — | Quién lo realizó |
| creadoEn | DATETIME(3) | No | — | fecha y hora actual | Fecha y hora de registro |
| actualizadoEn | DATETIME(3) | No | — | — | Fecha y hora de la última modificación |

"Próximo" y "vencido" no se guardan. Se calculan comparando `fechaProgramada` con la fecha actual del hotel (zona America/Cancun), para que las notificaciones nunca queden desactualizadas.

## Tabla `bajas`

Acta de baja con el formato del hotel «Bajas de equipo operacional». Agrupa equipos del inventario y artículos sin número de serie. Es un documento firmado a mano: no se edita ni se borra.

| Campo | Tipo | Nulo | Llave | Por defecto | Descripción |
|---|---|---|---|---|---|
| id | INT | No | PK | autoincremental | Identificador del acta |
| folio | VARCHAR(20) | No | Única | — | Consecutivo por año que asigna la API: BAJA-2026-0001 |
| fechaBaja | DATE | No | — | — | Día de la baja; no puede ser futura ni anterior a la adquisición de sus equipos |
| elaboro | VARCHAR(100) | No | — | — | Quién capturó la baja en el sistema (no ocupa lugar de firma) |
| creadoEn | DATETIME(3) | No | — | fecha y hora actual | Fecha y hora de registro |

Al registrar un acta, en una sola transacción: sus equipos pasan a estado BAJA y guardan `bajaId` y `observacionBaja`, sus mantenimientos programados pasan a CANCELADO y se guardan sus artículos. No se puede dar de baja un equipo con asignación vigente.

## Tabla `bajas_articulos`

Renglón del acta para algo que no está en el inventario (baterías de UPS, tóners, baterías de radio…).

| Campo | Tipo | Nulo | Llave | Por defecto | Descripción |
|---|---|---|---|---|---|
| id | INT | No | PK | autoincremental | Identificador del renglón |
| bajaId | INT | No | FK → bajas.id | — | Acta a la que pertenece |
| descripcion | VARCHAR(150) | No | — | — | Qué se da de baja; no puede estar vacía |
| cantidad | INT | No | — | — | Mayor que cero |
| costo | DECIMAL(10,2) | Sí | — | — | Costo total del renglón en MXN (no por unidad); no negativo |
| aniosUso | INT | Sí | — | — | Años de uso, de 0 a 100 (0 = menos de un año) |
| observaciones | VARCHAR(255) | No | — | — | Motivo de la baja y condiciones |

## Tabla `usuarios`

Personas del Departamento de Sistemas que entran al sistema. No se borran: se desactivan.

| Campo | Tipo | Nulo | Llave | Por defecto | Descripción |
|---|---|---|---|---|---|
| id | INT | No | PK | autoincremental | Identificador del usuario |
| usuario | VARCHAR(40) | No | Única | — | Nombre para iniciar sesión: de 3 a 40 minúsculas sin acentos, números, punto, guion o guion bajo |
| nombre | VARCHAR(100) | No | — | — | Nombre completo que se muestra en pantalla |
| contrasenaHash | VARCHAR(100) | No | — | — | Hash bcrypt de la contraseña (la contraseña nunca se guarda) |
| rol | ENUM | No | — | TECNICO | ADMIN (incluye gestión de usuarios) o TECNICO |
| activo | BOOLEAN | No | — | verdadero | Falso cuando ya no debe entrar; se conserva el registro |
| intentosFallidos | INT | No | — | 0 | Contraseñas incorrectas seguidas; al llegar a 5 se bloquea |
| bloqueadoHasta | DATETIME(3) | Sí | — | — | Hasta cuándo dura el bloqueo por intentos fallidos |
| ultimoAcceso | DATETIME(3) | Sí | — | — | Fecha y hora del último inicio de sesión correcto |
| creadoEn | DATETIME(3) | No | — | fecha y hora actual | Fecha y hora de registro |
| actualizadoEn | DATETIME(3) | No | — | — | Fecha y hora de la última modificación |

## Tabla `sesiones`

Sesiones abiertas del sistema (las administra express-session). Guardarlas en la base permite reiniciar la API sin sacar a nadie y cerrar las sesiones de un usuario al desactivarlo o cambiarle la contraseña. No tiene `creadoEn` ni `actualizadoEn`: su vigencia la marca `expiraEn`.

| Campo | Tipo | Nulo | Llave | Por defecto | Descripción |
|---|---|---|---|---|---|
| id | VARCHAR(128) ascii_bin | No | PK | — | Identificador aleatorio que viaja firmado en la cookie; distingue mayúsculas |
| usuarioId | INT | Sí | FK → usuarios.id | — | Usuario dueño de la sesión |
| datos | TEXT | No | — | — | Contenido de la sesión en JSON |
| expiraEn | DATETIME(3) | No | — | — | Vence 12 horas después del último uso; las vencidas se borran cada hora |

## Índices

| Índice | Tabla | Columnas | Propósito |
|---|---|---|---|
| departamentos_nombre_key | departamentos | nombre | Único; evita departamentos duplicados |
| empleados_numeroEmpleado_key | empleados | numeroEmpleado | Único; un número por empleado |
| empleados_departamentoId_idx | empleados | departamentoId | Filtrar empleados por departamento |
| equipos_numeroSerie_key | equipos | numeroSerie | Único; búsqueda por número de serie |
| equipos_estado_idx | equipos | estado | Filtrar el inventario por estado |
| equipos_folioFactura_idx | equipos | folioFactura | Reunir los equipos de una misma factura en el reporte de alta |
| asignaciones_equipoId_fechaDevolucion_idx | asignaciones | equipoId, fechaDevolucion | Encontrar rápido la asignación vigente de un equipo |
| asignaciones_empleadoId_idx | asignaciones | empleadoId | Equipos que tiene o tuvo un empleado |
| mantenimientos_equipoId_idx | mantenimientos | equipoId | Historial de mantenimiento de un equipo |
| mantenimientos_estado_fechaProgramada_idx | mantenimientos | estado, fechaProgramada | Calendario y notificaciones (próximos y vencidos) |
| equipos_bajaId_idx | equipos | bajaId | Equipos de un acta de baja |
| bajas_folio_key | bajas | folio | Único; un folio por acta |
| bajas_fechaBaja_idx | bajas | fechaBaja | Listar las bajas de la más reciente a la más antigua |
| usuarios_usuario_key | usuarios | usuario | Único; buscar al usuario al iniciar sesión |
| sesiones_expiraEn_idx | sesiones | expiraEn | Borrar rápido las sesiones vencidas |
| sesiones_usuarioId_idx | sesiones | usuarioId | Cerrar todas las sesiones de un usuario |
| bajas_articulos_bajaId_idx | bajas_articulos | bajaId | Artículos de un acta |

## Restricciones de verificación (CHECK)

| Restricción | Tabla | Regla |
|---|---|---|
| chk_departamentos_nombre_no_vacio | departamentos | El nombre no puede estar vacío |
| chk_empleados_numero_no_vacio | empleados | El número de empleado no puede estar vacío |
| chk_empleados_nombre_no_vacio | empleados | El nombre no puede estar vacío |
| chk_empleados_apellidos_no_vacio | empleados | Los apellidos no pueden estar vacíos |
| chk_empleados_puesto_no_vacio | empleados | El puesto no puede estar vacío |
| chk_equipos_serie_no_vacia | equipos | El número de serie no puede estar vacío |
| chk_equipos_marca_no_vacia | equipos | La marca no puede estar vacía |
| chk_equipos_modelo_no_vacio | equipos | El modelo no puede estar vacío |
| chk_equipos_costo_no_negativo | equipos | El costo es nulo o mayor o igual a cero |
| chk_equipos_folio_no_vacio | equipos | El folio de factura es nulo o tiene texto |
| chk_equipos_garantia_posterior_adquisicion | equipos | La garantía no vence antes de la fecha de adquisición (si ambas existen) |
| chk_asignaciones_devolucion_posterior | asignaciones | La devolución no puede ser anterior a la asignación |
| chk_mantenimientos_descripcion_no_vacia | mantenimientos | La descripción no puede estar vacía |
| chk_mantenimientos_programado_con_fecha | mantenimientos | Si está PROGRAMADO debe tener fecha programada |
| chk_mantenimientos_realizado_con_fecha | mantenimientos | Si está REALIZADO debe tener fecha de realización |
| chk_equipos_acta_solo_en_baja | equipos | Un equipo ligado a un acta de baja debe estar en estado BAJA |
| chk_bajas_folio_no_vacio | bajas | El folio no puede estar vacío |
| chk_bajas_elaboro_no_vacio | bajas | Quien captura no puede estar vacío |
| chk_equipos_observacion_solo_con_acta | equipos | Un equipo con acta tiene motivo (no vacío); uno sin acta no tiene motivo |
| chk_bajas_articulos_descripcion_no_vacia | bajas_articulos | La descripción no puede estar vacía |
| chk_bajas_articulos_observaciones_no_vacias | bajas_articulos | El motivo no puede estar vacío |
| chk_bajas_articulos_cantidad_positiva | bajas_articulos | La cantidad es mayor que cero |
| chk_bajas_articulos_costo_no_negativo | bajas_articulos | El costo es nulo o mayor o igual a cero |
| chk_bajas_articulos_anios_validos | bajas_articulos | Los años de uso son nulos o están entre 0 y 100 |
| chk_usuarios_usuario | usuarios | El usuario tiene de 3 a 40 minúsculas sin acentos, números, punto, guion o guion bajo |
| chk_usuarios_intentos | usuarios | Los intentos fallidos no pueden ser negativos |

## Disparadores (triggers)

| Disparador | Tabla | Momento | Regla |
|---|---|---|---|
| trg_asignaciones_una_vigente_insert | asignaciones | Antes de insertar | Rechaza una nueva asignación vigente si el equipo ya tiene otra |
| trg_asignaciones_una_vigente_update | asignaciones | Antes de actualizar | Rechaza reabrir una asignación o moverla a un equipo que ya tiene una vigente |
| trg_bajas_no_borrar | bajas | Antes de borrar | Rechaza borrar un acta de baja (es un documento firmado) |
| trg_bajas_articulos_no_borrar | bajas_articulos | Antes de borrar | Rechaza borrar un renglón de un acta |

Se usan disparadores porque MariaDB no admite índices únicos condicionales (del tipo "único solo cuando la fecha de devolución está vacía").

## Normalización

El esquema está en tercera forma normal (3FN):

- **1FN:** cada columna guarda un solo valor y cada tabla tiene llave primaria.
- **2FN:** todas las llaves primarias son simples (`id`), por lo que no hay dependencias parciales.
- **3FN:** no hay dependencias transitivas. El departamento se separó en su propio catálogo en lugar de repetirse como texto en cada empleado, y los datos derivados (disponibilidad del equipo, tiempo de funcionamiento, mantenimientos próximos o vencidos) se calculan en lugar de guardarse.
