import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';

const IS_WINDOWS = process.platform === 'win32';
const IS_MACOS = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';
const IS_WAYLAND = !IS_WINDOWS && !IS_MACOS && !!process.env['WAYLAND_DISPLAY'];
const SCREENSHOT_DIR = resolve(process.cwd(), '.forgeai', 'screenshots');
const MAX_OUTPUT = 128 * 1024;

// ─── Dependency detection for Linux ───
const linuxDepCache = new Map<string, boolean>();

function hasLinuxDep(cmd: string): boolean {
  if (linuxDepCache.has(cmd)) return linuxDepCache.get(cmd)!;
  try {
    const { execFileSync } = require('node:child_process');
    execFileSync('which', [cmd], { stdio: 'ignore', timeout: 3000 });
    linuxDepCache.set(cmd, true);
    return true;
  } catch {
    linuxDepCache.set(cmd, false);
    return false;
  }
}

function linuxDepError(cmd: string, installHint: string): string {
  return `DEPENDENCY_MISSING: "${cmd}" is not installed. Install with: ${installHint}`;
}

// requireLinuxDep can be used by external consumers
export function requireLinuxDep(cmd: string, installHint: string): void {
  if (!hasLinuxDep(cmd)) throw new Error(linuxDepError(cmd, installHint));
}

// ─── PowerShell helpers for Windows UI Automation ───

const PS_HELPERS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
using System.Threading;

public class WinAPI {
    [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    public static string GetWindowTitle(IntPtr hWnd) {
        int len = GetWindowTextLength(hWnd);
        if (len == 0) return "";
        StringBuilder sb = new StringBuilder(len + 1);
        GetWindowText(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }
}
"@
`;

const PS_LIST_WINDOWS = `
${PS_HELPERS}
$list = New-Object System.Collections.ArrayList
[WinAPI]::EnumWindows({
    param($hWnd, $lParam)
    if ([WinAPI]::IsWindowVisible($hWnd)) {
        $title = [WinAPI]::GetWindowTitle($hWnd)
        if ($title -ne "") {
            $pid = [uint32]0
            [WinAPI]::GetWindowThreadProcessId($hWnd, [ref]$pid) | Out-Null
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            $rect = New-Object WinAPI+RECT
            [WinAPI]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
            $list.Add([PSCustomObject]@{
                Handle = $hWnd.ToInt64()
                Title = $title
                Process = if($proc){$proc.ProcessName}else{"unknown"}
                PID = $pid
                X = $rect.Left
                Y = $rect.Top
                Width = $rect.Right - $rect.Left
                Height = $rect.Bottom - $rect.Top
            }) | Out-Null
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
$list | ConvertTo-Json -Depth 2 -Compress
`;

function psScript_focusWindow(titlePattern: string): string {
  const safe = titlePattern.replace(/'/g, "''");
  return `
${PS_HELPERS}
$script:focusResult = "NOT_FOUND: No window matching '*${safe}*'"
[WinAPI]::EnumWindows({
    param($hWnd, $lParam)
    if ([WinAPI]::IsWindowVisible($hWnd)) {
        $title = [WinAPI]::GetWindowTitle($hWnd)
        if ($title -like "*${safe}*") {
            [WinAPI]::ShowWindow($hWnd, 9) | Out-Null
            Start-Sleep -Milliseconds 200
            [WinAPI]::SetForegroundWindow($hWnd) | Out-Null
            Start-Sleep -Milliseconds 200
            $script:focusResult = "FOCUSED: $title (handle=$($hWnd.ToInt64()))"
            return $false
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
Write-Output $script:focusResult
`;
}

function psScript_sendKeys(keys: string): string {
  // SendKeys format: ^ = Ctrl, % = Alt, + = Shift, {ENTER}, {TAB}, {ESC}, etc.
  // Do NOT escape ^, %, + — they are SendKeys modifiers
  const escaped = keys.replace(/"/g, '`"');
  return `
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("${escaped}")
Write-Output "SENT_KEYS: ${keys.substring(0, 50)}"
`;
}

function psScript_typeText(text: string): string {
  // Use clipboard for reliable Unicode text entry
  return `
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 200
[System.Windows.Forms.Clipboard]::SetText("${text.replace(/"/g, '`"').replace(/\$/g, '`$')}")
Start-Sleep -Milliseconds 100
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 100
Write-Output "TYPED: ${text.substring(0, 60).replace(/"/g, "'")}"
`;
}

function psScript_screenshot(outputPath: string, windowTitle?: string): string {
  if (windowTitle) {
    return `
${PS_HELPERS}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$found = $false
[WinAPI]::EnumWindows({
    param($hWnd, $lParam)
    if ([WinAPI]::IsWindowVisible($hWnd)) {
        $title = [WinAPI]::GetWindowTitle($hWnd)
        if ($title -like "*${windowTitle.replace(/'/g, "''")}*") {
            $rect = New-Object WinAPI+RECT
            [WinAPI]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
            $w = $rect.Right - $rect.Left
            $h = $rect.Bottom - $rect.Top
            if ($w -gt 0 -and $h -gt 0) {
                $bmp = New-Object System.Drawing.Bitmap($w, $h)
                $g = [System.Drawing.Graphics]::FromImage($bmp)
                $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($w, $h))
                $bmp.Save("${outputPath.replace(/\\/g, '\\\\')}")
                $g.Dispose()
                $bmp.Dispose()
                $script:found = $true
                Write-Output "SCREENSHOT: ${outputPath.replace(/\\/g, '\\\\')} ($w x $h)"
            }
            return $false
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
if (-not $found) { Write-Output "NOT_FOUND: No window matching '*${windowTitle.replace(/'/g, "''")}*'" }
`;
  }

  // Full screen screenshot
  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(0, 0, 0, 0, [System.Drawing.Size]::new($screen.Width, $screen.Height))
$bmp.Save("${outputPath.replace(/\\/g, '\\\\')}")
$g.Dispose()
$bmp.Dispose()
Write-Output "SCREENSHOT: ${outputPath.replace(/\\/g, '\\\\')} ($($screen.Width) x $($screen.Height))"
`;
}

function psScript_click(x: number, y: number, button: string = 'left'): string {
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MouseAPI {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
}
"@
[MouseAPI]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 50
${button === 'right'
    ? '[MouseAPI]::mouse_event([MouseAPI]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 50; [MouseAPI]::mouse_event([MouseAPI]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, [IntPtr]::Zero)'
    : '[MouseAPI]::mouse_event([MouseAPI]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 50; [MouseAPI]::mouse_event([MouseAPI]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)'}
Write-Output "CLICKED: (${x}, ${y}) ${button}"
`;
}

function psScript_openApp(target: string): string {
  return `Start-Process "${target.replace(/"/g, '`"')}" -ErrorAction Stop; Start-Sleep -Seconds 2; Write-Output "OPENED: ${target.replace(/"/g, "'").substring(0, 80)}"`;
}

function psScript_ocrImage(imagePath: string): string {
  const safe = imagePath.replace(/\\/g, '\\\\').replace(/'/g, "''");
  return `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
Function AwaitOp($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
}

try {
    $file = AwaitOp ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${safe}')) ([Windows.Storage.StorageFile])
    $stream = AwaitOp ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = AwaitOp ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = AwaitOp ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($engine) {
        $ocrResult = AwaitOp ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        Write-Output $ocrResult.Text
    } else {
        Write-Output "OCR_ERROR: No OCR engine available"
    }
    $stream.Dispose()
} catch {
    Write-Output "OCR_ERROR: $($_.Exception.Message)"
}
`;
}

function psScript_readWindowText(titlePattern: string): string {
  const safe = titlePattern.replace(/'/g, "''");
  return `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$allWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition)

$targetWin = $null
foreach ($w in $allWindows) {
    try {
        if ($w.Current.Name -like "*${safe}*") {
            $targetWin = $w
            break
        }
    } catch {}
}

if (-not $targetWin) {
    Write-Output "NOT_FOUND: No window matching '*${safe}*'"
    return
}

$texts = New-Object System.Collections.ArrayList
$textCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Text
)
$elements = $targetWin.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCondition)
foreach ($el in $elements) {
    try {
        $name = $el.Current.Name
        if ($name -and $name.Trim() -ne "") { $texts.Add($name.Trim()) | Out-Null }
    } catch {}
}

$editCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
)
$edits = $targetWin.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
foreach ($el in $edits) {
    try {
        $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($vp -and $vp.Current.Value) { $texts.Add("[INPUT] " + $vp.Current.Value) | Out-Null }
    } catch {}
}

if ($texts.Count -eq 0) {
    Write-Output "NO_TEXT_FOUND: Window found but no readable text elements"
} else {
    $texts -join [Environment]::NewLine
}
`;
}

// ─── Linux helpers (X11 + Wayland support) ───

function linuxCmd_listWindows(): string {
  if (IS_WAYLAND) {
    // Wayland: try wlrctl or swaymsg, fall back to basic process list
    return `if command -v wlrctl &>/dev/null; then wlrctl toplevel list 2>/dev/null; elif command -v swaymsg &>/dev/null; then swaymsg -t get_tree 2>/dev/null | python3 -c "import sys,json; t=json.load(sys.stdin); [print(f'{n[\"id\"]} {n[\"name\"]}') for n in (lambda f,tree: f(f,tree))(lambda f,n: ([n] if n.get('name') and n.get('visible') else []) + [x for c in n.get('nodes',[])+n.get('floating_nodes',[]) for x in f(f,c)], t)" 2>/dev/null; else ps -eo pid,comm --sort=-%mem | head -20; fi`;
  }
  return `wmctrl -l -p 2>/dev/null || xdotool search --name '' getwindowname %@ 2>/dev/null || echo "NO_WINDOW_TOOL: Install wmctrl (sudo apt install wmctrl) or xdotool (sudo apt install xdotool)"`;
}

function linuxCmd_focusWindow(titlePattern: string): string {
  const safe = titlePattern.replace(/"/g, '\\"');
  if (IS_WAYLAND) {
    return `if command -v wlrctl &>/dev/null; then wlrctl toplevel focus title:"${safe}" && echo "FOCUSED: ${safe}"; elif command -v swaymsg &>/dev/null; then swaymsg '[title=".*${safe}.*"]' focus && echo "FOCUSED: ${safe}"; else echo "WAYLAND: Install wlrctl or use Sway. No X11 tools available."; fi`;
  }
  return `wmctrl -a "${safe}" 2>/dev/null || xdotool search --name "${safe}" windowactivate 2>/dev/null && echo "FOCUSED: ${safe}" || echo "NOT_FOUND: ${safe}"`;
}

function linuxCmd_sendKeys(keys: string): string {
  if (IS_WAYLAND) {
    return `if command -v ydotool &>/dev/null; then sleep 0.3 && ydotool key ${keys} && echo "SENT_KEYS: ${keys}"; elif command -v wtype &>/dev/null; then sleep 0.3 && wtype -k ${keys} && echo "SENT_KEYS: ${keys}"; else echo "WAYLAND: Install ydotool (sudo apt install ydotool) or wtype"; fi`;
  }
  return `sleep 0.3 && xdotool key ${keys} && echo "SENT_KEYS: ${keys}"`;
}

function linuxCmd_typeText(text: string): string {
  const safe = text.replace(/"/g, '\\"');
  if (IS_WAYLAND) {
    return `if command -v ydotool &>/dev/null; then sleep 0.2 && ydotool type "${safe}" && echo "TYPED"; elif command -v wtype &>/dev/null; then sleep 0.2 && wtype "${safe}" && echo "TYPED"; else echo "WAYLAND: Install ydotool or wtype"; fi`;
  }
  return `sleep 0.2 && xdotool type --clearmodifiers "${safe}" && echo "TYPED"`;
}

function linuxCmd_click(x: number, y: number): string {
  if (IS_WAYLAND) {
    return `if command -v ydotool &>/dev/null; then ydotool mousemove --absolute ${x} ${y} && sleep 0.05 && ydotool click 1 && echo "CLICKED: (${x}, ${y})"; else echo "WAYLAND: Install ydotool (sudo apt install ydotool)"; fi`;
  }
  return `xdotool mousemove ${x} ${y} && sleep 0.05 && xdotool click 1 && echo "CLICKED: (${x}, ${y})"`;
}

function linuxCmd_screenshot(outputPath: string): string {
  if (IS_WAYLAND) {
    return `if command -v grim &>/dev/null; then grim "${outputPath}" && echo "SCREENSHOT: ${outputPath}"; elif command -v gnome-screenshot &>/dev/null; then gnome-screenshot -f "${outputPath}" && echo "SCREENSHOT: ${outputPath}"; else echo "WAYLAND: Install grim (sudo apt install grim) or gnome-screenshot"; fi`;
  }
  return `scrot "${outputPath}" 2>/dev/null || gnome-screenshot -f "${outputPath}" 2>/dev/null || import -window root "${outputPath}" 2>/dev/null && echo "SCREENSHOT: ${outputPath}" || echo "FAILED: Install scrot (sudo apt install scrot)"`;
}

function linuxCmd_openApp(target: string): string {
  const safe = target.replace(/"/g, '\\"');
  return `nohup ${safe} >/dev/null 2>&1 & sleep 2 && echo "OPENED: ${safe}"`;
}

function linuxCmd_ocr(imagePath: string): string {
  return `if command -v tesseract &>/dev/null; then tesseract "${imagePath}" stdout 2>/dev/null; else echo "OCR_NOT_AVAILABLE: Install tesseract (sudo apt install tesseract-ocr)"; fi`;
}

function linuxCmd_readWindowText(titlePattern: string): string {
  const safe = titlePattern.replace(/"/g, '\\"');
  // Use xdotool + xprop for X11, or accessibilitykit for Wayland
  return `WINID=$(xdotool search --name "${safe}" 2>/dev/null | head -1); if [ -n "$WINID" ]; then xdotool getwindowname $WINID 2>/dev/null; xprop -id $WINID WM_NAME 2>/dev/null; else echo "NOT_FOUND: ${safe}"; fi`;
}

// ─── macOS helpers (AppleScript + native tools) ───

function macCmd_listWindows(): string {
  return `osascript -e 'set output to ""
tell application "System Events"
  set allProcs to every process whose visible is true
  repeat with proc in allProcs
    set procName to name of proc
    try
      set allWins to every window of proc
      repeat with win in allWins
        set winName to name of win
        set output to output & procName & " | " & winName & linefeed
      end repeat
    end try
  end repeat
end tell
return output'`;
}

function macCmd_focusWindow(titlePattern: string): string {
  const safe = titlePattern.replace(/'/g, "'\\''");
  return `osascript -e 'tell application "System Events"
  set allProcs to every process whose visible is true
  repeat with proc in allProcs
    try
      set allWins to every window of proc
      repeat with win in allWins
        if name of win contains "${safe}" then
          set frontmost of proc to true
          perform action "AXRaise" of win
          return "FOCUSED: " & name of win
        end if
      end repeat
    end try
  end repeat
end tell
return "NOT_FOUND: ${safe}"'`;
}

function macCmd_openApp(target: string): string {
  const safe = target.replace(/'/g, "'\\''");
  // Handle both app names and paths
  if (target.includes('/') || target.endsWith('.app')) {
    return `open "${safe}" && sleep 2 && echo "OPENED: ${safe}"`;
  }
  return `open -a "${safe}" && sleep 2 && echo "OPENED: ${safe}"`;
}

function macCmd_sendKeys(keys: string): string {
  // Convert common key names to AppleScript key codes
  // {ENTER} → return, {TAB} → tab, {ESC} → escape, ^c → cmd+c on Mac
  const safe = keys.replace(/'/g, "'\\''");
  return `osascript -e 'tell application "System Events"
  delay 0.3
  keystroke "${safe}"
end tell
return "SENT_KEYS: ${safe}"'`;
}

function macCmd_typeText(text: string): string {
  const safe = text.replace(/'/g, "'\\''").replace(/\\/g, '\\\\');
  return `osascript -e 'set the clipboard to "${safe}"
tell application "System Events"
  delay 0.2
  keystroke "v" using command down
end tell
return "TYPED"'`;
}

function macCmd_click(x: number, y: number): string {
  return `osascript -e 'tell application "System Events"
  do shell script "cliclick c:${x},${y} 2>/dev/null || python3 -c \\"import Quartz; evt=Quartz.CGEventCreateMouseEvent(None,Quartz.kCGEventLeftMouseDown,(${x},${y}),0); Quartz.CGEventPost(Quartz.kCGHIDEventTap,evt); import time; time.sleep(0.05); evt2=Quartz.CGEventCreateMouseEvent(None,Quartz.kCGEventLeftMouseUp,(${x},${y}),0); Quartz.CGEventPost(Quartz.kCGHIDEventTap,evt2)\\""
end tell
return "CLICKED: (${x}, ${y})"'`;
}

function macCmd_screenshot(outputPath: string, windowTitle?: string): string {
  if (windowTitle) {
    const safe = windowTitle.replace(/'/g, "'\\''");
    // Capture specific window by title
    return `osascript -e 'tell application "System Events"
  set allProcs to every process whose visible is true
  repeat with proc in allProcs
    try
      set allWins to every window of proc
      repeat with win in allWins
        if name of win contains "${safe}" then
          set frontmost of proc to true
          perform action "AXRaise" of win
          delay 0.5
        end if
      end repeat
    end try
  end repeat
end tell' && screencapture -x "${outputPath}" && echo "SCREENSHOT: ${outputPath}"`;
  }
  return `screencapture -x "${outputPath}" && echo "SCREENSHOT: ${outputPath}"`;
}

function macCmd_ocr(imagePath: string): string {
  // Use macOS Vision framework via Swift for native OCR (macOS 10.15+)
  return `swift -e '
import Vision
import AppKit
guard let img = NSImage(contentsOfFile: "${imagePath}"),
      let cgImg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  print("OCR_ERROR: Cannot load image")
  exit(1)
}
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
try {
  try VNImageRequestHandler(cgImage: cgImg).perform([req])
  let text = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\\n")
  print(text.isEmpty ? "(no text detected)" : text)
} catch { print("OCR_ERROR: \\(error)") }
' 2>/dev/null || (if command -v tesseract &>/dev/null; then tesseract "${imagePath}" stdout 2>/dev/null; else echo "OCR_NOT_AVAILABLE: Install tesseract (brew install tesseract)"; fi)`;
}

function macCmd_readWindowText(titlePattern: string): string {
  const safe = titlePattern.replace(/'/g, "'\\''");
  return `osascript -e 'tell application "System Events"
  set allProcs to every process whose visible is true
  set output to ""
  repeat with proc in allProcs
    try
      set allWins to every window of proc
      repeat with win in allWins
        if name of win contains "${safe}" then
          set output to output & "Window: " & name of win & linefeed
          try
            set uiElems to every UI element of win
            repeat with elem in uiElems
              try
                set val to value of elem
                if val is not missing value and val is not "" then
                  set output to output & val & linefeed
                end if
              end try
            end repeat
          end try
        end if
      end repeat
    end try
  end repeat
end tell
if output is "" then return "NOT_FOUND: ${safe}"
return output'`;
}

// ─── The Tool ───

export class DesktopAutomationTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'desktop',
    description: `Interact with desktop applications and the OS GUI. Can open apps, focus windows, send keystrokes, type text, click mouse, take screenshots, READ screen content via OCR, read window text via UI Automation, and wait.
Use this to automate ANY application: WhatsApp, Telegram, Notepad, browsers, Spotify, Discord, VS Code, Excel, etc.

KEY CAPABILITIES:
- read_screen: Takes a screenshot AND runs OCR to extract all visible text. Returns {screenshot, text}. USE THIS to see what is on screen.
- read_window_text: Uses UI Automation to read text elements from a window directly (faster than OCR, works for native apps).
- screenshot: Takes a screenshot only (no OCR). Use read_screen instead when you need to read content.

WORKFLOW for reading and responding in apps like WhatsApp:
1. focus_window target=WhatsApp
2. read_screen target=WhatsApp → OCR reads all visible text (messages, contacts, UI elements)
3. Analyze the OCR text to understand what is on screen
4. Use keyboard shortcuts to navigate and respond

WhatsApp Desktop workflow (FOLLOW THIS EXACTLY):
1. desktop action=focus_window target=WhatsApp
2. desktop action=wait target=500
3. desktop action=read_screen target=WhatsApp → READ what is visible
4. desktop action=send_keys text=^k → open search (Ctrl+K)
5. desktop action=wait target=500
6. desktop action=type_text text=ContactName
7. desktop action=wait target=1000
8. desktop action=send_keys text={ENTER} → select first result
9. desktop action=wait target=1000
10. desktop action=read_screen target=WhatsApp → READ messages in the conversation
11. desktop action=type_text text=Your reply here
12. desktop action=send_keys text={ENTER} → send

General tips:
- ALWAYS use read_screen to see what is on screen before and after actions
- Always focus_window BEFORE sending keys
- Use wait between steps (apps need time to respond)
- Common shortcuts: ^c=Ctrl+C, ^v=Ctrl+V, ^a=Ctrl+A, ^k=search, %{F4}=Alt+F4, {TAB}, {ENTER}, {ESC}
- For wait action: pass the ms value in target param (e.g. target=1000)`,
    category: 'automation',
    dangerous: true,
    parameters: [
      {
        name: 'action', type: 'string', required: true,
        description: 'Action: "list_windows", "focus_window", "open_app", "send_keys", "type_text", "click", "screenshot", "key_combo", "wait", "get_clipboard", "read_screen", "read_window_text"',
      },
      {
        name: 'target', type: 'string', required: false,
        description: 'For open_app: app path, protocol URL (e.g. "whatsapp:", "spotify:"), or executable name. For focus_window/read_screen/read_window_text/screenshot: window title pattern (partial match). For wait: milliseconds to wait.',
      },
      {
        name: 'text', type: 'string', required: false,
        description: 'For type_text: the text to type. For send_keys: key codes (Windows: {ENTER}, {TAB}, ^c=Ctrl+C, %f=Alt+F, +a=Shift+A. Linux: Return, Tab, ctrl+c, alt+f).',
      },
      {
        name: 'x', type: 'number', required: false,
        description: 'X coordinate for click action (screen pixels from top-left).',
      },
      {
        name: 'y', type: 'number', required: false,
        description: 'Y coordinate for click action (screen pixels from top-left).',
      },
      {
        name: 'button', type: 'string', required: false,
        description: 'Mouse button for click: "left" (default) or "right".',
      },
      {
        name: 'delay', type: 'number', required: false,
        description: 'Delay in ms before action (useful for waiting for apps to load). Default: 0.',
      },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const action = String(params['action'] || '').trim();
    const target = params['target'] ? String(params['target']).trim() : '';
    const text = params['text'] ? String(params['text']) : (params['keys'] ? String(params['keys']) : '');
    const x = Number(params['x']) || 0;
    const y = Number(params['y']) || 0;
    const button = String(params['button'] || 'left');
    const delay = Number(params['delay']) || 0;

    if (!action) {
      return { success: false, error: 'Parameter "action" is required', duration: 0 };
    }

    // Optional delay before action (skip for wait — it uses delay itself)
    if (delay > 0 && action !== 'wait') {
      await new Promise(r => setTimeout(r, Math.min(delay, 10_000)));
    }

    try {
      const { result, duration } = await this.timed(() => this.runAction(action, target, text, x, y, button, delay));
      return { success: true, data: result, duration };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('Desktop automation failed', { action, error: msg });
      return { success: false, error: msg, duration: 0 };
    }
  }

  private async runAction(action: string, target: string, text: string, x: number, y: number, button: string, delay = 0): Promise<unknown> {
    switch (action) {
      case 'list_windows':
        return this.execScript(
          IS_WINDOWS ? PS_LIST_WINDOWS : IS_MACOS ? macCmd_listWindows() : linuxCmd_listWindows()
        );

      case 'focus_window':
        if (!target) throw new Error('Parameter "target" is required for focus_window');
        return this.execScript(
          IS_WINDOWS ? psScript_focusWindow(target) : IS_MACOS ? macCmd_focusWindow(target) : linuxCmd_focusWindow(target)
        );

      case 'open_app':
        if (!target) throw new Error('Parameter "target" is required for open_app');
        return this.execScript(
          IS_WINDOWS ? psScript_openApp(target) : IS_MACOS ? macCmd_openApp(target) : linuxCmd_openApp(target)
        );

      case 'send_keys':
      case 'key_combo':
        if (!text) throw new Error('Parameter "text" is required for send_keys');
        return this.execScript(
          IS_WINDOWS ? psScript_sendKeys(text) : IS_MACOS ? macCmd_sendKeys(text) : linuxCmd_sendKeys(text)
        );

      case 'type_text':
        if (!text) throw new Error('Parameter "text" is required for type_text');
        return this.execScript(
          IS_WINDOWS ? psScript_typeText(text) : IS_MACOS ? macCmd_typeText(text) : linuxCmd_typeText(text)
        );

      case 'click':
        if (!x && !y) throw new Error('Parameters "x" and "y" are required for click');
        return this.execScript(
          IS_WINDOWS ? psScript_click(x, y, button) : IS_MACOS ? macCmd_click(x, y) : linuxCmd_click(x, y)
        );

      case 'screenshot': {
        if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
        const filename = `screenshot_${Date.now()}.png`;
        const outputPath = resolve(SCREENSHOT_DIR, filename);
        const result = await this.execScript(
          IS_WINDOWS ? psScript_screenshot(outputPath, target || undefined) : IS_MACOS ? macCmd_screenshot(outputPath, target || undefined) : linuxCmd_screenshot(outputPath)
        );
        return { output: result, path: outputPath, filename };
      }

      case 'wait': {
        const waitMs = Math.min(Math.max(delay || Number(target) || Number(text) || 1000, 100), 10_000);
        await new Promise(r => setTimeout(r, waitMs));
        return `WAITED: ${waitMs}ms`;
      }

      case 'get_clipboard':
        return this.execScript(
          IS_WINDOWS
            ? '$clip = powershell.exe -STA -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetText()"; Write-Output $clip'
            : IS_MACOS ? 'pbpaste 2>/dev/null || echo ""'
            : 'xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null || echo ""'
        );

      case 'read_screen': {
        if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
        const ocrFile = `ocr_${Date.now()}.png`;
        const ocrPath = resolve(SCREENSHOT_DIR, ocrFile);
        await this.execScript(
          IS_WINDOWS ? psScript_screenshot(ocrPath, target || undefined) : IS_MACOS ? macCmd_screenshot(ocrPath, target || undefined) : linuxCmd_screenshot(ocrPath)
        );
        if (!existsSync(ocrPath)) throw new Error('Screenshot failed — no image captured');
        if (IS_WINDOWS) {
          const ocrText = await this.execScript(psScript_ocrImage(ocrPath), false, 30_000);
          return { screenshot: ocrPath, text: ocrText || '(no text detected)' };
        }
        // macOS: Vision framework OCR (native, no install needed)
        if (IS_MACOS) {
          const macOcrText = await this.execScript(macCmd_ocr(ocrPath), false, 30_000).catch(() => '');
          return { screenshot: ocrPath, text: macOcrText || '(OCR failed — try: brew install tesseract)' };
        }
        // Linux: use tesseract OCR
        const linuxOcrText = await this.execScript(linuxCmd_ocr(ocrPath), false, 30_000).catch(() => '');
        return { screenshot: ocrPath, text: linuxOcrText || '(OCR not available — install tesseract: sudo apt install tesseract-ocr)' };
      }

      case 'read_window_text': {
        if (!target) throw new Error('Parameter "target" is required for read_window_text');
        return this.execScript(
          IS_WINDOWS
            ? psScript_readWindowText(target)
            : IS_MACOS ? macCmd_readWindowText(target)
            : linuxCmd_readWindowText(target),
          false,
          20_000
        );
      }

      case 'system_info': {
        const info = {
          os: process.platform,
          arch: process.arch,
          isWindows: IS_WINDOWS,
          isLinux: IS_LINUX,
          isMacOS: IS_MACOS,
          isWayland: IS_WAYLAND,
          nodeVersion: process.version,
          user: process.env['USER'] || process.env['USERNAME'] || 'unknown',
          isRoot: IS_WINDOWS ? false : (process.getuid?.() === 0),
          capabilities: {
            screenshot: IS_WINDOWS ? 'CopyFromScreen' : IS_MACOS ? 'screencapture (native)' : (IS_WAYLAND ? (hasLinuxDep('grim') ? 'grim' : 'missing') : (hasLinuxDep('scrot') ? 'scrot' : (hasLinuxDep('gnome-screenshot') ? 'gnome-screenshot' : 'missing'))),
            ocr: IS_WINDOWS ? 'Windows.Media.Ocr' : IS_MACOS ? 'Vision framework (native)' : (hasLinuxDep('tesseract') ? 'tesseract' : 'missing (sudo apt install tesseract-ocr)'),
            windowControl: IS_WINDOWS ? 'WinAPI' : IS_MACOS ? 'AppleScript (native)' : (IS_WAYLAND ? (hasLinuxDep('wlrctl') ? 'wlrctl' : (hasLinuxDep('swaymsg') ? 'swaymsg' : 'missing')) : (hasLinuxDep('wmctrl') ? 'wmctrl' : (hasLinuxDep('xdotool') ? 'xdotool' : 'missing'))),
            input: IS_WINDOWS ? 'SendKeys' : IS_MACOS ? 'AppleScript (native)' : (IS_WAYLAND ? (hasLinuxDep('ydotool') ? 'ydotool' : (hasLinuxDep('wtype') ? 'wtype' : 'missing')) : (hasLinuxDep('xdotool') ? 'xdotool' : 'missing')),
            clipboard: IS_WINDOWS ? 'PowerShell' : IS_MACOS ? 'pbcopy/pbpaste (native)' : (hasLinuxDep('xclip') ? 'xclip' : (hasLinuxDep('xsel') ? 'xsel' : 'missing')),
          },
        };
        return info;
      }

      default:
        throw new Error(`Unknown action: "${action}". Valid: list_windows, focus_window, open_app, send_keys, type_text, click, screenshot, key_combo, wait, get_clipboard, read_screen, read_window_text, system_info`);
    }
  }

  private execScript(script: string, rawCmd = false, timeout = 15_000): Promise<string> {
    return new Promise((resolve, reject) => {
      let shell: string;
      let args: string[];
      if (rawCmd) {
        const parts = script.split(' ');
        shell = parts[0];
        args = parts.slice(1);
      } else {
        shell = IS_WINDOWS ? 'powershell.exe' : '/bin/bash';
        args = IS_WINDOWS
          ? ['-NoProfile', '-NonInteractive', '-Command', script]
          : ['-c', script];
      }

      execFile(shell, args, {
        timeout,
        maxBuffer: MAX_OUTPUT,
        env: { ...process.env, FORCE_COLOR: '0' },
      }, (error, stdout, stderr) => {
        if (error && !stdout) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }
}
