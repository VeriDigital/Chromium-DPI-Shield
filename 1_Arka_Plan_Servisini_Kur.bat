@echo off
chcp 65001 >nul
title DPI Shield - Yerel Motor Kurulumu

echo ========================================================
echo   DPI SHIELD YEREL MOTORU KURULUYOR...
echo   (Tum PC proxy ayarina DOKUNULMAZ, sadece Tarayici!)
echo ========================================================
echo.

set "TARGET_DIR=%LOCALAPPDATA%\ByeDPI"
set "SRC_DIR=%~dp0dosyalar"

echo [1/4] Eski surecler temizleniyor...
taskkill /F /IM ciadpi.exe >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*bridge.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo [2/4] Dosyalar %TARGET_DIR% klasorune kopyalaniyor...
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"
copy /Y "%SRC_DIR%\ciadpi.exe" "%TARGET_DIR%\ciadpi.exe" >nul
copy /Y "%SRC_DIR%\bridge.mjs" "%TARGET_DIR%\bridge.mjs" >nul
copy /Y "%SRC_DIR%\start_invisible.vbs" "%TARGET_DIR%\start_invisible.vbs" >nul

echo [3/4] Windows genel proxy ayarlari temizleniyor (Sadece Eklenti yonetecek)...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v "AutoConfigURL" /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v "ProxyEnable" /t REG_DWORD /d 0 /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "ByeDPI_DoH_Bridge" /t REG_SZ /d "wscript.exe \"%TARGET_DIR%\start_invisible.vbs\"" /f >nul

echo [4/4] Eklenti dinleyici servisi baslatiliyor...
wscript.exe "%TARGET_DIR%\start_invisible.vbs"

echo.
echo ========================================================
echo   YEREL MOTOR HAZIR!
echo   Simdi tarayicinizda uzantilar sayfasini acip
echo   (opera://extensions veya chrome://extensions)
echo   'DPI-Shield-Extension' klasorunu yukleyebilirsiniz.
echo ========================================================
pause
