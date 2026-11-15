# Resizes the given cards' images for the web: <out>\<code>.jpg (preview) and <out>\small\<code>.jpg (thumbnail).
# Called by build_data.py. Images that are already there are left alone.
param([string]$Source, [string]$Out, [string]$Codes)

Add-Type -AssemblyName System.Drawing
$sizes = @(@{ Dir = $Out; Width = 375; Quality = 85L }, @{ Dir = (Join-Path $Out 'small'); Width = 150; Quality = 80L })
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
foreach ($s in $sizes) { New-Item -ItemType Directory -Force -Path $s.Dir | Out-Null }
$made = 0
foreach ($code in $Codes.Split(',')) {
    $src = Join-Path $Source "$code.jpg"
    if (-not (Test-Path $src)) { Write-Host "이미지 없음: $code"; continue }
    $image = $null
    foreach ($s in $sizes) {
        $dst = Join-Path $s.Dir "$code.jpg"
        if (Test-Path $dst) { continue }
        if ($null -eq $image) { $image = [System.Drawing.Image]::FromFile($src) }
        $h = [int]($image.Height * $s.Width / $image.Width)
        $bmp = New-Object System.Drawing.Bitmap $s.Width, $h
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.DrawImage($image, 0, 0, $s.Width, $h)
        $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
        $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), $s.Quality
        $bmp.Save($dst, $codec, $ep)
        $g.Dispose(); $bmp.Dispose()
        $made++
    }
    if ($null -ne $image) { $image.Dispose() }
}
Write-Host "이미지 $made 개 생성"
