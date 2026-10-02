# Sistema de Gestión de Inventario y Mantenimiento de Equipos de Cómputo

Blue Bay Grand Esmeralda — Departamento de Sistemas. Prototipo (prueba de concepto) de ejecución local.

**Estado:** partes 1 a 5 de 6 terminadas — esquema de base de datos, Inicio + Inventario, Empleados + Departamentos + Asignaciones, Mantenimiento (calendario, historial y avisos), reporte imprimible de alta, y Bajas con su reporte imprimible.

| Capa | Tecnología |
|---|---|
| Backend | Node.js + Express 5, TypeScript, validación con zod |
| Acceso a datos | Prisma ORM 7 con el adaptador oficial de MariaDB |
| Base de datos | MariaDB (local) |
| Frontend | Vue 3 + Vite + Vue Router |
| Autenticación | bcrypt + express-session *(parte 6)* |
| Reportes imprimibles | PDFKit (alta y baja) |

## Requisitos

- Node.js 20.19 o superior (probado con Node 22).
- MariaDB 10.11 o superior (probado con 10.11; compatible con 11.x), o MySQL 8 (probado con el MySQL 8.0.30 de Laragon).

> **Con MySQL 8 (Laragon):** como trae activado el registro binario, el usuario `inventario` no puede crear los triggers de la migración hasta que, como `root`, se ejecute una sola vez:
> `SET PERSIST log_bin_trust_function_creators = 1;`
> Laragon debe estar encendido antes de correr la API o las pruebas.

## Encenderlo en el día a día

Con Laragon encendido, da **doble clic en `iniciar.bat`**. Revisa que MySQL esté encendido, abre la API y las pantallas (cada una en su ventana) y abre el navegador en http://localhost:5173. Para apagar el sistema, cierra esas dos ventanas.

La primera vez hay que hacer la puesta en marcha de abajo (usuario de MySQL, `.env` y migraciones).

## Puesta en marcha

### 1. Crear el usuario y las bases de datos (solo la primera vez)

Entra a MariaDB como administrador (`mariadb -u root -p`, o con HeidiSQL) y ejecuta:

```sql
CREATE USER IF NOT EXISTS 'inventario'@'localhost' IDENTIFIED BY 'inventario_dev';
GRANT ALL PRIVILEGES ON `inventario%`.* TO 'inventario'@'localhost';
CREATE DATABASE IF NOT EXISTS inventario;
CREATE DATABASE IF NOT EXISTS inventario_shadow;
FLUSH PRIVILEGES;
```

### 2. Backend

```bash
cd backend
cp .env.example .env          # en Windows (PowerShell): copy .env.example .env
npm install                   # también genera el cliente de Prisma
npx prisma migrate dev        # debe aplicar las migraciones SIN proponer una nueva
npm run db:seed               # datos ficticios DEMO (opcional)
npm run dev                   # API en http://127.0.0.1:3000/api
```

### 3. Frontend (en otra terminal)

```bash
cd frontend
npm install
npm run dev                   # abre http://localhost:5173
```

Vite reenvía las llamadas a `/api` hacia el backend, así que ambos deben estar encendidos.

### 4. Pruebas

```bash
cd backend && npm test        # 276 pruebas contra la base de datos real (base inventario_test)
cd frontend && npm test       # 134 pruebas de componentes y utilidades
```

## Estructura

```
inventario-equipos-bluebay/
├── backend/
│   ├── prisma/                    Esquema, migraciones y datos demo
│   ├── src/
│   │   ├── app.ts                 Aplicación Express (rutas y manejo de errores)
│   │   ├── servidor.ts            Arranque del servidor
│   │   ├── lib/                   Cliente de Prisma, errores, validación, fechas
│   │   └── modulos/               Inventario, empleados, departamentos, asignaciones, mantenimientos, bajas y reportes
│   └── tests/                     Pruebas del esquema y de la API
├── frontend/
│   ├── src/
│   │   ├── api/                   Cliente HTTP y funciones por módulo
│   │   ├── componentes/           BarraLateral, Encabezado, FormularioEquipo…
│   │   ├── composables/           Búsqueda de equipos, avisos flotantes y avisos de mantenimiento
│   │   ├── utilidades/            Formato, validación y calendario
│   │   ├── vistas/                Inicio, Inventario, Ficha, Empleados, Mantenimiento, Bajas…
│   │   └── estilos/base.css       Tokens del diseño aprobado
│   └── tests/
└── docs/
    ├── diccionario-de-datos.md    Para el capítulo 3 de la Memoria
    ├── diagrama-er.mermaid        Diagrama entidad-relación
    └── api.md                     Referencia de la API
```

## Decisiones de diseño

- **La baja es lógica y sigue el formato del hotel.** El acta «Bajas de equipo operacional» junta equipos del inventario (cada uno con su motivo) y artículos sin número de serie (baterías, tóners…). El equipo cambia a estado `BAJA` y nunca se borra; no se da de baja un equipo asignado, y sus mantenimientos programados se cancelan. Las firmas se hacen a mano en el papel.
- **Doble barrera de validación.** El navegador avisa antes de enviar, la API valida todo con zod (mismos mensajes) y la base de datos repite las reglas críticas con CHECK y triggers.
- **Los datos derivados no se guardan.** Disponibilidad, tiempo de funcionamiento y avisos se calculan al consultar.
- **Números de serie normalizados.** Sin espacios y en mayúsculas, al guardar y al buscar. Un lector de código de barras abre la ficha directamente.
- **Fechas estrictas y hora del hotel.** Las fechas se validan como texto (el 30 de febrero se rechaza) y "hoy" se calcula con la zona America/Cancun.
- **Nada se borra.** Un empleado que deja el hotel se desactiva; conserva su historial y no se le pueden asignar equipos.
- **Los filtros viven en la dirección.** `/inventario?asignacion=libres` o `/mantenimiento?mes=2026-10` se pueden guardar como favorito y el botón Atrás funciona.
- **Avisos de mantenimiento a 7 días.** "Vencido" y "próximo" se calculan al consultar con la fecha del hotel, así que nunca quedan desactualizados. El estado del equipo y el siguiente preventivo se manejan a mano.
