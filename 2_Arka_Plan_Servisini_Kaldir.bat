@echo off
chcp 65001 >nul
title Opera DPI Eklentisi - Yerel Motoru Kaldir

echo ========================================================
echo   OPERA DPI YEREL MOTORU KALDIRILIYOR...
echo ========================================================
echo.

echo [1/2] Arka plan surecleri durduruluyor...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*bridge.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
taskkill /F /IM ciadpi.exe >nul 2>&1

echo [2/2] Windows baslangic kaydi siliniyor...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "ByeDPI_DoH_Bridge" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v "AutoConfigURL" /f >nul 2>&1

echo.
echo ========================================================
echo   YEREL MOTOR TAMAMEN DURDURULDU VE KALDIRILDI.
echo ========================================================
pause
