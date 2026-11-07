# Rasterisation du dessin vectoriel natif (mark.json) vers le web et Android.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$brand = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'mark.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$projectRoot = Split-Path (Split-Path $PSScriptRoot)
$public = Join-Path $projectRoot 'application/public'
$res = Join-Path $projectRoot 'application/android/app/src/main/res'
$inv = [cultureinfo]::InvariantCulture

function Get-Color([string]$key) { return [System.Drawing.ColorTranslator]::FromHtml($brand.$key) }

function New-MarkPath([string]$data) {
    $tokens = [regex]::Matches($data, '[MLCZ]|-?\d+(?:\.\d+)?') | ForEach-Object Value
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    [single]$x = 0; [single]$y = 0; $i = 0
    while ($i -lt $tokens.Count) {
        $command = $tokens[$i++]
        switch ($command) {
            'M' { $x = [single]::Parse($tokens[$i++], $inv); $y = [single]::Parse($tokens[$i++], $inv); $path.StartFigure() }
            'L' { $nx = [single]::Parse($tokens[$i++], $inv); $ny = [single]::Parse($tokens[$i++], $inv); $path.AddLine($x,$y,$nx,$ny); $x=$nx; $y=$ny }
            'C' {
                $v = [single[]]::new(6)
                for ($j=0; $j -lt 6; $j++) { $v[$j] = [single]::Parse($tokens[$i++], $inv) }
                $path.AddBezier($x,$y,$v[0],$v[1],$v[2],$v[3],$v[4],$v[5]); $x=$v[4]; $y=$v[5]
            }
            'Z' { $path.CloseFigure() }
            default { throw "Commande vectorielle inconnue : $command" }
        }
    }
    return ,$path
}

# C = écran (trait), D = triangle, E = vide noir prolongé par l'encoche.
function Draw-Mark($g, [single]$x, [single]$y, [single]$size, [single]$inset = 1) {
    $state = $g.Save()
    $g.TranslateTransform($x,$y)
    $g.ScaleTransform(($size/108),($size/108))
    $g.TranslateTransform((108*(1-$inset)/2),(108*(1-$inset)/2))
    $g.ScaleTransform($inset,$inset)
    foreach ($part in $brand.parts) {
        $p = New-MarkPath $part.d
        if ($part.fill) { $brush = [System.Drawing.SolidBrush]::new((Get-Color $part.fill)); $g.FillPath($brush,$p); $brush.Dispose() }
        if ($part.stroke) {
            $pen = [System.Drawing.Pen]::new((Get-Color $part.stroke), [single]$part.width)
            if ($part.cap -eq 'round') { $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round; $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round }
            $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
            $g.DrawPath($pen,$p); $pen.Dispose()
        }
        $p.Dispose()
    }
    $g.Restore($state)
}

function Draw-Name($g, [single]$x, [single]$y, [single]$height) {
    $font = [System.Drawing.Font]::new('Segoe UI', [single]($height*0.19), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $small = [System.Drawing.Font]::new('Segoe UI', [single]($height*0.063), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $format = [System.Drawing.StringFormat]::GenericTypographic
    $line = [System.Drawing.SolidBrush]::new((Get-Color 'line'))
    $accent = [System.Drawing.SolidBrush]::new((Get-Color 'accent'))
    $muted = [System.Drawing.SolidBrush]::new((Get-Color 'muted'))
    $g.DrawString($brand.nameStart,$font,$line,$x,$y,$format)
    $startWidth = $g.MeasureString($brand.nameStart,$font,[System.Drawing.PointF]::new(0,0),$format).Width
    $g.DrawString($brand.nameEnd,$font,$accent,[single]($x+$startWidth),$y,$format)
    $g.DrawString($brand.tagline,$small,$muted,[single]($x+$height*0.006),[single]($y+$height*0.25),$format)
    $font.Dispose(); $small.Dispose(); $line.Dispose(); $accent.Dispose(); $muted.Dispose()
}

function Export-Png([string]$target, [int]$width, [int]$height, [string]$kind = 'icon') {
    $bitmap = [System.Drawing.Bitmap]::new($width,$height)
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)
    if ($kind -eq 'foreground') { Draw-Mark $g 0 0 $width 0.72 }
    elseif ($kind -eq 'splash') {
        $g.Clear((Get-Color 'background'))
        $size = [single]([Math]::Min($width,$height)*0.32)
        Draw-Mark $g (($width-$size)/2) (($height-$size)/2) $size
    }
    elseif ($kind -in @('banner','social')) {
        $g.Clear((Get-Color 'background'))
        $size = [single]($height*0.64)
        Draw-Mark $g ($width*0.07) (($height-$size)/2) $size
        Draw-Name $g ([single]($width*0.07 + $size + $height*0.08)) ([single]($height*0.33)) $height
    }
    else {
        $outline = [System.Drawing.Drawing2D.GraphicsPath]::new()
        if ($kind -eq 'round') { $outline.AddEllipse(0,0,$width,$height) }
        else {
            $d = [single]($width*2*$brand.tileRadius/108)
            $outline.AddArc(0,0,$d,$d,180,90); $outline.AddArc(($width-$d),0,$d,$d,270,90)
            $outline.AddArc(($width-$d),($height-$d),$d,$d,0,90); $outline.AddArc(0,($height-$d),$d,$d,90,90); $outline.CloseFigure()
        }
        $brush = [System.Drawing.SolidBrush]::new((Get-Color 'background'))
        $g.FillPath($brush,$outline)
        if ($kind -eq 'round') { Draw-Mark $g 0 0 $width 0.84 } else { Draw-Mark $g 0 0 $width }
        $brush.Dispose(); $outline.Dispose()
    }
    $g.Dispose()
    $bitmap.Save($target,[System.Drawing.Imaging.ImageFormat]::Png); $bitmap.Dispose()
}

foreach ($size in @(192,512)) { Export-Png (Join-Path $public "cedplay-$size.png") $size $size }
Export-Png (Join-Path $PSScriptRoot 'cedplay-icon-1024.png') 1024 1024
Export-Png (Join-Path $public 'apple-touch-icon.png') 180 180
Export-Png (Join-Path $public 'cedplay-social.png') 1200 630 'social'
Export-Png (Join-Path $res 'drawable/tv_banner.png') 320 180 'banner'
foreach ($density in @(@('mdpi',48,108),@('hdpi',72,162),@('xhdpi',96,216),@('xxhdpi',144,324),@('xxxhdpi',192,432))) {
    $dir = Join-Path $res "mipmap-$($density[0])"
    Export-Png (Join-Path $dir 'ic_launcher.png') $density[1] $density[1]
    Export-Png (Join-Path $dir 'ic_launcher_round.png') $density[1] $density[1] 'round'
    Export-Png (Join-Path $dir 'ic_launcher_foreground.png') $density[2] $density[2] 'foreground'
}
foreach ($splash in (Get-ChildItem -LiteralPath $res -Recurse -Filter splash.png)) {
    $old = [System.Drawing.Image]::FromFile($splash.FullName); $w=$old.Width; $h=$old.Height; $old.Dispose()
    Export-Png $splash.FullName $w $h 'splash'
}
Write-Output 'Icônes, bannière TV et écrans de lancement exportés.'
