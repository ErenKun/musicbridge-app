@echo off
title MusicBridge PC Core - Eren Teknoloji
cd /d "%~dp0"
echo =============================================================
echo   MusicBridge PC Core - Eren Teknoloji
echo =============================================================
echo.
echo [1] Konsol Penceresinde Baslat (Canli Loglar)
echo [2] Arka Planda Sessiz Baslat (Sifir Pencere / Gizli)
echo [3] Windows Bildirim Alaninda (System Tray) Baslat
echo [4] Windows Baslangicina Ekle (Bilgisayar acilinca oto-baslar)
echo [5] MusicBridge'i Durdur
echo.
set /p SECIM="Seciminiz (Varsayilan [1]): "

if "%SECIM%"=="2" (
    start "" "MusicBridge-ArkaPlanda-Baslat.vbs"
    echo Arka planda baslatildi.
    timeout /t 2 >nul
    exit
)
if "%SECIM%"=="3" (
    start "" "MusicBridge-Tray.vbs"
    echo Bildirim alaninda baslatildi.
    timeout /t 2 >nul
    exit
)
if "%SECIM%"=="4" (
    call "Baslangicta-Calistir-Kur.bat"
    exit
)
if "%SECIM%"=="5" (
    call "MusicBridge-Durdur.bat"
    exit
)

if not exist node_modules (
    echo Gerekli paketler yukleniyor...
    call npm.cmd install ws --no-audit --no-fund 2>nul || call npm install ws --no-audit --no-fund
)

node server.js
pause
