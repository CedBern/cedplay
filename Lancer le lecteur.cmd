@echo off
title CedPlay
cd /d "%~dp0application"
if not exist "node_modules\.bin\vite.cmd" (
  echo Les dependances doivent etre installees. Voir CURRENT_MISSION.md.
  pause
  exit /b 1
)
start "Proxy IPTV" /min node proxy-server.mjs
call corepack pnpm dev -- --open
echo Si le port est deja occupe, ouvrez http://127.0.0.1:5178/
pause
