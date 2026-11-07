@echo off
title Construction de l'APK - CedPlay
cd /d "%~dp0application"

set "JAVA_HOME=C:\Program Files\Java\jdk-17"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "PATH=%JAVA_HOME%\bin;%PATH%"

echo 1/3 Compilation web...
call corepack pnpm build
if %ERRORLEVEL% NEQ 0 (
  echo Erreur lors de la compilation web.
  pause
  exit /b 1
)

echo 2/3 Synchronisation des fichiers Android (Capacitor)...
call corepack pnpm exec cap sync android
if %ERRORLEVEL% NEQ 0 (
  echo Erreur lors de la synchronisation Capacitor.
  pause
  exit /b 1
)

echo 3/3 Generation du package APK (release minifiee)...
cd android
call gradlew.bat assembleRelease
if %ERRORLEVEL% NEQ 0 (
  echo Erreur lors de la compilation Gradle.
  pause
  exit /b 1
)

copy /y "%~dp0application\android\app\build\outputs\apk\release\app-release.apk" "%~dp0CedPlay.apk" >nul
copy /y "%~dp0CedPlay.apk" "%~dp0Lecteur-IPTV.apk" >nul
echo.
echo ========================================================
echo APK genere avec succes !
echo Emplacement : %~dp0CedPlay.apk
echo ========================================================
pause
