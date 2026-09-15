$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$taskIconDir = Join-Path $PSScriptRoot '..\extension\icons'
New-Item -ItemType Directory -Path $taskIconDir -Force | Out-Null
foreach ($taskSize in @(16, 32, 48, 128)) {
    $taskBitmap = New-Object System.Drawing.Bitmap($taskSize, $taskSize)
    $taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
    $taskGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $taskGraphics.Clear([System.Drawing.Color]::Transparent)
    $taskGraphics.ScaleTransform($taskSize / 128.0, $taskSize / 128.0)
    $taskBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#147d68'))
    $taskPoints = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(64, 4), [System.Drawing.PointF]::new(118, 24),
        [System.Drawing.PointF]::new(109, 84), [System.Drawing.PointF]::new(64, 124),
        [System.Drawing.PointF]::new(19, 84), [System.Drawing.PointF]::new(10, 24)
    )
    $taskGraphics.FillPolygon($taskBrush, $taskPoints)
    $taskPen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 11)
    $taskPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $taskPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $taskGraphics.DrawLines($taskPen, [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(38, 63), [System.Drawing.PointF]::new(57, 81), [System.Drawing.PointF]::new(92, 44)
    ))
    $taskBitmap.Save((Join-Path $taskIconDir "$taskSize.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $taskPen.Dispose(); $taskBrush.Dispose(); $taskGraphics.Dispose(); $taskBitmap.Dispose()
}
