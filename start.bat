@echo off
setlocal
title MALUS DOMESTICA - Local Server
cd /d "%~dp0"

REM Keep localhost out of any system HTTP proxy.
set "NO_PROXY=127.0.0.1,localhost"
set "no_proxy=127.0.0.1,localhost"
set "URL=http://127.0.0.1:5173"

echo.
echo   ==========================================================
echo      MALUS DOMESTICA  /  Apple Tree Digital Twin
echo   ==========================================================
echo.

REM --- Is a server already listening on 5173? ---
netstat -ano -p tcp | findstr ":5173" | findstr "LISTENING" >nul 2>nul
if %errorlevel%==0 goto ALREADY

REM --- Locate Node.js ---
where node >nul 2>nul
if %errorlevel%==0 goto HAVE_NODE
if exist "%ProgramFiles%\nodejs\node.exe" (
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
  goto HAVE_NODE
)
goto NO_NODE

:HAVE_NODE
echo   Server : http://127.0.0.1:5173
echo   Runtime: Node.js
echo.
echo   KEEP THIS WINDOW OPEN while using the app.
echo   Press Ctrl+C or close this window to stop the server.
echo.
echo   Opening browser...
echo   (If the browser shows a proxy error, add 127.0.0.1 to the proxy bypass list.)
start "" "%URL%"
echo.
node server.mjs
echo.
echo   [SERVER EXITED] code=%errorlevel%
echo   Read the message above. If port 5173 is busy, close the other
echo   server window, or run:  set PORT=5174 ^&^& node server.mjs
echo.
pause
exit /b 0

:NO_NODE
where python >nul 2>nul
if %errorlevel%==0 goto HAVE_PY
echo   [ERROR] Node.js was not found in PATH.
echo.
echo   Install Node.js 18+ from https://nodejs.org and run this again.
echo   Or open a terminal in this folder and type:  node server.mjs
echo.
echo   (.mjs files are NOT double-clickable - they must be run by node.)
echo.
pause
exit /b 1

:HAVE_PY
echo   [FALLBACK] Node.js not found - using Python static server.
echo   The 3D app works fully. Only the /api/ai server proxy is disabled;
echo   direct AI connections in the settings dialog still work.
echo.
echo   KEEP THIS WINDOW OPEN while using the app.
echo.
start "" "%URL%"
echo.
python -m http.server 5173 --bind 127.0.0.1
echo.
echo   [SERVER EXITED] code=%errorlevel%
pause
exit /b 0

:ALREADY
echo   A server is already running on port 5173.
echo   Opening browser: %URL%
echo.
start "" "%URL%"
echo   Done. The existing server window keeps running.
echo   You can close THIS window now.
echo.
pause
exit /b 0
