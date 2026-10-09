# Sistema de Gestión de Inventario y Mantenimiento de Equipos de Cómputo

Blue Bay Grand Esmeralda — Departamento de Sistemas. Prototipo (prueba de concepto) de ejecución local.

**Estado:** las 6 partes terminadas — esquema de base de datos, Inicio + Inventario, Empleados + Departamentos + Asignaciones, Mantenimiento (calendario, historial y avisos), reporte imprimible de alta, Bajas con su reporte imprimible, e inicio de sesión con usuarios y roles.

| Capa | Tecnología |
|---|---|
| Backend | Node.js + Express 5, TypeScript, validación con zod |
| Acceso a datos | Prisma ORM 7 con el adaptador oficial de MariaDB |
| Base de datos | MariaDB (local) |
| Frontend | Vue 3 + Vite + Vue Router |
| Autenticación | bcrypt (bcryptjs) + express-session, sesiones guardadas en la base |
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
npm run usuario:admin         # crea tu usuario ADMINISTRADOR (pide usuario, nombre y contraseña)
npm run dev                   # API en http://127.0.0.1:3000/api
```

En el `.env` pon en `SESION_SECRETO` una clave larga y al azar (el `.env.example` dice cómo generarla). Si falta, la API funciona, pero cada reinicio cierra todas las sesiones.

### 3. Frontend (en otra terminal)

```bash
cd frontend
npm install
npm run dev                   # abre http://localhost:5173
```

Vite reenvía las llamadas a `/api` hacia el backend, así que ambos deben estar encendidos.

### 4. Pruebas

```bash
cd backend && npm test        # 338 pruebas contra la base de datos real (base inventario_test)
cd frontend && npm test       # 178 pruebas de componentes y utilidades
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
│   │   └── modulos/               Autenticación, usuarios, inventario, empleados, departamentos, asignaciones, mantenimientos, bajas y reportes
│   ├── scripts/crear-admin.ts     npm run usuario:admin (crear o recuperar un administrador)
│   └── tests/                     Pruebas del esquema y de la API
├── frontend/
│   ├── src/
│   │   ├── api/                   Cliente HTTP y funciones por módulo
│   │   ├── componentes/           BarraLateral, Encabezado, FormularioEquipo…
│   │   ├── composables/           Sesión, búsqueda de equipos, avisos flotantes y avisos de mantenimiento
│   │   ├── utilidades/            Formato, validación y calendario
│   │   ├── vistas/                Inicio de sesión, Inicio, Inventario, Ficha, Empleados, Mantenimiento, Bajas, Usuarios…
│   │   └── estilos/base.css       Tokens del diseño aprobado
│   └── tests/
└── docs/
    ├── diccionario-de-datos.md    Para el capítulo 3 de la Memoria
    ├── diagrama-er.mermaid        Diagrama entidad-relación
    └── api.md                     Referencia de la API
```

## Usuarios y acceso

- **Dos roles.** *Técnico*: inventario, empleados, asignaciones, mantenimiento y bajas. *Administrador*: todo lo anterior y además la sección **Usuarios** (crear, editar, restablecer contraseña, desactivar).
- **El primer administrador** se crea en la consola con `npm run usuario:admin` (dentro de `backend`). El mismo comando sirve para **recuperar el acceso** si se olvida la contraseña del administrador: al escribir un usuario que ya existe, le pone la contraseña nueva, lo activa, le quita el bloqueo y lo deja como administrador.
- **La sesión dura hasta cerrar el navegador.** Además, el servidor la cierra si pasan 12 horas sin usarla (algunos navegadores "reviven" la sesión al restaurar pestañas).
- **Bloqueo por intentos fallidos.** Tras 5 contraseñas incorrectas seguidas el usuario queda bloqueado 15 minutos; un administrador puede desbloquearlo antes restableciéndole la contraseña.
- **Las contraseñas no se guardan:** solo su hash bcrypt. Mínimo 8 caracteres. Al cambiar la contraseña propia se cierran las sesiones abiertas en otras computadoras.
- **Los usuarios no se borran, se desactivan.** Al desactivar a alguien se cierran sus sesiones de inmediato. Un administrador no puede desactivarse ni quitarse el rol a sí mismo, así que siempre queda al menos uno.

## Publicar la demo en internet (Render + Aiven, gratis)

La demo vive en cuentas personales, **separada de todo lo del hotel**: no se conecta a su red ni a sus sistemas, y solo lleva **datos ficticios**. Ninguno de los dos servicios pide tarjeta, así que no puede haber cobros.

| Pieza | Servicio | Plan |
|---|---|---|
| Pantallas + API (un solo sitio con HTTPS) | [Render](https://render.com) | Free: se "duerme" tras 15 min sin visitas; la primera carga tarda ~1 min |
| Base de datos MySQL | [Aiven](https://aiven.io) | Free: 1 GB, conexión cifrada obligatoria |

### 1. Base de datos en Aiven

1. Crea la cuenta y un servicio **MySQL** con el plan **Free**.
2. Copia `backend/.env.nube.example` como `backend/.env.nube` y pega ahí la **Service URI** (como `DATABASE_URL`, quitando `?ssl-mode=REQUIRED`) y el **CA certificate** (como `DATABASE_CA`).
3. Desde la carpeta `backend`, en tu computadora:

```bash
npm run nube:migrar     # crea las tablas en Aiven (no borra nada)
npm run nube:demo       # carga los datos ficticios DEMO
npm run nube:admin      # crea tu usuario administrador de la demo
```

### 2. Sitio en Render

1. Crea la cuenta (puedes entrar con GitHub) → **New → Blueprint** → elige el repositorio. Render lee `render.yaml`.
2. Te pedirá dos valores: `DATABASE_URL` y `DATABASE_CA`, los mismos de `.env.nube`. `SESION_SECRETO` lo genera Render solo.
3. Al terminar te da la dirección (`https://inventario-bluebay-demo.onrender.com` o parecida). Cada `git push` a `main` vuelve a publicar.

### Qué cambia en internet (modo producción)

- La misma API sirve las pantallas compiladas: un solo sitio, sin Vite.
- La cookie de sesión solo viaja por HTTPS (`Secure`) y la API confía en la IP que manda el proxy de Render.
- Encabezados de seguridad con `helmet` y límite de 30 intentos de inicio de sesión por IP cada 15 minutos (además del bloqueo por usuario).
- Sin `SESION_SECRETO` la API no arranca.
- Al arrancar aplica las migraciones pendientes con `prisma migrate deploy` (nunca `migrate dev`, que puede borrar datos).
- La pantalla de inicio de sesión y la barra lateral avisan que es una **versión de demostración con datos ficticios**.

## Decisiones de diseño

- **La baja es lógica y sigue el formato del hotel.** El acta «Bajas de equipo operacional» junta equipos del inventario (cada uno con su motivo) y artículos sin número de serie (baterías, tóners…). El equipo cambia a estado `BAJA` y nunca se borra; no se da de baja un equipo asignado, y sus mantenimientos programados se cancelan. Las firmas se hacen a mano en el papel.
- **Doble barrera de validación.** El navegador avisa antes de enviar, la API valida todo con zod (mismos mensajes) y la base de datos repite las reglas críticas con CHECK y triggers.
- **Los datos derivados no se guardan.** Disponibilidad, tiempo de funcionamiento y avisos se calculan al consultar.
- **Números de serie normalizados.** Sin espacios y en mayúsculas, al guardar y al buscar. Un lector de código de barras abre la ficha directamente.
- **Fechas estrictas y hora del hotel.** Las fechas se validan como texto (el 30 de febrero se rechaza) y "hoy" se calcula con la zona America/Cancun.
- **Nada se borra.** Un empleado que deja el hotel se desactiva; conserva su historial y no se le pueden asignar equipos.
- **Los filtros viven en la dirección.** `/inventario?asignacion=libres` o `/mantenimiento?mes=2026-10` se pueden guardar como favorito y el botón Atrás funciona.
- **Avisos de mantenimiento a 7 días.** "Vencido" y "próximo" se calculan al consultar con la fecha del hotel, así que nunca quedan desactualizados. El estado del equipo y el siguiente preventivo se manejan a mano.
