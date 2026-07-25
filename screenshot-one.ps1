param(
  [Parameter(Position = 0)]
  [string]$OutputPath = "",

  [Parameter(Position = 1)]
  [string]$FileName = ""
)

$scriptDir = Split-Path -Parent $PSCommandPath

if ($OutputPath) {
  $base = Join-Path $scriptDir $OutputPath
} elseif ($FileName) {
  $base = Join-Path $scriptDir $FileName
} else {
  $base = Join-Path $scriptDir "screenshot"
}

$ext = [System.IO.Path]::GetExtension($base)
if ($ext) { $base = [System.IO.Path]::ChangeExtension($base, $null) }

$outDir = Split-Path $base -Parent
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$n = 1
$landscapePath = "${base}_h.png"
while (Test-Path $landscapePath) {
  $n++
  $landscapePath = "${base}_${n}_h.png"
}
$portraitPath = if ($n -eq 1) { "${base}_v.png" } else { "${base}_${n}_v.png" }

Write-Host "等待 5 秒后截图（请切换到你想要的画面）..." -NoNewline
for ($i = 5; $i -gt 0; $i--) {
  Start-Sleep -Seconds 1
  Write-Host " $i" -NoNewline
}
Write-Host " 截屏！"

Add-Type -AssemblyName System.Drawing.Common

$code = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class ScreenCapture {

  [DllImport("user32.dll")]
  static extern bool EnumDisplaySettings(string lpszDeviceName, int iModeNum, ref DEVMODE lpDevMode);

  [DllImport("gdi32.dll")]
  static extern bool BitBlt(IntPtr hdc, int x, int y, int w, int h, IntPtr hdcSrc, int xSrc, int ySrc, uint rop);

  [DllImport("user32.dll")]
  static extern IntPtr GetDC(IntPtr hWnd);

  [DllImport("user32.dll")]
  static extern int ReleaseDC(IntPtr hWnd, IntPtr hdc);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
    public int dmFields;
    public int dmPositionX, dmPositionY;
    public int dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels;
    public int dmBitsPerPel, dmPelsWidth, dmPelsHeight;
    public int dmDisplayFlags, dmDisplayFrequency;
    public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType;
    public int dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }

  const int ENUM_CURRENT_SETTINGS = -1;
  const uint SRCCOPY = 0x00CC0020;

  static int _screenW, _screenH;

  static void GetPhysicalResolution() {
    DEVMODE dm = new DEVMODE();
    dm.dmSize = (short)Marshal.SizeOf<DEVMODE>();
    EnumDisplaySettings(null, ENUM_CURRENT_SETTINGS, ref dm);
    _screenW = dm.dmPelsWidth;
    _screenH = dm.dmPelsHeight;
  }

  public static void CaptureLandscape(string outPath) {
    GetPhysicalResolution();
    int targetW = _screenH * 4 / 3;
    int srcX = (_screenW - targetW) / 2;

    using (var bmp = new Bitmap(targetW, _screenH)) {
      using (var g = Graphics.FromImage(bmp)) {
        var destDc = g.GetHdc();
        var srcDc = GetDC(IntPtr.Zero);
        BitBlt(destDc, 0, 0, targetW, _screenH, srcDc, srcX, 0, SRCCOPY);
        ReleaseDC(IntPtr.Zero, srcDc);
        g.ReleaseHdc(destDc);
      }
      bmp.Save(outPath, ImageFormat.Png);
    }
  }

  public static void CapturePortrait(string outPath) {
    GetPhysicalResolution();
    int targetW = _screenH * 3 / 4;
    int srcX = (_screenW - targetW) / 2;

    using (var bmp = new Bitmap(targetW, _screenH)) {
      using (var g = Graphics.FromImage(bmp)) {
        var destDc = g.GetHdc();
        var srcDc = GetDC(IntPtr.Zero);
        BitBlt(destDc, 0, 0, targetW, _screenH, srcDc, srcX, 0, SRCCOPY);
        ReleaseDC(IntPtr.Zero, srcDc);
        g.ReleaseHdc(destDc);
      }
      bmp.Save(outPath, ImageFormat.Png);
    }
  }
}
'@

$pwshDir = Split-Path ([System.Reflection.Assembly]::LoadWithPartialName("System.Drawing.Common").Location) -Parent
$refs = @(
  Join-Path $pwshDir "System.Drawing.dll"
  Join-Path $pwshDir "System.Drawing.Common.dll"
  Join-Path $pwshDir "System.Drawing.Primitives.dll"
  Join-Path $pwshDir "System.Private.Windows.Core.dll"
  Join-Path $pwshDir "System.Private.Windows.GdiPlus.dll"
  Join-Path $pwshDir "System.ComponentModel.Primitives.dll"
  Join-Path $pwshDir "System.Console.dll"
)
$typeName = "ScreenCapture_$([DateTime]::Now.Ticks)"
$code = $code -replace 'class ScreenCapture', "class $typeName"
Add-Type -TypeDefinition $code -ReferencedAssemblies $refs

$captureType = [Type]$typeName

try {
  $captureType::CaptureLandscape($landscapePath)
  Write-Host "✓ 横屏截图已保存: $landscapePath"
} catch {
  Write-Error "横屏截图失败: $($_.Exception.Message)"; exit 1
}

try {
  $captureType::CapturePortrait($portraitPath)
  Write-Host "✓ 竖屏截图已保存: $portraitPath"
} catch {
  Write-Error "竖屏截图失败: $($_.Exception.Message)"; exit 1
}
