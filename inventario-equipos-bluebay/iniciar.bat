@echo off
rem =====================================================================
rem  Enciende el sistema de inventario con doble clic:
rem    1. Revisa que MySQL (Laragon) este encendido.
rem    2. Abre la API (backend) y las pantallas (frontend), cada una en
rem       su ventana. Para apagar el sistema, cierra esas dos ventanas.
rem    3. Abre el navegador en http://localhost:5173
rem =====================================================================
chcp 65001 >nul
title Inventario Blue Bay
cd /d "%~dp0"

echo Revisando que MySQL de Laragon este encendido...
powershell -NoProfile -Command "$c = New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1', 3306); exit 0 } catch { exit 1 } finally { $c.Dispose() }"
if errorlevel 1 (
  echo.
  echo  MySQL no esta encendido.
  echo  Abre Laragon, presiona "Iniciar todo" y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

if not exist "backend\node_modules" (
  echo Instalando dependencias del backend, solo la primera vez...
  call npm --prefix backend install || goto :error
)
if not exist "frontend\node_modules" (
  echo Instalando dependencias del frontend, solo la primera vez...
  call npm --prefix frontend install || goto :error
)

echo Encendiendo la API y las pantallas...
start "API del inventario (no cerrar)" /d "%~dp0backend" cmd /k npm run dev
start "Pantallas del inventario (no cerrar)" /d "%~dp0frontend" cmd /k npm run dev

echo Esperando a que las pantallas esten listas...
powershell -NoProfile -Command "for ($i = 0; $i -lt 60; $i++) { $c = New-Object Net.Sockets.TcpClient; try { $c.Connect('localhost', 5173); exit 0 } catch { Start-Sleep -Milliseconds 500 } finally { $c.Dispose() } }; exit 1"
if errorlevel 1 (
  echo Las pantallas tardaron demasiado. Revisa la ventana "Pantallas del inventario".
  pause
  exit /b 1
)

start "" http://localhost:5173
echo Listo. Ya puedes cerrar esta ventana.
timeout /t 4 >nul
exit /b 0

:error
echo No se pudieron instalar las dependencias. Revisa tu conexion a internet.
pause
exit /b 1
