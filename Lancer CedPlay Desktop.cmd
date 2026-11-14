@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0CedPlay.exe" (
  start "" "%~dp0CedPlay.exe"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process node -ArgumentList 'desktop/server.mjs' -WindowStyle Hidden"
  timeout /t 2 /nobreak >nul
  if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app="http://127.0.0.1:4178/?desktop=1" --user-data-dir="%LOCALAPPDATA%\CedPlay\DesktopProfile" --window-size=1280,720
  ) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" --app="http://127.0.0.1:4178/?desktop=1" --user-data-dir="%LOCALAPPDATA%\CedPlay\DesktopProfile" --window-size=1280,720
  ) else (
    start "" "msedge.exe" --app="http://127.0.0.1:4178/?desktop=1" --user-data-dir="%LOCALAPPDATA%\CedPlay\DesktopProfile" --window-size=1280,720
  )
)
