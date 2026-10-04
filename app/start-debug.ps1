param([switch]$CheckOnly, [switch]$OpenIfRunning, [ValidateRange(1024,65535)][int]$Port = 39223)
$ErrorActionPreference = 'Stop'

# Resolve the current Store package rather than pinning a versioned WindowsApps path.
$package = Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1
if (!$package) { throw 'OpenAI.Codex Store package was not found for this Windows user.' }
[xml]$manifest = Get-Content -LiteralPath (Join-Path $package.InstallLocation 'AppxManifest.xml')
$app = @($manifest.Package.Applications.Application) | Where-Object { $_.Executable -match '(^|[/\\])(ChatGPT|Codex)\.exe$' } | Select-Object -First 1
if (!$app) { throw 'The package does not declare the expected desktop app.' }
$appId = $package.PackageFamilyName + '!' + $app.Id
$executable = [IO.Path]::GetFullPath((Join-Path $package.InstallLocation $app.Executable))
$running = @(Get-Process -Name 'ChatGPT','Codex' -ErrorAction SilentlyContinue | Where-Object {
    try { !$_.Path -or $_.Path -ieq $executable } catch { $true }
})

if (!('ChatIndexProbe.StoreActivation' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace ChatIndexProbe {
    [ComImport, Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IApplicationActivationManager {
        [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appId,
            [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
        [PreserveSig] int ActivateForFile([MarshalAs(UnmanagedType.LPWStr)] string appId,
            IntPtr items, [MarshalAs(UnmanagedType.LPWStr)] string verb, out uint processId);
        [PreserveSig] int ActivateForProtocol([MarshalAs(UnmanagedType.LPWStr)] string appId,
            IntPtr items, out uint processId);
    }
    public static class StoreActivation {
        [DllImport("ole32.dll", PreserveSig=true)]
        private static extern int CoCreateInstance(ref Guid clsid, IntPtr outer, uint context,
            ref Guid iid, out IntPtr instance);
        public static uint Launch(string appId, string arguments) {
            Guid clsid = new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C");
            Guid iid = new Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D");
            IntPtr pointer = IntPtr.Zero;
            object manager = null;
            try {
                // CLSCTX_LOCAL_SERVER keeps activation alive after this launcher exits.
                Marshal.ThrowExceptionForHR(CoCreateInstance(ref clsid, IntPtr.Zero, 4, ref iid, out pointer));
                manager = Marshal.GetObjectForIUnknown(pointer);
                uint processId;
                Marshal.ThrowExceptionForHR(((IApplicationActivationManager)manager).ActivateApplication(appId, arguments, 0, out processId));
                return processId;
            } finally {
                if (manager != null && Marshal.IsComObject(manager)) Marshal.ReleaseComObject(manager);
                if (pointer != IntPtr.Zero) Marshal.Release(pointer);
            }
        }
    }
}
'@
}

Write-Host ('Package: ' + $package.Name + ' ' + $package.Version)
Write-Host ('App ID: ' + $appId)
Write-Host ('Running client processes: ' + $running.Count)
if ($CheckOnly) { Write-Host 'Preflight complete. No application was launched.'; exit 0 }
if ($running.Count -gt 0) {
    if ($OpenIfRunning) {
        try { $existingDebug = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $Port + '/json/version') -TimeoutSec 2 } catch { $existingDebug = $null }
        if ($existingDebug.Browser -and $existingDebug.webSocketDebuggerUrl) {
            [void][ChatIndexProbe.StoreActivation]::Launch($appId, '')
            Write-Host ('Debug endpoint ready: http://127.0.0.1:' + $Port)
            exit 0
        }
    }
    throw 'Fully quit the desktop client, including the tray instance, then run this launcher again. No processes were stopped.'
}

$socket = New-Object Net.Sockets.TcpClient
try {
    $connect = $socket.ConnectAsync('127.0.0.1', $Port)
    $occupied = $connect.Wait(800) -and $socket.Connected
} catch { $occupied = $false } finally { $socket.Dispose() }
if ($occupied) { throw ('Port ' + $Port + ' is already occupied. No application was launched.') }

$arguments = '--remote-debugging-address=127.0.0.1 --remote-debugging-port=' + $Port
$launchedProcessId = [ChatIndexProbe.StoreActivation]::Launch($appId, $arguments)
Write-Host ('Client launch requested. Process: ' + $launchedProcessId)
Write-Host 'Waiting up to 20 seconds for the local debugging endpoint...'
$ready = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
        $version = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $Port + '/json/version') -TimeoutSec 1
        if ($version.Browser -and $version.webSocketDebuggerUrl) { $ready = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 700
}
if (!$ready) { throw 'The debug endpoint did not become available. The client may ignore these flags; this is not a successful connection test.' }
Write-Host ('Debug endpoint ready: http://127.0.0.1:' + $Port)
Write-Host 'Local connection ready. Open a ChatGPT conversation for Timeline. Keep this port local.'
