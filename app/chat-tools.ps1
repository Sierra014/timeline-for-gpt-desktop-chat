param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
trap {
    if ($CheckOnly) { [Console]::Error.WriteLine('Control window check failed: ' + $_.Exception.GetType().Name); exit 1 }
    try {
        $failureFolder = Join-Path $PSScriptRoot 'data'
        [void][IO.Directory]::CreateDirectory($failureFolder)
        [IO.File]::WriteAllText((Join-Path $failureFolder 'bootstrap-error.log'),('Startup failed: ' + $_.Exception.GetType().Name))
    } catch { }
    try { [void][Windows.Forms.MessageBox]::Show('对话工具启动失败。请检查完整解压和目录写入权限；详情见 app/data/bootstrap-error.log。','Chat Tools') } catch { }
    exit 1
}
# Set DPI context before creating any Forms/ToolStrip/NotifyIcon handles.
if (!('ChatTools.Display' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace ChatTools {
    public static class Display {
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] static extern int GetAwarenessFromDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] static extern IntPtr GetThreadDpiAwarenessContext();
        public static int Enable() {
            try {
                SetProcessDpiAwarenessContext(new IntPtr(-4));
                SetThreadDpiAwarenessContext(new IntPtr(-4));
                return GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext());
            } catch (EntryPointNotFoundException) { return -1; }
        }
    }
}
'@
}
$script:dpiAwareness = [ChatTools.Display]::Enable()
[AppContext]::SetSwitch('Switch.System.Windows.Forms.DoNotSupportDpiChanges',$false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$script:dataFolder = Join-Path $PSScriptRoot 'data'
$script:preferencesPath = Join-Path $script:dataFolder 'preferences.json'
$script:statusPath = Join-Path $script:dataFolder 'combined-status.json'
$script:preferences = @{enabled=$true; timelineEnabled=$true; generation=0; timelineGeneration=0; removeGeneration=0; timelineRemoveGeneration=0; side=$null; stopSession=''}
try {
    $stored = Get-Content -LiteralPath $script:preferencesPath -Raw | ConvertFrom-Json
    if ($stored.enabled -is [bool]) { $script:preferences.enabled = $stored.enabled }
    if ($stored.timelineEnabled -is [bool]) { $script:preferences.timelineEnabled = $stored.timelineEnabled }
    if ($stored.side -in @('left','right')) { $script:preferences.side = $stored.side }
    foreach ($key in @('generation','removeGeneration','timelineGeneration','timelineRemoveGeneration')) {
        if ($stored.$key -is [int] -and $stored.$key -ge 0) { $script:preferences[$key] = $stored.$key }
    }
} catch { }
$script:session = [Guid]::NewGuid().ToString('N')
$script:worker = $null
$script:launcher = $null
$script:quitting = $false
$script:launchProblem = ''
$script:nodePath = Join-Path $PSScriptRoot 'runtime\node.exe'
if (!(Test-Path -LiteralPath $script:nodePath)) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (!$nodeCommand) { throw 'Node runtime missing. Extract the complete package.' }
    $script:nodePath = $nodeCommand.Source
}

$script:form = New-Object Windows.Forms.Form
$script:form.SuspendLayout()
$script:form.AutoScaleMode = 'None'
$script:form.Text = '对话工具'
$script:form.ClientSize = New-Object Drawing.Size(490,390)
$script:form.StartPosition = 'CenterScreen'
$script:form.FormBorderStyle = 'FixedDialog'
$script:form.MaximizeBox = $false
$script:form.BackColor = [Drawing.Color]::FromArgb(252,249,250)
$script:uiFont = New-Object Drawing.Font('Microsoft YaHei UI',10,[Drawing.FontStyle]::Regular,[Drawing.GraphicsUnit]::Point)
$script:form.Font = $script:uiFont
$script:icons = @{}
foreach ($styleName in @('pen')) {
    $iconPath = Join-Path $PSScriptRoot ('assets\' + $styleName + '.ico')
    if (Test-Path -LiteralPath $iconPath) { $script:icons[$styleName] = New-Object Drawing.Icon($iconPath) }
}
function Apply-Icon {
    $icon = $script:icons['pen']
    if (!$icon) { $icon = [Drawing.SystemIcons]::Application }
    $script:form.Icon = $icon
    if ($script:notify) {
        $previous = $script:trayIcon
        $script:trayIcon = New-Object Drawing.Icon($icon,[Windows.Forms.SystemInformation]::SmallIconSize)
        $script:notify.Icon = $script:trayIcon
        if ($previous) { $previous.Dispose() }
    }
}
Apply-Icon
function Add-Label([string]$text,[int]$x,[int]$y,[int]$width,[int]$height) {
    $label = New-Object Windows.Forms.Label
    $label.Text = $text; $label.Location = New-Object Drawing.Point($x,$y)
    $label.Size = New-Object Drawing.Size($width,$height)
    $script:form.Controls.Add($label); return $label
}
function Add-Button([string]$text,[int]$x,[int]$y,[int]$width,[scriptblock]$click) {
    $button = New-Object Windows.Forms.Button
    $button.Text = $text; $button.Location = New-Object Drawing.Point($x,$y)
    $button.Size = New-Object Drawing.Size($width,34)
    $button.FlatStyle = 'Flat'; $button.FlatAppearance.BorderColor = [Drawing.Color]::FromArgb(225,216,220)
    $button.BackColor = [Drawing.Color]::White
    $button.Add_Click($click); $script:form.Controls.Add($button); return $button
}
$heading = Add-Label '对话工具' 24 20 300 35
$heading.Font = New-Object Drawing.Font('Microsoft YaHei UI',17,[Drawing.FontStyle]::Bold)
$caption = Add-Label '索引与标注 · v0.1.15' 25 59 430 23
$caption.ForeColor = [Drawing.Color]::FromArgb(112,104,109)
$script:statusLabel = Add-Label '正在启动…' 25 95 440 48
$script:statusLabel.Font = New-Object Drawing.Font('Microsoft YaHei UI',10,[Drawing.FontStyle]::Bold)
$script:detailLabel = Add-Label 'ChatGPT 加载索引与标注，Codex 加载标注。' 25 147 440 40
$script:detailLabel.ForeColor = [Drawing.Color]::FromArgb(115,108,112)
$script:autoBox = New-Object Windows.Forms.CheckBox
$script:autoBox.Text = '自动加载标注'; $script:autoBox.Checked = $script:preferences.enabled
$script:autoBox.Location = New-Object Drawing.Point(250,195)
$script:autoBox.Size = New-Object Drawing.Size(210,25)
$script:form.Controls.Add($script:autoBox)
$script:timelineBox = New-Object Windows.Forms.CheckBox
$script:timelineBox.Text = '自动加载对话索引'; $script:timelineBox.Checked = $script:preferences.timelineEnabled
$script:timelineBox.Location = New-Object Drawing.Point(25,195)
$script:timelineBox.Size = New-Object Drawing.Size(215,25)
$script:form.Controls.Add($script:timelineBox)
$script:sideLabel = Add-Label '索引位置' 25 234 90 25
$script:sideBox = New-Object Windows.Forms.ComboBox
$script:sideBox.DropDownStyle = 'DropDownList'
$script:sideBox.Location = New-Object Drawing.Point(119,231)
$script:sideBox.Size = New-Object Drawing.Size(150,26)
[void]$script:sideBox.Items.AddRange(@('沿用原偏好','左侧','右侧'))
$script:sideBox.SelectedIndex = switch ($script:preferences.side) { 'left' {1}; 'right' {2}; default {0} }
$script:form.Controls.Add($script:sideBox)

$script:lang = 'zh'
$script:updatingLocale = $false
$script:lastThemeSignature = ''
$script:i18n = @{
    zh = @{
        title = '对话工具'; caption = '索引与标注 · v0.1.15'; starting = '正在启动…'
        defaultDetail = 'ChatGPT 加载索引与标注，Codex 加载标注。'
        autoAnnotate = '自动加载标注'; autoTimeline = '自动加载对话索引'; sideLabel = '索引位置'
        sideItems = @('沿用原偏好','左侧','右侧')
        openClient = '打开客户端'; reload = '重新加载'; removePause = '移除并暂停'
        userGuide = '使用说明'; diagnostics = '诊断目录'; hideToTray = '收起到托盘'
        menuItems = @('显示运行窗口','打开客户端','重新加载','退出')
        featureTimeline = '对话索引'; featureAnnotations = '标注'
        stateWaitingTarget = '等待适用对话'; statePaused = '已暂停'; stateWaitingConv = '等待打开对话'
        stateWaitingHistory = '目录已加载，历史待重试'; stateWaitingApp = '等待客户端启动'
        stateAdapterError = '部分窗口加载失败'; stateWaitingDebug = '等待调试连接'
        waitingLocalDebug = '等待本机调试连接'
        waitingLocalDebugDetail = '点击“打开客户端”；已普通启动时需要先从客户端托盘退出。'
        connectedDetail = '新窗口与页面刷新会自动加载。'
        retryDetail = '正在重试；排查步骤见 README-AGENT.md。'
        launchIncomplete = '启动未完成；若客户端已普通启动，请从托盘退出后再点“打开客户端”。'
        workerExited = '监视进程已退出'; workerExitedDetail = '正在自动恢复监视；详情见诊断目录。'
        startupFailed = '助手启动失败，请查看目录权限及 README-AGENT.md。'
        legacyRunning = '请先从托盘退出旧 Timeline 和标注助手，再启动合并版。已保存的书签与标注会保留。'
    }
    en = @{
        title = 'Chat Tools'; caption = 'Timeline & Annotations · v0.1.15'; starting = 'Starting…'
        defaultDetail = 'Timeline & Annotations in ChatGPT; Annotations in Codex.'
        autoAnnotate = 'Auto-load Annotations'; autoTimeline = 'Auto-load Timeline'; sideLabel = 'Rail side'
        sideItems = @('Keep preference','Left','Right')
        openClient = 'Open Client'; reload = 'Reload'; removePause = 'Remove & Pause'
        userGuide = 'User Guide'; diagnostics = 'Diagnostics'; hideToTray = 'Hide to Tray'
        menuItems = @('Show Window','Open Client','Reload','Exit')
        featureTimeline = 'Timeline'; featureAnnotations = 'Annotations'
        stateWaitingTarget = 'Waiting for supported chat'; statePaused = 'Paused'; stateWaitingConv = 'Waiting for conversation'
        stateWaitingHistory = 'Loaded, history pending retry'; stateWaitingApp = 'Waiting for client startup'
        stateAdapterError = 'Failed in some windows'; stateWaitingDebug = 'Waiting for debug connection'
        waitingLocalDebug = 'Waiting for local debug connection'
        waitingLocalDebugDetail = 'Click "Open Client"; if already running normally, exit it from tray first.'
        connectedDetail = 'New windows and page refreshes load automatically.'
        retryDetail = 'Retrying; see README-AGENT.md for troubleshooting.'
        launchIncomplete = 'Launch incomplete; if client is running normally, exit it from tray first.'
        workerExited = 'Monitor process exited'; workerExitedDetail = 'Recovering monitor automatically; see Diagnostics for details.'
        startupFailed = 'Helper startup failed; check folder permissions and README-AGENT.md.'
        legacyRunning = 'Please exit the legacy Timeline and Annotations helpers from the tray first. Saved data will be kept.'
    }
}
function Get-Strings { return $script:i18n[$script:lang] }

function Save-Preferences {
    [void][IO.Directory]::CreateDirectory($script:dataFolder)
    $temporary = $script:preferencesPath + '.tmp'
    [IO.File]::WriteAllText($temporary,($script:preferences | ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $script:preferencesPath -Force
}
function Write-WorkerEvent([string]$eventName,[int]$ownedPid=0,[int]$exitCode=0) {
    try {
        $file = Join-Path $script:dataFolder 'worker-events.jsonl'
        if ((Test-Path -LiteralPath $file) -and (Get-Item -LiteralPath $file).Length -gt 262144) { Move-Item -LiteralPath $file -Destination ($file + '.1') -Force }
        $entry = @{at=[DateTime]::UtcNow.ToString('o');event=$eventName;workerPid=$ownedPid;exitCode=$exitCode}
        [IO.File]::AppendAllText($file,(($entry | ConvertTo-Json -Compress) + "`n"),(New-Object Text.UTF8Encoding($false)))
    } catch { }
}
function Start-Worker {
    if ($script:worker -and !$script:worker.HasExited) { return }
    if ($script:worker) { $script:worker.Dispose(); $script:worker = $null }
    Save-Preferences
    $script:workerExitRecorded = $false
    $script:lastWorkerStart = [DateTime]::UtcNow
    $script:worker = Start-Process -FilePath $script:nodePath -ArgumentList @(
        ('"' + (Join-Path $PSScriptRoot 'chat-tools-monitor.cjs') + '"'),
        ('--parent=' + $PID), ('--session=' + $script:session)
    ) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $script:dataFolder 'monitor-console.log') `
      -RedirectStandardError (Join-Path $script:dataFolder 'monitor-error.log')
    [void]$script:worker.Handle # Retain the native handle so ExitCode remains available after a fast exit.
    Write-WorkerEvent 'supervisor-start' $script:worker.Id
}
function Maintain-Worker {
    if ($script:quitting -or !$script:worker -or !$script:worker.HasExited) { return }
    if (!$script:workerExitRecorded) {
        $script:worker.WaitForExit()
        Write-WorkerEvent 'unexpected-worker-exit' $script:worker.Id $script:worker.ExitCode
        $script:workerExitRecorded = $true
    }
    if (([DateTime]::UtcNow - $script:lastWorkerStart).TotalSeconds -lt 5) { return }
    try { Start-Worker } catch {
        $script:lastWorkerStart = [DateTime]::UtcNow
        Write-WorkerEvent 'supervisor-restart-failed'
    }
}
function Open-Client {
    if ($script:launcher -and !$script:launcher.HasExited) { return }
    if ($script:launcher) { $script:launcher.Dispose(); $script:launcher = $null }
    $script:launchProblem = ''
    $script:launcher = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @(
        '-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + (Join-Path $PSScriptRoot 'start-debug.ps1') + '"'),'-OpenIfRunning'
    ) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $script:dataFolder 'launch.log') `
      -RedirectStandardError (Join-Path $script:dataFolder 'launch-error.log')
    [void]$script:launcher.Handle
}
function Show-Window {
    $script:form.Show(); $script:form.WindowState = 'Normal'; [void]$script:form.Activate()
}
function Reload-Tools {
    $script:preferences.enabled = $true; $script:autoBox.Checked = $true
    $script:preferences.timelineEnabled = $true; $script:timelineBox.Checked = $true
    $script:preferences.generation++; $script:preferences.timelineGeneration++; Save-Preferences; Start-Worker
}
function Remove-Tools {
    $script:preferences.enabled = $false; $script:autoBox.Checked = $false
    $script:preferences.timelineEnabled = $false; $script:timelineBox.Checked = $false
    $script:preferences.removeGeneration++; $script:preferences.timelineRemoveGeneration++; Save-Preferences; Start-Worker
}
$script:autoBox.Add_CheckedChanged({
    $script:preferences.enabled = $script:autoBox.Checked
    Save-Preferences; Start-Worker
})
$script:timelineBox.Add_CheckedChanged({
    $script:preferences.timelineEnabled = $script:timelineBox.Checked
    Save-Preferences; Start-Worker
})
$script:sideBox.Add_SelectedIndexChanged({
    if ($script:updatingLocale) { return }
    $script:preferences.side = @($null,'left','right')[$script:sideBox.SelectedIndex]
    $script:preferences.timelineGeneration++; Save-Preferences; Start-Worker
})
$btnOpen = Add-Button '打开客户端' 24 280 135 { Open-Client }
$reload = Add-Button '重新加载' 170 280 135 { Reload-Tools }
$reload.BackColor = [Drawing.Color]::FromArgb(232,62,118); $reload.ForeColor = [Drawing.Color]::White
$reload.FlatAppearance.BorderSize = 0
$btnRemove = Add-Button '移除并暂停' 316 280 150 { Remove-Tools }
$btnGuide = Add-Button '使用说明' 24 336 135 {
    $readme = Join-Path $PSScriptRoot 'README.md'
    if (!(Test-Path -LiteralPath $readme)) { $readme = Join-Path $PSScriptRoot '..\README.md' }
    Invoke-Item -LiteralPath $readme
}
$btnDiag = Add-Button '诊断目录' 170 336 135 { Invoke-Item -LiteralPath $script:dataFolder }
$btnHide = Add-Button '收起到托盘' 316 336 150 { $script:form.Hide() }
$script:ordinaryButtons = @($btnOpen, $btnRemove, $btnGuide, $btnDiag, $btnHide)
$script:notify = New-Object Windows.Forms.NotifyIcon
$script:notify.Icon = $script:form.Icon; $script:notify.Text = 'Chat Tools'
Apply-Icon
# Native Windows popup: system drawing, menu font and DPI scaling.
$script:menu = New-Object Windows.Forms.ContextMenu
foreach ($entry in @(
    @('显示运行窗口',{ Show-Window }), @('打开客户端',{ Open-Client }),
    @('重新加载',{ Reload-Tools }), @('退出',{ $script:quitting = $true; $script:form.Close() })
)) {
    $item = New-Object Windows.Forms.MenuItem($entry[0]); $item.Add_Click($entry[1])
    [void]$script:menu.MenuItems.Add($item)
}
$script:notify.ContextMenu = $script:menu

function ConvertTo-Color([string]$hex, [Drawing.Color]$fallback) {
    if ($hex -and $hex -match '^#[\da-fA-F]{6}$') {
        try { return [Drawing.ColorTranslator]::FromHtml($hex) } catch { }
    }
    return $fallback
}
function Blend-Color([Drawing.Color]$a, [Drawing.Color]$b, [double]$weightB) {
    $w = [Math]::Max(0.0, [Math]::Min(1.0, $weightB))
    $r = [int][Math]::Round($a.R * (1.0 - $w) + $b.R * $w)
    $g = [int][Math]::Round($a.G * (1.0 - $w) + $b.G * $w)
    $bl = [int][Math]::Round($a.B * (1.0 - $w) + $b.B * $w)
    return [Drawing.Color]::FromArgb($r, $g, $bl)
}
function Apply-Locale([string]$nextLang) {
    if ($nextLang -notin @('zh','en')) { return }
    if ($script:lang -eq $nextLang -and $heading.Text -eq $script:i18n[$nextLang].title) { return }
    $script:lang = $nextLang
    $s = Get-Strings
    $script:form.Text = $s.title
    $heading.Text = $s.title
    $caption.Text = $s.caption
    if ($script:statusLabel.Text -in @($script:i18n.zh.starting, $script:i18n.en.starting)) {
        $script:statusLabel.Text = $s.starting
    }
    if ($script:detailLabel.Text -in @($script:i18n.zh.defaultDetail, $script:i18n.en.defaultDetail)) {
        $script:detailLabel.Text = $s.defaultDetail
    }
    $script:autoBox.Text = $s.autoAnnotate
    $script:timelineBox.Text = $s.autoTimeline
    $script:sideLabel.Text = $s.sideLabel
    $script:updatingLocale = $true
    try {
        for ($i = 0; $i -lt 3; $i++) { $script:sideBox.Items[$i] = $s.sideItems[$i] }
    } finally { $script:updatingLocale = $false }
    $btnOpen.Text = $s.openClient
    $reload.Text = $s.reload
    $btnRemove.Text = $s.removePause
    $btnGuide.Text = $s.userGuide
    $btnDiag.Text = $s.diagnostics
    $btnHide.Text = $s.hideToTray
    for ($i = 0; $i -lt $script:menu.MenuItems.Count; $i++) {
        $script:menu.MenuItems[$i].Text = $s.menuItems[$i]
    }
}
function Apply-UiTheme($theme) {
    if (!$theme) { return }
    if ($theme.lang) { Apply-Locale ([string]$theme.lang) }
    $sig = "$($theme.dark)|$($theme.bg)|$($theme.surface)|$($theme.ink)|$($theme.muted)|$($theme.border)|$($theme.accent)"
    if ($sig -eq $script:lastThemeSignature) { return }
    $script:lastThemeSignature = $sig
    $bgRaw = ConvertTo-Color $theme.bg ([Drawing.Color]::FromArgb(252,249,250))
    $surfaceRaw = ConvertTo-Color $theme.surface ([Drawing.Color]::White)
    $inkColor = ConvertTo-Color $theme.ink ([Drawing.Color]::FromArgb(41,36,42))
    $mutedColor = ConvertTo-Color $theme.muted ([Drawing.Color]::FromArgb(112,104,109))
    $borderColor = ConvertTo-Color $theme.border ([Drawing.Color]::FromArgb(225,216,220))
    $accentColor = ConvertTo-Color $theme.accent ([Drawing.Color]::FromArgb(232,62,118))
    $isDark = [bool]$theme.dark
    $formBg = if ($isDark) { $bgRaw } else { Blend-Color $bgRaw $surfaceRaw 0.55 }
    $btnBg = if ($isDark) { Blend-Color $surfaceRaw $inkColor 0.08 } else { $surfaceRaw }
    $script:form.BackColor = $formBg
    $script:form.ForeColor = $inkColor
    $heading.ForeColor = $inkColor
    $caption.ForeColor = $mutedColor
    $script:statusLabel.ForeColor = $inkColor
    $script:detailLabel.ForeColor = $mutedColor
    $script:autoBox.ForeColor = $inkColor
    $script:timelineBox.ForeColor = $inkColor
    $script:sideLabel.ForeColor = $inkColor
    $script:sideBox.BackColor = $btnBg
    $script:sideBox.ForeColor = $inkColor
    foreach ($btn in $script:ordinaryButtons) {
        $btn.BackColor = $btnBg
        $btn.ForeColor = $inkColor
        $btn.FlatAppearance.BorderColor = $borderColor
    }
    $lum = $accentColor.R * 0.299 + $accentColor.G * 0.587 + $accentColor.B * 0.114
    $reload.BackColor = $accentColor
    $reload.ForeColor = if ($lum -gt 165) { [Drawing.Color]::FromArgb(36,33,44) } else { [Drawing.Color]::White }
}
try {
    if (Test-Path -LiteralPath $script:statusPath) {
        $initialStatus = Get-Content -LiteralPath $script:statusPath -Raw | ConvertFrom-Json
        if ($initialStatus.uiTheme) { Apply-UiTheme $initialStatus.uiTheme }
    }
} catch { }
$script:notify.Add_MouseClick({
    if ($_.Button -eq [Windows.Forms.MouseButtons]::Left) { Show-Window }
})
$script:form.Add_FormClosing({
    if (!$script:quitting -and $_.CloseReason -eq [Windows.Forms.CloseReason]::UserClosing) {
        $_.Cancel = $true; $script:form.Hide()
    }
})
$script:form.AutoScaleMode = 'Dpi'
# AutoScaleMode resets the design DPI; restore 96 after assigning the mode.
$script:form.AutoScaleDimensions = New-Object Drawing.SizeF(96,96)
$script:form.ResumeLayout($true)
if ($CheckOnly) {
    Write-Output ('Control window check passed. Controls: ' + $script:form.Controls.Count + '; tray actions: ' + $script:menu.MenuItems.Count + '; DPI awareness: ' + $script:dpiAwareness + '; font: ' + $script:uiFont.Name + '. No client or worker launched.')
    $script:notify.Dispose(); $script:menu.Dispose(); $script:form.Dispose()
    $script:trayIcon.Dispose(); foreach ($icon in $script:icons.Values) { $icon.Dispose() }; exit 0
}

$created = $false
$mutex = [Threading.Mutex]::new($true,'Local\ChatToolsTray-v1',[ref]$created)
if (!$created) {
    for ($attempt=0; $attempt -lt 10; $attempt++) {
        try {
            $event = [Threading.EventWaitHandle]::OpenExisting('Local\ChatToolsOpen-v1')
            [void]$event.Set(); $event.Dispose(); break
        } catch { Start-Sleep -Milliseconds 100 }
    }
    $mutex.Dispose(); $script:notify.Dispose(); $script:menu.Dispose(); $script:form.Dispose(); exit 0
}
$legacyMutexes = @()
foreach ($legacyName in @('Local\ChatTimelineTray-v1','Local\ChatAnnotationsTray-v1')) {
    $legacyCreated = $false
    $legacyMutex = [Threading.Mutex]::new($true,$legacyName,[ref]$legacyCreated)
    if (!$legacyCreated) {
        $legacyMutex.Dispose()
        foreach ($held in $legacyMutexes) { $held.ReleaseMutex(); $held.Dispose() }
        $mutex.ReleaseMutex(); $mutex.Dispose()
        $script:notify.Dispose(); $script:menu.Dispose(); $script:form.Dispose()
        [void][Windows.Forms.MessageBox]::Show((Get-Strings).legacyRunning,'Chat Tools')
        exit 1
    }
    $legacyMutexes += $legacyMutex
}
$openEvent = [Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::AutoReset,'Local\ChatToolsOpen-v1')
$script:lastStatusWriteTime = [DateTime]::MinValue
$script:cachedStatus = $null
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({
    if ($openEvent.WaitOne(0)) { Show-Window }
    Maintain-Worker
    if ($script:launcher -and $script:launcher.HasExited) {
        $script:launcher.WaitForExit()
        if ($script:launcher.ExitCode -ne 0) { $script:launchProblem = 'launchIncomplete' }
        $script:launcher.Dispose(); $script:launcher = $null
    }
    try {
        $statusItem = Get-Item -LiteralPath $script:statusPath -ErrorAction Stop
        if ($statusItem.LastWriteTimeUtc -ne $script:lastStatusWriteTime) {
            $script:cachedStatus = Get-Content -LiteralPath $script:statusPath -Raw | ConvertFrom-Json
            $script:lastStatusWriteTime = $statusItem.LastWriteTimeUtc
        }
    } catch { }
    $status = $script:cachedStatus
    if ($status -and $status.uiTheme) { Apply-UiTheme $status.uiTheme }
    $s = Get-Strings
    $label = $s.waitingLocalDebug
    $detail = $s.waitingLocalDebugDetail
    $waitingConnection = $true
    try {
        if ($script:worker -and $status -and $status.workerPid -eq $script:worker.Id -and ([DateTime]::UtcNow - [DateTime]::Parse($status.at).ToUniversalTime()).TotalSeconds -lt 90) {
            $lines = @()
            foreach ($entry in @(@($s.featureTimeline,$status.timeline),@($s.featureAnnotations,$status.annotations))) {
                $feature = $entry[1]
                $state = switch ($feature.phase) {
                    'connected' {
                        if ($feature.installed -gt 0) {
                            if ($script:lang -eq 'en') { 'Loaded in ' + $feature.installed + ' window(s)' } else { '已加载 ' + $feature.installed + ' 个窗口' }
                        } else { $s.stateWaitingTarget }
                    }
                    'paused' { $s.statePaused }
                    'waiting-conversation' { $s.stateWaitingConv }
                    'waiting-history' { $s.stateWaitingHistory }
                    'waiting-application' { $s.stateWaitingApp }
                    'adapter-error' { $s.stateAdapterError }
                    default { $s.stateWaitingDebug }
                }
                $lines += ($entry[0] + ' · ' + $state)
            }
            $label = $lines -join "`r`n"
            $detail = $s.connectedDetail
            if ($status.timeline.failed -gt 0 -or $status.annotations.failed -gt 0) { $detail = $s.retryDetail }
            $waitingConnection = ($status.timeline.phase -eq 'waiting-debug' -and $status.annotations.phase -eq 'waiting-debug')
        }
    } catch { }
    if ($script:launchProblem -and $waitingConnection) { $detail = if ($s[$script:launchProblem]) { $s[$script:launchProblem] } else { $script:launchProblem } }
    if ($script:worker -and $script:worker.HasExited) { $label = $s.workerExited; $detail = $s.workerExitedDetail }
    if ($script:statusLabel.Text -cne $label) { $script:statusLabel.Text = $label }
    if ($script:detailLabel.Text -cne $detail) { $script:detailLabel.Text = $detail }
    $text = $s.title + ' · ' + $label.Replace("`r`n",' / ')
    $shortText = $text.Substring(0,[Math]::Min(63,$text.Length))
    if ($script:notify.Text -cne $shortText) { $script:notify.Text = $shortText }
})
$script:form.Add_Shown({
    try {
        Start-Worker
        # Reuse the current local debugging session.
        try { $endpoint = Invoke-RestMethod -Uri 'http://127.0.0.1:39223/json/version' -TimeoutSec 1 } catch { $endpoint = $null }
        if (!$endpoint.Browser) { Open-Client }
    } catch { $script:launchProblem = 'startupFailed' }
})
try {
    $script:notify.Visible = $true; $timer.Start()
    [Windows.Forms.Application]::Run($script:form)
} finally {
    $timer.Stop(); $timer.Dispose()
    $script:preferences.stopSession = $script:session
    try { Save-Preferences } catch { }
    if ($script:worker) {
        if (!$script:worker.HasExited -and !$script:worker.WaitForExit(3000)) { $script:worker.Kill() }
        $script:worker.Dispose()
    }
    if ($script:launcher) { $script:launcher.Dispose() }
    $script:notify.Visible = $false; $script:notify.Dispose(); $script:menu.Dispose(); $script:form.Dispose()
    $script:trayIcon.Dispose(); foreach ($icon in $script:icons.Values) { $icon.Dispose() }
    $openEvent.Dispose(); foreach ($held in $legacyMutexes) { $held.ReleaseMutex(); $held.Dispose() }; $mutex.ReleaseMutex(); $mutex.Dispose()
}
