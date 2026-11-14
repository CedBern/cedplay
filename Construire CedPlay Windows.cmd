@echo off
rem Construit CedPlay pour Windows (installateur + ZIP) puis le verifie.
rem Journal complet : preuves\desktop-windows-1.12.64\reconstruction.log
setlocal
cd /d "%~dp0"
set "PROOF=%~dp0preuves\desktop-windows-1.12.64"
set "LOG=%PROOF%\reconstruction.log"
set "RC_OVERALL=0"
if not exist "%PROOF%" mkdir "%PROOF%"
echo CedPlay Windows - reconstruction %DATE% %TIME% > "%LOG%"

echo [1/4] Tests serveur, runtime et paquet...
echo ===== [1/4] TESTS >> "%LOG%"
node --test desktop\desktop.test.mjs desktop\audit-regression.test.mjs desktop\electron-runtime.test.mjs desktop\windows\packaging.test.mjs >> "%LOG%" 2>&1
set "RC_TESTS=%ERRORLEVEL%"
echo RC_TESTS=%RC_TESTS% >> "%LOG%"
if not "%RC_TESTS%"=="0" (
  set "RC_OVERALL=%RC_TESTS%"
  goto :fin
)

echo [2/4] Construction de l'installateur et du ZIP (quelques minutes)...
echo ===== [2/4] DIST >> "%LOG%"
pushd desktop\windows
call npm run dist >> "%LOG%" 2>&1
set "RC_DIST=%ERRORLEVEL%"
popd
echo RC_DIST=%RC_DIST% >> "%LOG%"
if not "%RC_DIST%"=="0" (
  set "RC_OVERALL=%RC_DIST%"
  goto :fin
)

echo [3/4] Parcours E2E sur l'application construite...
echo ===== [3/4] E2E >> "%LOG%"
set "CEDPLAY_E2E_APP_EXE=%~dp0dist-desktop\win-unpacked\CedPlay.exe"
set "CEDPLAY_E2E_SCREENSHOT_DIR=%PROOF%\reconstruction-e2e"
node desktop\e2e-verify.mjs >> "%LOG%" 2>&1
set "RC_E2E=%ERRORLEVEL%"
echo RC_E2E=%RC_E2E% >> "%LOG%"
if not "%RC_E2E%"=="0" (
  set "RC_OVERALL=%RC_E2E%"
  goto :fin
)

echo [4/4] Empreintes des livrables...
echo ===== [4/4] SHA256 >> "%LOG%"
for %%F in ("dist-desktop\CedPlay-*-Setup.exe" "dist-desktop\CedPlay-*-Windows-x64.zip") do (
  echo %%~nxF %%~zF octets >> "%LOG%"
  certutil -hashfile "%%~fF" SHA256 | findstr /r "^[0-9a-fA-F][0-9a-fA-F]*$" >> "%LOG%"
)

:fin
echo ===== FIN RC=%RC_OVERALL% >> "%LOG%"
echo.
if not "%RC_OVERALL%"=="0" (
  echo Echec ^(code %RC_OVERALL%^). Journal : %LOG%
) else (
  echo Termine. Journal : %LOG%
)
echo Cette fenetre se fermera dans 15 secondes.
timeout /t 15 >nul
endlocal & exit /b %RC_OVERALL%
