param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
trap {
    $errorFolder = Join-Path $PSScriptRoot 'data'
    [void][IO.Directory]::CreateDirectory($errorFolder)
    $errorFile = Join-Path $errorFolder 'tray-bootstrap-error.log'
    [IO.File]::WriteAllText($errorFile, ('Tray startup failed. Error type: ' + $_.Exception.GetType().Name))
    try { [void][Windows.Forms.MessageBox]::Show('助手启动失败，请查看 app/data/tray-bootstrap-error.log。', 'Chat Timeline') } catch { }
    exit 1
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$script:toolFolder = $PSScriptRoot
$script:dataFolder = Join-Path $PSScriptRoot 'data'
$script:preferencesPath = Join-Path $script:dataFolder 'tray-preferences.json'
$script:statusPath = Join-Path $script:dataFolder 'tray-status.json'
$script:preferences = @{ enabled = $true; side = $null; generation = 0; removeGeneration = 0; stopSession = '' }
try {
    $readPath = $script:preferencesPath
    if (!(Test-Path -LiteralPath $readPath)) { $readPath = Join-Path $script:toolFolder 'tray-preferences.json' }
    $stored = Get-Content -LiteralPath $readPath -Raw | ConvertFrom-Json
    if ($stored.enabled -is [bool]) { $script:preferences.enabled = $stored.enabled }
    if ($stored.side -in @('left','right')) { $script:preferences.side = $stored.side }
    if ($stored.generation -is [int] -and $stored.generation -ge 0) { $script:preferences.generation = $stored.generation }
    if ($stored.removeGeneration -is [int] -and $stored.removeGeneration -ge 0) { $script:preferences.removeGeneration = $stored.removeGeneration }
} catch { }
$script:nodePath = Join-Path $PSScriptRoot 'runtime\node.exe'
if (!(Test-Path -LiteralPath $script:nodePath)) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (!$nodeCommand) { throw 'Node runtime not found. Extract the complete portable package.' }
    $script:nodePath = $nodeCommand.Source
}
$script:worker = $null
$script:launcher = $null
$script:session = [Guid]::NewGuid().ToString('N')
$script:lastWorkerError = $false
$script:lastPhase = ''
$script:notify = New-Object Windows.Forms.NotifyIcon
$script:notify.Icon = [Drawing.SystemIcons]::Information
$script:notify.Text = 'Chat Timeline'
$script:menu = New-Object Windows.Forms.ContextMenuStrip
$script:context = New-Object Windows.Forms.ApplicationContext

function Save-Preferences {
    $temporary = $script:preferencesPath + '.tmp'
    [IO.File]::WriteAllText($temporary, ($script:preferences | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
        try { Move-Item -LiteralPath $temporary -Destination $script:preferencesPath -Force; return }
        catch { if ($attempt -eq 4) { throw }; Start-Sleep -Milliseconds 25 }
    }
}
function Show-Notice([string]$text) {
    $script:notify.ShowBalloonTip(5000, 'Chat Timeline', $text, [Windows.Forms.ToolTipIcon]::Info)
}
function Test-LocalDebugReady {
    try {
        $version = Invoke-RestMethod -Uri 'http://127.0.0.1:39223/json/version' -TimeoutSec 1
        $address = [Uri]$version.webSocketDebuggerUrl
        return [bool]($version.Browser -and $address.Scheme -eq 'ws' -and $address.Host -in @('127.0.0.1','localhost','[::1]','::1') -and $address.Port -eq 39223)
    } catch { return $false }
}
function Complete-Launcher {
    $script:launcher.WaitForExit()
    $exitCode = $script:launcher.ExitCode
    $ready = Test-LocalDebugReady
    $result = @{at = [DateTime]::UtcNow.ToString('o'); exitCode = $exitCode; endpointReady = $ready}
    try { [IO.File]::WriteAllText((Join-Path $script:dataFolder 'tray-launch-result.json'), ($result | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false))) } catch { }
    if (!$ready -and ($null -eq $exitCode -or $exitCode -ne 0)) {
        Show-Notice 'GPT 未通过助手启动。若它已普通启动，请从客户端托盘退出，再点“打开 GPT”。详情见 app/data/tray-launch-error.log。'
    }
    $script:launcher.Dispose(); $script:launcher = $null
}
function Start-Worker {
    if ($script:worker -and !$script:worker.HasExited) { return }
    if ($script:worker) { $script:worker.Dispose(); $script:worker = $null }
    Save-Preferences
    $monitorFile = Join-Path $script:toolFolder 'timeline-monitor.cjs'
    $script:worker = Start-Process -FilePath $script:nodePath -ArgumentList @(
        ('"' + $monitorFile + '"'), ('--parent=' + $PID), ('--session=' + $script:session)
    ) -WorkingDirectory $script:toolFolder -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $script:dataFolder 'tray-monitor-console.log') `
        -RedirectStandardError (Join-Path $script:dataFolder 'tray-monitor-error.log')
    $script:lastWorkerError = $false
}
function Open-Client {
    try {
        Start-Worker
        if ($script:launcher -and !$script:launcher.HasExited) { return }
        $launcherFile = Join-Path $script:toolFolder 'start-debug.ps1'
        $script:launcher = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $launcherFile + '"'), '-OpenIfRunning'
        ) -WorkingDirectory $script:toolFolder -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $script:dataFolder 'tray-launch.log') `
            -RedirectStandardError (Join-Path $script:dataFolder 'tray-launch-error.log')
        # Keep the process handle so ExitCode stays available after timer polling.
        [void]$script:launcher.Handle
    } catch { Show-Notice '无法启动助手进程，请查看工具目录中的托盘日志。' }
}
function Add-Menu([string]$text, [scriptblock]$click) {
    $item = New-Object Windows.Forms.ToolStripMenuItem($text)
    if ($click) { $item.Add_Click($click) }
    [void]$script:menu.Items.Add($item)
    return $item
}
$script:statusItem = Add-Menu '正在启动…' $null
$script:statusItem.Enabled = $false
[void]$script:menu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
[void](Add-Menu '打开 GPT（自动安装索引）' { Open-Client })
$script:autoItem = Add-Menu '自动安装索引' {
    $script:preferences.enabled = $script:autoItem.Checked
    Save-Preferences
}
$script:autoItem.CheckOnClick = $true
$script:autoItem.Checked = $script:preferences.enabled
[void](Add-Menu '重新加载索引' {
    $script:preferences.enabled = $true; $script:autoItem.Checked = $true
    $script:preferences.generation++; Save-Preferences; Start-Worker
})
$script:leftItem = Add-Menu '索引放在左侧' {
    $script:preferences.side = 'left'; $script:preferences.generation++
    $script:leftItem.Checked = $true; $script:rightItem.Checked = $false; Save-Preferences
}
$script:rightItem = Add-Menu '索引放在右侧' {
    $script:preferences.side = 'right'; $script:preferences.generation++
    $script:leftItem.Checked = $false; $script:rightItem.Checked = $true; Save-Preferences
}
$script:leftItem.Checked = $script:preferences.side -eq 'left'
$script:rightItem.Checked = $script:preferences.side -eq 'right'
[void](Add-Menu '移除索引并暂停安装' {
    $script:preferences.enabled = $false; $script:autoItem.Checked = $false
    $script:preferences.removeGeneration++; Save-Preferences
})
[void]$script:menu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
[void](Add-Menu '打开日志所在目录' { Invoke-Item -LiteralPath $script:dataFolder })
[void](Add-Menu '退出助手' { $script:context.ExitThread() })
$script:notify.ContextMenuStrip = $script:menu
$script:notify.Add_MouseDoubleClick({ Open-Client })

if ($CheckOnly) {
    Write-Output ('Tray UI check passed. Menu items: ' + $script:menu.Items.Count + '. No client or monitor was launched.')
    $script:notify.Dispose(); $script:menu.Dispose(); $script:context.Dispose()
    exit 0
}

# One tray per Windows user session, even if another package copy is opened.
$created = $false
$mutex = [Threading.Mutex]::new($true, 'Local\ChatTimelineTray-v1', [ref]$created)
if (!$created) {
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        try {
            $event = [Threading.EventWaitHandle]::OpenExisting('Local\ChatTimelineOpen-v1')
            [void]$event.Set(); $event.Dispose(); break
        } catch { Start-Sleep -Milliseconds 100 }
    }
    $mutex.Dispose(); $script:notify.Dispose(); $script:menu.Dispose(); $script:context.Dispose()
    exit 0
}
$openEvent = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::AutoReset, 'Local\ChatTimelineOpen-v1')
[void][IO.Directory]::CreateDirectory($script:dataFolder)
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({
    if ($openEvent.WaitOne(0)) { Open-Client }
    if ($script:launcher -and $script:launcher.HasExited) {
        Complete-Launcher
    }
    if ($script:worker -and $script:worker.HasExited -and !$script:lastWorkerError) {
        $script:lastWorkerError = $true
        Show-Notice '监视进程已退出。点“重新加载索引”重试，或查看托盘日志。'
    }
    $label = '等待调试连接；双击此图标打开 GPT'
    try {
        $status = Get-Content -LiteralPath $script:statusPath -Raw | ConvertFrom-Json
        switch ($status.phase) {
            'connected' { $label = '已连接 · 已安装 ' + $status.installed + ' 个窗口' }
            'paused' { $label = '自动安装已暂停' }
            'adapter-error' { $label = '适配异常 · 已记录日志' }
        }
    } catch { }
    if ($script:lastWorkerError) { $label = '监视进程已退出，请重新加载' }
    $script:statusItem.Text = $label
    $text = 'Chat Timeline · ' + $label
    $script:notify.Text = $text.Substring(0, [Math]::Min(63, $text.Length))
})
try {
    $script:notify.Visible = $true
    Open-Client
    $timer.Start()
    [Windows.Forms.Application]::Run($script:context)
} finally {
    $timer.Stop(); $timer.Dispose()
    $script:preferences.stopSession = $script:session
    try { Save-Preferences } catch { }
    if ($script:worker) {
        if (!$script:worker.HasExited -and !$script:worker.WaitForExit(3000)) { $script:worker.Kill() }
        $script:worker.Dispose()
    }
    # The desktop client and its existing timeline remain open on tray exit.
    $script:notify.Visible = $false
    $script:notify.Dispose(); $script:menu.Dispose(); $script:context.Dispose()
    $openEvent.Dispose(); $mutex.ReleaseMutex(); $mutex.Dispose()
}
