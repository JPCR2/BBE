# API del sistema (referencia)

Base: `/api`. Todas las respuestas son JSON. Implementada con Express 5 y validación con zod.

## Formato de errores

```json
{ "error": { "codigo": "DATOS_INVALIDOS", "mensaje": "Revisa los datos marcados.", "campos": { "marca": "Escribe la marca." } } }
```

| Estado | Código | Cuándo |
|---|---|---|
| 400 | DATOS_INVALIDOS | Un campo falta o no cumple una regla; `campos` trae un mensaje por campo |
| 400 | JSON_INVALIDO | El cuerpo de la petición no es JSON válido |
| 404 | NO_ENCONTRADO / RUTA_NO_ENCONTRADA | El registro o la ruta no existen |
| 409 | NUMERO_SERIE_DUPLICADO / DUPLICADO | Ya existe un registro con ese valor único |
| 409 | EQUIPO_DADO_DE_BAJA | Se intentó modificar un equipo dado de baja |
| 409 | ASIGNACION_VIGENTE | El equipo ya tiene una asignación vigente |
| 409 | ASIGNACION_YA_DEVUELTA | Esa asignación ya tiene registrada la devolución |
| 409 | EQUIPO_NO_ASIGNABLE | El equipo está en mantenimiento o dado de baja |
| 409 | EMPLEADO_INACTIVO | El empleado está desactivado |
| 409 | EMPLEADO_CON_EQUIPOS | Se intentó desactivar a alguien que todavía tiene equipos |
| 409 | NUMERO_EMPLEADO_DUPLICADO / DEPARTAMENTO_DUPLICADO | Ya existe ese número de empleado o ese departamento |
| 409 | MANTENIMIENTO_YA_REALIZADO | Se intentó cerrar, reprogramar o cancelar un mantenimiento ya realizado |
| 409 | MANTENIMIENTO_CANCELADO | Se intentó cerrar, reprogramar o cancelar un mantenimiento cancelado |
| 409 | EQUIPO_YA_DADO_DE_BAJA | Se intentó dar de baja un equipo que ya lo está (el mensaje dice con qué folio) |
| 409 | EQUIPO_ASIGNADO | Se intentó dar de baja un equipo asignado; primero se registra la devolución |
| 409 | EQUIPOS_CAMBIARON | Un equipo cambió (lo asignaron o lo dieron de baja) mientras se registraba la baja; no se hizo nada |
| 409 | BAJA_PERMANENTE | Se intentó borrar un acta de baja |
| 500 | ERROR_INTERNO | Error inesperado (se registra en la consola del servidor) |

## Inventario (parte 2)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/equipos` | Listado paginado. Parámetros: `busqueda`, `tipo`, `estado`, `asignacion` (`todos`, `asignados`, `libres`), `pagina`, `porPagina` (máx. 100). Devuelve `datos`, `total`, `pagina`, `porPagina` y `conteos` para los filtros rápidos. No incluye equipos dados de baja salvo con `estado=BAJA`. Cada equipo trae `avisoMantenimiento` (`{ situacion: VENCIDO\|PROXIMO, fecha }` o `null`). |
| GET | `/equipos/serie/:numeroSerie` | Búsqueda exacta por número de serie (buscador y lector de código de barras). Se normaliza igual que al guardar. |
| GET | `/equipos/:id` | Ficha: datos, costo, fecha de adquisición, tiempo de funcionamiento, historial de asignaciones y mantenimientos. |
| POST | `/equipos` | Alta. Obligatorios: `numeroSerie` (número de serie o Service Tag), `tipo`, `marca`, `modelo`, `folioFactura` (máx. 50) y `fechaVencimientoGarantia` (AAAA-MM-DD, no anterior a la adquisición). Opcionales: `ubicacion`, `especificaciones`, `fechaAdquisicion` (AAAA-MM-DD, no futura), `costo` (hasta 8 enteros y 2 decimales). El estado no se envía: todo equipo nuevo queda ACTIVO. Responde 201. |
| PATCH | `/equipos/:id` | Edición parcial de los mismos campos; aquí el folio y la garantía son opcionales (equipos anteriores al sistema). La garantía se compara con la fecha de adquisición que quedará guardada. `estado` solo acepta ACTIVO o EN_MANTENIMIENTO; la baja se registra en su propio módulo. |
| GET | `/resumen` | Conteos de Inicio: equipos, asignados, sin asignar y en mantenimiento. |
| GET | `/salud` | Comprueba que la API está encendida. |

### Reglas de búsqueda

- Cada palabra escrita debe aparecer en el número de serie, la marca, el modelo o el folio de factura ("dell latitude", "FAC-A-10234").
- No distingue mayúsculas, minúsculas ni acentos.
- `%` y `_` se buscan como texto normal (no son comodines).

## Empleados y departamentos (parte 3)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/departamentos` | Catálogo en orden alfabético, con cuántos empleados activos tiene cada uno. |
| POST | `/departamentos` | Alta. No admite nombres repetidos, aunque cambien acentos o mayúsculas. |
| PATCH | `/departamentos/:id` | Renombra el departamento. |
| GET | `/empleados` | Listado paginado. Parámetros: `busqueda` (nombre, apellidos, número o puesto), `departamentoId`, `estado` (`activos`, `inactivos`, `todos`), `pagina`, `porPagina`. Devuelve también `conteos` de activos e inactivos, y cuántos equipos tiene asignados cada persona. |
| GET | `/empleados/:id` | Ficha: datos, equipos vigentes e historial completo de asignaciones. |
| POST | `/empleados` | Alta. Obligatorios: `numeroEmpleado`, `nombre`, `apellidos`, `puesto`, `departamentoId`. Queda activo. |
| PATCH | `/empleados/:id` | Edición parcial, incluido `activo`. **No se puede desactivar a alguien que todavía tiene equipos asignados** (409 EMPLEADO_CON_EQUIPOS). |

## Asignaciones (parte 3)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/asignaciones` | Entrega un equipo a un empleado (`equipoId`, `empleadoId`, `observaciones` opcional). Solo equipos en estado ACTIVO y empleados activos, y solo si el equipo no tiene otra asignación vigente. Responde 201 con la asignación y el equipo actualizado. |
| POST | `/asignaciones/:id/devolucion` | Registra la devolución con la fecha y hora del momento, y guarda `observaciones` de cómo regresó el equipo. El equipo queda disponible. |

### Reglas de asignación

- Un equipo solo puede tener una asignación vigente a la vez; el historial se conserva completo.
- Un empleado sí puede tener varios equipos al mismo tiempo.
- La devolución nunca queda registrada antes de la entrega.

## Mantenimiento (parte 4)

Cada mantenimiento se devuelve con su `situacion`, calculada contra la fecha de hoy en el hotel (zona America/Cancun), nunca guardada:

| Situación | Cuándo |
|---|---|
| VENCIDO | Programado y su fecha ya pasó |
| PROXIMO | Programado para hoy o los próximos 7 días |
| PROGRAMADO | Programado para dentro de más de 7 días |
| REALIZADO / CANCELADO | Igual que su estado |

También trae `fecha` (la fecha con la que aparece en el calendario: la de realización si ya se hizo, si no la programada), `diasRestantes` (negativo = días de retraso; solo si sigue programado) y los datos básicos del `equipo`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/mantenimientos` | Historial paginado. Parámetros: `equipoId`, `estado`, `tipo`, `busqueda` (número de serie), `pagina`, `porPagina` (máx. 100). Orden: programados, realizados y cancelados; dentro de cada grupo, lo más reciente primero. |
| GET | `/mantenimientos/calendario?mes=AAAA-MM` | Todo lo que se ve en la cuadrícula de ese mes (semanas completas de lunes a domingo, así que incluye los días visibles de los meses vecinos; el rango va en `desde` y `hasta`), ordenado por `fecha`. Sin `mes`, el mes actual del hotel. |
| GET | `/mantenimientos/avisos` | Para Inicio y la campana: `vencidos` y `proximos` (7 días), sin equipos dados de baja. |
| GET | `/mantenimientos/:id` | Un mantenimiento. |
| POST | `/mantenimientos` | Programar: `equipoId`, `tipo` (PREVENTIVO o CORRECTIVO), `descripcion`, `fechaProgramada` (hoy o después), `responsable` opcional. Con `estado: "REALIZADO"` y `fechaRealizacion` (hoy o antes) registra uno que ya se hizo. Responde 201. |
| PATCH | `/mantenimientos/:id` | Reprogramar o corregir uno programado: `fechaProgramada` (hoy o después), `tipo`, `descripcion`, `responsable`. |
| POST | `/mantenimientos/:id/realizado` | Lo cierra. `fechaRealizacion` (por defecto hoy; no futura), `responsable` y `descripcion` (lo que realmente se hizo) opcionales. |
| POST | `/mantenimientos/:id/cancelacion` | Lo cancela; se conserva en el historial. |

### Reglas de mantenimiento

- Solo un mantenimiento programado se puede cerrar, reprogramar o cancelar; no se cierra dos veces.
- Las fechas se validan como texto: el 30 de febrero o "15/10/2026" se rechazan.
- Un equipo dado de baja no admite mantenimientos nuevos ni reprogramaciones.
- Registrar o programar un mantenimiento **no** cambia el estado del equipo, y al cerrar un preventivo **no** se programa el siguiente: ambas cosas se hacen a mano (decisión del Departamento de Sistemas).

## Reporte de alta (parte 4b)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/reportes/alta?ids=1,2,3` | PDF imprimible (carta) con el logo del hotel. Una fila por equipo con modelo, número de serie / Service Tag, costo, folio de factura y vencimiento de la garantía; costo total y firmas de «Elaboró» y «Autorizó». Máximo 100 equipos; los ids repetidos se ignoran. Si un equipo no tiene un dato, aparece «—». Responde 404 indicando qué ids no existen. |

## Bajas (parte 5)

El acta sigue el formato del hotel «Bajas de equipo operacional». Cada renglón lleva su propio motivo y condiciones (`observaciones`). Un acta puede incluir equipos del inventario y artículos sin número de serie (baterías, tóners…). Trae `folio`, `fechaBaja`, `elaboro` (quién capturó), `costoTotal`, `equipos` (con `fechaAdquisicion`, `costo`, `tiempoFuncionamiento` hasta el día de la baja y `observaciones`) y `articulos` (`descripcion`, `cantidad`, `costo`, `aniosUso`, `observaciones`).

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/bajas` | Actas de la más reciente a la más antigua. Parámetros: `busqueda` (folio, número de serie o descripción de un artículo), `pagina`, `porPagina` (máx. 100). |
| GET | `/bajas/:id` | Un acta con sus renglones. |
| POST | `/bajas` | Registrar: `equipos` (lista de `{ id, observaciones }`, máx. 100; un id repetido cuenta una vez), `articulos` (lista de `{ descripcion, cantidad, costo?, aniosUso?, observaciones }`, máx. 50), `fechaBaja` (hoy o antes) y `elaboro`. Debe haber al menos un equipo o un artículo. Los errores de un renglón llegan como `equipos.0.observaciones` o `articulos.1.cantidad`. Responde 201 con el acta y `mantenimientosCancelados`. |
| GET | `/reportes/baja/:id` | PDF en hoja carta horizontal con el formato del hotel: razón social, fecha (09-abr-26), folio y la tabla DEPTO / DESCRIPCIÓN / CANTIDAD / COSTO / TIEMPO DE USO / OBSERVACIONES. Los equipos iguales con el mismo motivo se juntan en un renglón con su cantidad y sus números de serie. Espacios para firmar: jefe departamental, contralor de costos (recibe), director (autorización) y contralor general (Vo. Bo.). |

### Reglas de baja

- Todo o nada: si un equipo no existe, ya está dado de baja o está asignado, no se guarda nada (ni los artículos).
- No se puede dar de baja un equipo con asignación vigente: primero se registra la devolución.
- La fecha de baja no puede ser futura ni anterior a la fecha de adquisición de sus equipos.
- Los equipos pasan a BAJA con su motivo y sus mantenimientos programados se cancelan; el historial se conserva.
- El folio es un consecutivo por año de la fecha de baja (BAJA-2026-0001). Si dos bajas se registran al mismo tiempo, cada una recibe su propio folio.
- Un equipo dado de baja ya no se edita, no se asigna ni se le programa mantenimiento, y sale del inventario y de los conteos de Inicio (se consulta con `/equipos?estado=BAJA`).
- Las actas y sus renglones no se editan ni se borran (la base de datos lo impide con triggers).
