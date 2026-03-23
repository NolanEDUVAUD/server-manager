# generate-icons.ps1
# Genere les icones minimales requises par Tauri (Windows)
# Utilise System.Drawing de .NET, aucune dependance externe necessaire

Add-Type -AssemblyName System.Drawing

$iconsDir = Join-Path $PSScriptRoot "src-tauri\icons"
New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null
Write-Host "Dossier icones : $iconsDir" -ForegroundColor Cyan

# -- Fonction de dessin d'une icone serveur -------------------------
function New-ServerIcon {
    param([int]$Size)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # Fond bleu Windows 11 (#0078D4)
    $blue  = [System.Drawing.Color]::FromArgb(255, 0, 120, 212)
    $brush = New-Object System.Drawing.SolidBrush($blue)
    $g.FillRectangle($brush, 0, 0, $Size, $Size)
    $brush.Dispose()

    # Trois barres blanches (rack serveur)
    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $pad   = [int]($Size * 0.12)
    $h     = [int]($Size * 0.16)
    $gap   = [int]($Size * 0.07)
    $w     = $Size - $pad * 2

    $g.FillRectangle($white, $pad, $pad,                  $w, $h)
    $g.FillRectangle($white, $pad, $pad + $h + $gap,      $w, $h)
    $g.FillRectangle($white, $pad, $pad + ($h + $gap) * 2, $w, $h)
    $white.Dispose()
    $g.Dispose()

    return $bmp
}

# -- PNG 32x32 -------------------------------------------------------
$bmp = New-ServerIcon 32
$bmp.Save("$iconsDir\32x32.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "  [OK] 32x32.png" -ForegroundColor Green

# -- PNG 128x128 -----------------------------------------------------
$bmp = New-ServerIcon 128
$bmp.Save("$iconsDir\128x128.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "  [OK] 128x128.png" -ForegroundColor Green

# -- PNG 256x256 (128x128@2x) ----------------------------------------
$bmp = New-ServerIcon 256
$bmp.Save("$iconsDir\128x128@2x.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "  [OK] 128x128@2x.png" -ForegroundColor Green

# -- ICO (requis pour le build Windows) ------------------------------
$bmp   = New-ServerIcon 32
$hIcon = $bmp.GetHicon()
$icon  = [System.Drawing.Icon]::FromHandle($hIcon)
$fs    = [System.IO.FileStream]::new("$iconsDir\icon.ico", [System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$bmp.Dispose()
Write-Host "  [OK] icon.ico" -ForegroundColor Green

# -- ICNS (placeholder macOS, non utilise sur Windows) ---------------
Copy-Item "$iconsDir\128x128.png" "$iconsDir\icon.icns" -Force
Write-Host "  [OK] icon.icns (placeholder)" -ForegroundColor Green

Write-Host ""
Write-Host "Icones generees ! Lance maintenant : npm run tauri build" -ForegroundColor Cyan
