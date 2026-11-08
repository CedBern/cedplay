<#
.SYNOPSIS
Collecte un diagnostic CedPlay ADB sans modifier l'appareil.
.DESCRIPTION
Exemple : powershell -File application/scripts/diagnostic-tv.ps1 -Serial <cible-adb>
Ne lance pas l'application, ne remet aucun compteur a zero et ne conserve aucun
journal brut. Les compteurs gfxinfo sont historiques, pas une mesure d'un scenario.
Codes : 2 prerequis/chemin, 10 non autorise, 11 appareil indisponible,
12 application arretee, 13 commande ADB ou donnees attendues absentes, 14 ecriture.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._:-]+$')]
    [string]$Serial,
    [string]$AdbPath = '',
    [ValidateRange(5, 120)]
    [int]$TimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$packageName = 'com.lecteur.iptv'

function Stop-Diagnostic([int]$Code, [string]$Message) {
    [Console]::Error.WriteLine(('DIAGNOSTIC_E{0}: {1}' -f $Code, $Message))
    exit $Code
}

function Invoke-AdbRead([string[]]$Arguments) {
    # Aucun shell intermediaire : les arguments restent des donnees.
    $allArguments = @('-s', $Serial) + $Arguments
    $quoted = foreach ($argument in $allArguments) {
        '"' + ($argument -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
    }
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $script:resolvedAdb
    $start.Arguments = $quoted -join ' '
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { Stop-Diagnostic 13 'Demarrage ADB impossible.' }
        $outputTask = $process.StandardOutput.ReadToEndAsync()
        $errorTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill()
            Stop-Diagnostic 13 'Delai de lecture ADB depasse.'
        }
        $result = [pscustomobject]@{
            ExitCode = $process.ExitCode
            Output = $outputTask.GetAwaiter().GetResult()
            ErrorText = $errorTask.GetAwaiter().GetResult()
        }
        if ($result.ErrorText -match '(?i)unauthorized|device still authorizing' -or $result.Output.Trim() -eq 'unauthorized') {
            Stop-Diagnostic 10 'Appareil non autorise : accepter la demande ADB sur son ecran.'
        }
        if ($result.ErrorText -match '(?i)device offline|device .* not found|no devices|cannot connect|closed' -or $result.Output.Trim() -eq 'offline') {
            Stop-Diagnostic 11 'Appareil ADB indisponible.'
        }
        return $result
    } catch {
        Stop-Diagnostic 13 'Echec de lecture ADB. Aucune sortie brute conservee.'
    } finally {
        $process.Dispose()
    }
}

function Read-Adb([string[]]$Arguments) {
    $result = Invoke-AdbRead $Arguments
    if ($result.ExitCode -ne 0) { Stop-Diagnostic 13 'Une commande de lecture ADB a echoue.' }
    return $result.Output
}

try {
    $projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'application\android\app\build.gradle') -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $projectRoot 'application\package.json') -PathType Leaf)) {
        Stop-Diagnostic 2 'Racine CedPlay introuvable depuis le dossier du script.'
    }
    $outputDirectory = [IO.Path]::GetFullPath((Join-Path $projectRoot 'preuves\diagnostic-tv'))
    if (-not $outputDirectory.StartsWith($projectRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        Stop-Diagnostic 2 'Dossier de sortie hors du projet.'
    }
    # Un lien de repertoire pourrait sortir du projet malgre le chemin apparent.
    foreach ($candidate in @($projectRoot, (Join-Path $projectRoot 'preuves'), $outputDirectory)) {
        if (Test-Path -LiteralPath $candidate) {
            if ((Get-Item -LiteralPath $candidate -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                Stop-Diagnostic 2 'Le chemin de sortie traverse un lien de repertoire.'
            }
        }
    }
    if (-not $AdbPath) {
        $sdkAdb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
        if (Test-Path -LiteralPath $sdkAdb -PathType Leaf) { $AdbPath = $sdkAdb }
        else {
            $adbCommand = Get-Command adb.exe -CommandType Application -ErrorAction SilentlyContinue
            if ($adbCommand) { $AdbPath = $adbCommand.Source }
        }
    }
    if (-not $AdbPath -or -not (Test-Path -LiteralPath $AdbPath -PathType Leaf)) {
        Stop-Diagnostic 2 'ADB introuvable. Fournir -AdbPath.'
    }
    $script:resolvedAdb = (Resolve-Path -LiteralPath $AdbPath).Path
} catch { Stop-Diagnostic 2 'Prerequis ou chemin invalide.' }

$state = (Read-Adb @('get-state')).Trim()
if ($state -ne 'device') { Stop-Diagnostic 11 'Appareil ADB indisponible.' }
$processResult = Invoke-AdbRead @('shell', 'pidof', $packageName)
if ($processResult.Output.Trim() -eq '' -and $processResult.ExitCode -in @(0, 1)) {
    Stop-Diagnostic 12 'CedPlay est arretee. Ouvrir l application avant la collecte.'
}
if ($processResult.ExitCode -ne 0 -or $processResult.Output.Trim() -notmatch '^\d+(?:\s+\d+)*$') {
    Stop-Diagnostic 13 'Lecture du processus CedPlay impossible.'
}
$appProcesses = @($processResult.Output.Trim() -split '\s+')

$model = (Read-Adb @('shell', 'getprop', 'ro.product.model')).Trim()
$manufacturer = (Read-Adb @('shell', 'getprop', 'ro.product.manufacturer')).Trim()
$androidVersion = (Read-Adb @('shell', 'getprop', 'ro.build.version.release')).Trim()
$androidSdk = (Read-Adb @('shell', 'getprop', 'ro.build.version.sdk')).Trim()
if ($model -notmatch '^[A-Za-z0-9 ()_.+\-]{1,96}$' -or $manufacturer -notmatch '^[A-Za-z0-9 ()_.+\-]{1,96}$' -or
    $androidVersion -notmatch '^\d+(?:\.\d+){0,3}$' -or $androidSdk -notmatch '^\d{1,3}$') {
    Stop-Diagnostic 13 'Proprietes Android hors du format autorise.'
}
$packageInfo = Read-Adb @('shell', 'dumpsys', 'package', $packageName)
$versionName = [regex]::Match($packageInfo, '(?m)^\s*versionName=(\d+(?:\.\d+){1,3})\s*$')
$versionCode = [regex]::Match($packageInfo, '(?m)^\s*versionCode=(\d+)\b')
if (-not $versionName.Success -or -not $versionCode.Success) {
    Stop-Diagnostic 13 'Version CedPlay introuvable.'
}

$gfxRaw = Read-Adb @('shell', 'dumpsys', 'gfxinfo', $packageName)
$gfx = [ordered]@{}
$gfxLabels = [ordered]@{
    'Total frames rendered' = 'total_frames'
    'Janky frames' = 'janky_frames'
    'Janky frames (legacy)' = 'janky_frames_legacy'
    '50th percentile' = 'frame_p50_ms'
    '90th percentile' = 'frame_p90_ms'
    '95th percentile' = 'frame_p95_ms'
    '99th percentile' = 'frame_p99_ms'
    'Number Missed Vsync' = 'missed_vsync'
    'Number High input latency' = 'high_input_latency'
    'Number Slow UI thread' = 'slow_ui_thread'
    'Number Slow bitmap uploads' = 'slow_bitmap_uploads'
    'Number Slow issue draw commands' = 'slow_draw_commands'
    'Number Frame deadline missed' = 'frame_deadline_missed'
    'Number Frame deadline missed (legacy)' = 'frame_deadline_missed_legacy'
}
foreach ($entry in $gfxLabels.GetEnumerator()) {
    $match = [regex]::Match($gfxRaw, '(?m)^\s*' + [regex]::Escape($entry.Key) + ':\s*(\d+)(?:ms)?(?:\s+\(([0-9.]+)%\))?\s*\r?$')
    if ($match.Success) {
        $gfx[$entry.Value] = [long]$match.Groups[1].Value
        if ($entry.Value -eq 'janky_frames' -and $match.Groups[2].Success) {
            $gfx['janky_percent'] = [double]::Parse($match.Groups[2].Value, [Globalization.CultureInfo]::InvariantCulture)
        }
    }
}

$memoryRaw = Read-Adb @('shell', 'dumpsys', 'meminfo', '-s', $packageName)
$memory = [ordered]@{}
$memoryLabels = [ordered]@{
    'Java Heap' = 'java_heap_pss_kb'; 'Native Heap' = 'native_heap_pss_kb'
    'Code' = 'code_pss_kb'; 'Stack' = 'stack_pss_kb'; 'Graphics' = 'graphics_pss_kb'
    'Private Other' = 'private_other_pss_kb'; 'System' = 'system_pss_kb'
    'TOTAL PSS' = 'total_pss_kb'; 'TOTAL RSS' = 'total_rss_kb'
    'TOTAL SWAP PSS' = 'total_swap_pss_kb'; 'TOTAL SWAP (KB)' = 'total_swap_kb'
}
foreach ($entry in $memoryLabels.GetEnumerator()) {
    $match = [regex]::Match($memoryRaw, '(?m)^\s*' + [regex]::Escape($entry.Key) + ':\s*(\d+)\b')
    if ($match.Success) { $memory[$entry.Value] = [long]$match.Groups[1].Value }
}
if ($memory.Count -eq 0) { Stop-Diagnostic 13 'Compteurs memoire absents.' }

$events = New-Object System.Collections.Generic.List[object]
$skipped = New-Object System.Collections.Generic.List[long]
$eventPatterns = [ordered]@{
    'activity_created' = '^activity_created elapsed_ms=(\d+)$'
    'first_frame' = '^first_frame elapsed_ms=(\d+) prepare_ms=(\d+)$'
    'zap_first_frame' = '^zap_first_frame zap_ms=(\d+)$'
    'session_summary' = '^session_summary duration_ms=(\d+) zaps=(\d+) rebuffers=(\d+) rebuffer_ms=(\d+) dropped_frames=(\d+) errors=(\d+)(?: last_error=\d+)?$'
}
foreach ($appProcess in $appProcesses) {
    $logRaw = Read-Adb @('logcat', '-d', ('--pid=' + $appProcess), '-v', 'tag', 'IPTV-Playback:I', 'Choreographer:I', '*:S')
    foreach ($line in ($logRaw -split '\r?\n')) {
        # Le tag est controle avant le contenu ; aucune ligne brute ne sort de cette boucle.
        $tagged = [regex]::Match($line, '^[VDIWEF]/(IPTV-Playback|Choreographer)\s*:\s*(.*)$')
        if (-not $tagged.Success) { continue }
        $message = $tagged.Groups[2].Value.Trim()
        if ($tagged.Groups[1].Value -eq 'Choreographer') {
            $skip = [regex]::Match($message, '^Skipped (\d+) frames!')
            if ($skip.Success) { $skipped.Add([long]$skip.Groups[1].Value) }
            continue
        }
        foreach ($entry in $eventPatterns.GetEnumerator()) {
            $eventMatch = [regex]::Match($message, $entry.Value)
            if (-not $eventMatch.Success) { continue }
            $numbers = @()
            for ($index = 1; $index -lt $eventMatch.Groups.Count; $index++) { $numbers += [long]$eventMatch.Groups[$index].Value }
            $events.Add([ordered]@{ event = $entry.Key; values = $numbers })
            break
        }
    }
}

# Le PID sert seulement de filtre en memoire ; il ne figure jamais dans le rapport.
$report = [ordered]@{
    schema_version = 1
    collected_at_utc = [DateTime]::UtcNow.ToString('o')
    device = [ordered]@{ manufacturer = $manufacturer; model = $model; android_version = $androidVersion; android_sdk = [int]$androidSdk }
    cedplay = [ordered]@{ version = $versionName.Groups[1].Value; version_code = [long]$versionCode.Groups[1].Value }
    gfxinfo = $gfx
    memory_kb = $memory
    playback_event_fields = [ordered]@{
        activity_created = @('elapsed_ms'); first_frame = @('elapsed_ms', 'prepare_ms')
        zap_first_frame = @('zap_ms')
        session_summary = @('duration_ms', 'zaps', 'rebuffers', 'rebuffer_ms', 'dropped_frames', 'errors')
    }
    playback_events = @($events.ToArray())
    choreographer_skipped_frames = @($skipped.ToArray())
    limits = @(
        'gfxinfo historique du processus : aucun compteur remis a zero, aucun scenario isole.'
        'gfxinfo ne mesure pas seul les images du lecteur video natif ou la fluidite percue.'
        'logcat borne aux PID CedPlay actuellement actifs et aux lignes encore presentes dans le tampon.'
        'Les evenements de processus termines et les mesures absentes ne sont pas recuperes.'
        'Aucune interaction appareil ni validation du son ou du fournisseur.'
    )
}
try {
    [void][IO.Directory]::CreateDirectory($outputDirectory)
    $fileName = 'diagnostic-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 6) + '.json'
    $reportPath = Join-Path $outputDirectory $fileName
    [IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
    Write-Output ('Diagnostic anonymise : ' + $reportPath)
} catch { Stop-Diagnostic 14 'Ecriture du rapport impossible.' }
