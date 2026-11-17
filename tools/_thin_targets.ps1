Add-Type -AssemblyName System.Drawing
$dir = Join-Path $PSScriptRoot "..\assets\attack"
$files = Get-ChildItem (Join-Path $dir "target-*.png")
$shift = 4   # open the center
$erodePasses = 1

foreach ($f in $files) {
  $src = New-Object System.Drawing.Bitmap $f.FullName
  $w = $src.Width
  $h = $src.Height
  $scale = 3
  $sw = $w * $scale
  $sh = $h * $scale

  # Upscale nearest-neighbor for cleaner morph
  $big = New-Object System.Drawing.Bitmap $sw, $sh, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($big)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($src, 0, 0, $sw, $sh)
  $g.Dispose()
  $src.Dispose()

  $a = New-Object "byte[,]" $sw, $sh
  $cols = New-Object "System.Drawing.Color[,]" $sw, $sh
  for ($y = 0; $y -lt $sh; $y++) {
    for ($x = 0; $x -lt $sw; $x++) {
      $p = $big.GetPixel($x, $y)
      $cols[$x, $y] = $p
      $a[$x, $y] = $p.A
    }
  }
  $big.Dispose()

  for ($pass = 0; $pass -lt $erodePasses; $pass++) {
    $next = New-Object "byte[,]" $sw, $sh
    for ($y = 0; $y -lt $sh; $y++) {
      for ($x = 0; $x -lt $sw; $x++) {
        if ($a[$x, $y] -lt 40) { $next[$x, $y] = [byte]0; continue }
        $ok = $true
        foreach ($d in @(@(1, 0), @(-1, 0), @(0, 1), @(0, -1))) {
          $nx = $x + $d[0]
          $ny = $y + $d[1]
          if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge $sw -or $ny -ge $sh -or $a[$nx, $ny] -lt 40) {
            $ok = $false
            break
          }
        }
        if ($ok) { $next[$x, $y] = $a[$x, $y] } else { $next[$x, $y] = [byte]0 }
      }
    }
    $a = $next
  }

  $pad = $shift * $scale + 2
  $nw = $sw + $pad * 2
  $nh = $sh + $pad * 2
  $outBig = New-Object System.Drawing.Bitmap $nw, $nh, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $gg = [System.Drawing.Graphics]::FromImage($outBig)
  $gg.Clear([System.Drawing.Color]::Transparent)
  $gg.Dispose()

  $cx = ($sw - 1) / 2.0
  $cy = ($sh - 1) / 2.0
  $s = $shift * $scale
  for ($y = 0; $y -lt $sh; $y++) {
    for ($x = 0; $x -lt $sw; $x++) {
      $ea = $a[$x, $y]
      if ($ea -lt 40) { continue }
      $dx = 0
      $dy = 0
      if ($x -lt $cx) { $dx = -$s } else { $dx = $s }
      if ($y -lt $cy) { $dy = -$s } else { $dy = $s }
      $nx = [int][Math]::Round($x + $dx + $pad)
      $ny = [int][Math]::Round($y + $dy + $pad)
      if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge $nw -or $ny -ge $nh) { continue }
      $col = $cols[$x, $y]
      $outBig.SetPixel($nx, $ny, [System.Drawing.Color]::FromArgb([int]$ea, $col.R, $col.G, $col.B))
    }
  }

  # Downscale back with high quality to original-ish size (slightly larger OK)
  $finalW = [Math]::Max($w + 8, [int][Math]::Round($nw / $scale))
  $finalH = [Math]::Max($h + 8, [int][Math]::Round($nh / $scale))
  $final = New-Object System.Drawing.Bitmap $finalW, $finalH, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $gf = [System.Drawing.Graphics]::FromImage($final)
  $gf.Clear([System.Drawing.Color]::Transparent)
  $gf.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gf.DrawImage($outBig, 0, 0, $finalW, $finalH)
  $gf.Dispose()
  $outBig.Dispose()

  $tmp = Join-Path $env:TEMP ("thin2-" + $f.Name)
  $final.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
  $final.Dispose()
  Copy-Item -LiteralPath $tmp -Destination $f.FullName -Force
  Remove-Item $tmp -Force
  Write-Output ("updated " + $f.Name + " " + $finalW + "x" + $finalH)
}
