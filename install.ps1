# ============================================================
# Script d'installation : Server Power Manager
# Environnement : Windows 11, Tauri v2 + React + Rust
# ============================================================
#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Server Power Manager - Installation de l'environnement ===" -ForegroundColor Cyan
Write-Host "Ce script installe tous les prerequis necessaires." -ForegroundColor Gray
Write-Host ""

# -- Fonctions utilitaires ------------------------------------------
function Test-Command($cmd) {
    $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue)
}

function Install-WithWinget($id, $label) {
    Write-Host "  Installation de $label..." -ForegroundColor Yellow
    winget install --id $id --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "Echec de l installation de $label"
    }
    Write-Host "  $label installe." -ForegroundColor Green
}

function Refresh-Path {
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath    = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:PATH    = $machinePath + ";" + $userPath
}

# -- 1. winget disponible ? -----------------------------------------
if (-not (Test-Command "winget")) {
    Write-Host "[ERREUR] winget non disponible. Installez App Installer depuis le Microsoft Store." -ForegroundColor Red
    exit 1
}

# -- 2. Visual C++ Build Tools (link.exe) ---------------------------
Write-Host "[1/8] Visual C++ Build Tools (link.exe)" -ForegroundColor Cyan
$linkExe = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"
$linkExe2 = "${env:ProgramFiles}\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVS = (Test-Path $linkExe) -or (Test-Path $linkExe2) -or (Test-Path $vsWhere) -or (Test-Command "cl.exe")
if ($hasVS) {
    Write-Host "  Visual C++ Build Tools deja installes." -ForegroundColor Green
} else {
    Write-Host "  Installation des Visual C++ Build Tools..." -ForegroundColor Yellow
    Write-Host "  (cette etape peut prendre 5-15 min, c'est normal)" -ForegroundColor Gray
    winget install --id Microsoft.VisualStudio.2022.BuildTools --silent --accept-package-agreements --accept-source-agreements `
        --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    Write-Host "  Visual C++ Build Tools installes." -ForegroundColor Green
    Refresh-Path
}

# -- 3. Rust + rustup -----------------------------------------------
Write-Host "[2/8] Rust (rustup + MSVC toolchain)" -ForegroundColor Cyan
if (Test-Command "rustup") {
    Write-Host "  rustup deja installe." -ForegroundColor Green
    rustup update stable --quiet
} else {
    Install-WithWinget "Rustlang.Rustup" "Rustup"
    Refresh-Path
}
rustup default stable-x86_64-pc-windows-msvc 2>&1 | Out-Null
Write-Host "  Toolchain active : $(rustup show active-toolchain)" -ForegroundColor Green

# -- 4. Node.js LTS --------------------------------------------------
Write-Host "[3/8] Node.js LTS" -ForegroundColor Cyan
if (Test-Command "node") {
    Write-Host "  Node.js deja installe : $(node --version)" -ForegroundColor Green
} else {
    Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS"
    Refresh-Path
}

# -- 5. CMake --------------------------------------------------------
Write-Host "[4/8] CMake" -ForegroundColor Cyan
if (Test-Command "cmake") {
    $cmakeVer = (cmake --version | Select-Object -First 1)
    Write-Host "  CMake deja installe : $cmakeVer" -ForegroundColor Green
} else {
    Install-WithWinget "Kitware.CMake" "CMake"
    Refresh-Path
}

# -- 6. NASM ---------------------------------------------------------
Write-Host "[5/8] NASM" -ForegroundColor Cyan
if (Test-Command "nasm") {
    Write-Host "  NASM deja installe." -ForegroundColor Green
} else {
    Install-WithWinget "NASM.NASM" "NASM"
    Refresh-Path
}

# -- 7. Git ----------------------------------------------------------
Write-Host "[6/8] Git" -ForegroundColor Cyan
if (Test-Command "git") {
    Write-Host "  Git deja installe : $(git --version)" -ForegroundColor Green
} else {
    Install-WithWinget "Git.Git" "Git"
    Refresh-Path
}

# -- 8. Tauri CLI ----------------------------------------------------
Write-Host "[7/8] Tauri CLI v2" -ForegroundColor Cyan
$tauriCheck = cargo install --list 2>&1 | Select-String "tauri-cli"
if ($tauriCheck) {
    Write-Host "  tauri-cli deja installe." -ForegroundColor Green
} else {
    Write-Host "  Installation de tauri-cli (peut prendre 5-10 min)..." -ForegroundColor Yellow
    cargo install tauri-cli --version "^2" --locked
    Write-Host "  tauri-cli installe." -ForegroundColor Green
}

# -- 9. Dependances npm ----------------------------------------------
Write-Host "[8/8] Dependances npm du projet" -ForegroundColor Cyan
$projectDir = $PSScriptRoot
if (Test-Path $projectDir) {
    Push-Location $projectDir
    Write-Host "  npm install..." -ForegroundColor Yellow
    npm install
    Pop-Location
    Write-Host "  Dependances npm installees." -ForegroundColor Green
} else {
    Write-Host "  [ATTENTION] Dossier du projet introuvable." -ForegroundColor Yellow
}

# -- Resume ----------------------------------------------------------
Write-Host ""
Write-Host "=== Installation terminee ! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Pour lancer l'app en developpement :" -ForegroundColor White
Write-Host "  npm run tauri dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "Pour builder un .exe distribuable :" -ForegroundColor White
Write-Host "  npm run tauri build" -ForegroundColor Cyan
Write-Host "  -> Le .exe sera dans : src-tauri\target\release\bundle\nsis\" -ForegroundColor Gray
Write-Host ""
