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
[void](Add-Label '索引位置' 25 234 90 25)
$script:sideBox = New-Object Windows.Forms.ComboBox
$script:sideBox.DropDownStyle = 'DropDownList'
$script:sideBox.Location = New-Object Drawing.Point(119,231)
$script:sideBox.Size = New-Object Drawing.Size(150,26)
[void]$script:sideBox.Items.AddRange(@('沿用原偏好','左侧','右侧'))
$script:sideBox.SelectedIndex = switch ($script:preferences.side) { 'left' {1}; 'right' {2}; default {0} }
$script:form.Controls.Add($script:sideBox)

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
    $script:preferences.side = @($null,'left','right')[$script:sideBox.SelectedIndex]
    $script:preferences.timelineGeneration++; Save-Preferences; Start-Worker
})
[void](Add-Button '打开客户端' 24 280 135 { Open-Client })
$reload = Add-Button '重新加载' 170 280 135 { Reload-Tools }
$reload.BackColor = [Drawing.Color]::FromArgb(232,62,118); $reload.ForeColor = [Drawing.Color]::White
$reload.FlatAppearance.BorderSize = 0
[void](Add-Button '移除并暂停' 316 280 150 { Remove-Tools })
[void](Add-Button '使用说明' 24 336 135 {
    $readme = Join-Path $PSScriptRoot 'README.md'
    if (!(Test-Path -LiteralPath $readme)) { $readme = Join-Path $PSScriptRoot '..\README.md' }
    Invoke-Item -LiteralPath $readme
})
[void](Add-Button '诊断目录' 170 336 135 { Invoke-Item -LiteralPath $script:dataFolder })
[void](Add-Button '收起到托盘' 316 336 150 { $script:form.Hide() })
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
        [void][Windows.Forms.MessageBox]::Show('请先从托盘退出旧 Timeline 和标注助手，再启动合并版。已保存的书签与标注会保留。','Chat Tools')
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
        if ($script:launcher.ExitCode -ne 0) { $script:launchProblem = '启动未完成；若客户端已普通启动，请从托盘退出后再点“打开客户端”。' }
        $script:launcher.Dispose(); $script:launcher = $null
    }
    $label = '等待本机调试连接'
    $detail = '点击“打开客户端”；已普通启动时需要先从客户端托盘退出。'
    try {
        $statusItem = Get-Item -LiteralPath $script:statusPath -ErrorAction Stop
        if ($statusItem.LastWriteTimeUtc -ne $script:lastStatusWriteTime) {
            $script:cachedStatus = Get-Content -LiteralPath $script:statusPath -Raw | ConvertFrom-Json
            $script:lastStatusWriteTime = $statusItem.LastWriteTimeUtc
        }
        $status = $script:cachedStatus
        if ($script:worker -and $status -and $status.workerPid -eq $script:worker.Id -and ([DateTime]::UtcNow - [DateTime]::Parse($status.at).ToUniversalTime()).TotalSeconds -lt 90) {
            $lines = @()
            foreach ($entry in @(@('对话索引',$status.timeline),@('标注',$status.annotations))) {
                $feature = $entry[1]
                $state = switch ($feature.phase) {
                    'connected' { if ($feature.installed -gt 0) { '已加载 ' + $feature.installed + ' 个窗口' } else { '等待适用对话' } }
                    'paused' {'已暂停'}
                    'waiting-conversation' {'等待打开对话'}
                    'waiting-history' {'目录已加载，历史待重试'}
                    'waiting-application' {'等待客户端启动'}
                    'adapter-error' {'部分窗口加载失败'}
                    default {'等待调试连接'}
                }
                $lines += ($entry[0] + ' · ' + $state)
            }
            $label = $lines -join "`r`n"
            $detail = '新窗口与页面刷新会自动加载。'
            if ($status.timeline.failed -gt 0 -or $status.annotations.failed -gt 0) { $detail = '正在重试；排查步骤见 README-AGENT.md。' }
        }
    } catch { }
    if ($script:launchProblem -and $label -like '*等待*连接*') { $detail = $script:launchProblem }
    if ($script:worker -and $script:worker.HasExited) { $label = '监视进程已退出'; $detail = '正在自动恢复监视；详情见诊断目录。' }
    if ($script:statusLabel.Text -cne $label) { $script:statusLabel.Text = $label }
    if ($script:detailLabel.Text -cne $detail) { $script:detailLabel.Text = $detail }
    $text = '对话工具 · ' + $label.Replace("`r`n",' / ')
    $shortText = $text.Substring(0,[Math]::Min(63,$text.Length))
    if ($script:notify.Text -cne $shortText) { $script:notify.Text = $shortText }
})
$script:form.Add_Shown({
    try {
        Start-Worker
        # Reuse the current local debugging session.
        try { $endpoint = Invoke-RestMethod -Uri 'http://127.0.0.1:39223/json/version' -TimeoutSec 1 } catch { $endpoint = $null }
        if (!$endpoint.Browser) { Open-Client }
    } catch { $script:launchProblem = '助手启动失败，请查看目录权限及 README-AGENT.md。' }
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
