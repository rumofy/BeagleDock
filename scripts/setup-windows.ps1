# Installs BeagleDock on Windows from source, with everything it needs, in one step:
#
#   irm https://raw.githubusercontent.com/rumofy/BeagleDock/main/scripts/setup-windows.ps1 | iex
#   # or, from a checkout:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
#
# 1. Installs what is missing through winget: Git, Node.js LTS, Python and Visual Studio Build
#    Tools with the C++ workload, the Spectre-mitigated libraries (node-pty requires them) and
#    CMake (local dictation). Installing those asks for administrator approval (UAC) once.
# 2. Clones the repository into %USERPROFILE%\BeagleDock (or uses the checkout it runs from).
# 3. Runs `npm run update`: dependencies, build (app, dictation engine, installer) and a silent
#    per-user install, which needs no administrator rights.
#
# Running it again only does what is still missing, then updates BeagleDock in place.
# Environment (optional): BEAGLEDOCK_DIR to choose the checkout folder.

function Install-BeagleDock {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    function Say([string] $message) { Write-Host "BeagleDock setup: $message" }
    function Fail([string] $message) { throw "BeagleDock setup: error: $message" }

    if ($PSVersionTable.PSVersion.Major -lt 6) {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Fail 'winget not found. Install "App Installer" from the Microsoft Store and run this again.'
    }

    function Update-PathFromRegistry {
        $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
        $user = [Environment]::GetEnvironmentVariable('Path', 'User')
        $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
    }

    function Install-WingetPackage([string] $id, [string[]] $extra = @()) {
        Say "installing $id (winget)"
        $wingetArgs = @('install', '--id', $id, '-e', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity') + $extra
        & winget @wingetArgs
        # -1978335189: already installed and up to date.
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) { Fail "winget couldn't install $id (exit $LASTEXITCODE)" }
        Update-PathFromRegistry
    }

    function Test-Command([string] $name, [string[]] $versionArgs = @('--version')) {
        if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { return $false }
        try {
            $null = & $name @versionArgs 2>$null
            return $LASTEXITCODE -eq 0
        } catch { return $false }
    }

    # --- Git, Node.js, Python
    if (-not (Test-Command git)) { Install-WingetPackage 'Git.Git' }
    $nodeOk = $false
    if (Test-Command node) {
        $v = (& node -p "process.versions.node").Trim().Split('.') | ForEach-Object { [int]$_ }
        $nodeOk = ($v[0] -gt 22) -or ($v[0] -eq 22 -and $v[1] -ge 12)
    }
    if (-not $nodeOk) { Install-WingetPackage 'OpenJS.NodeJS.LTS' }
    # The "python" in WindowsApps is only a Store shortcut: --version fails until Python is installed.
    if (-not (Test-Command python)) { Install-WingetPackage 'Python.Python.3.12' }

    # --- Visual Studio Build Tools (C++, Spectre-mitigated libraries, CMake)
    $components = @(
        'Microsoft.VisualStudio.Workload.VCTools',
        'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        'Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre',
        'Microsoft.VisualStudio.Component.VC.CMake.Project'
    )
    $installer = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer'
    $vswhere = Join-Path $installer 'vswhere.exe'
    $buildTools = $null
    if (Test-Path $vswhere) {
        $buildTools = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1
    }
    if (-not $buildTools) {
        $adds = ($components | ForEach-Object { "--add $_" }) -join ' '
        Install-WingetPackage 'Microsoft.VisualStudio.2022.BuildTools' @('--override', "--quiet --wait --norestart --includeRecommended $adds")
        $buildTools = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1
        if (-not $buildTools) { Fail 'Visual Studio Build Tools did not install the C++ tools.' }
    } else {
        $missing = $components | Where-Object {
            -not (& $vswhere -latest -products * -requires $_ -property installationPath | Select-Object -First 1)
        }
        if ($missing) {
            Say "adding to Build Tools: $($missing -join ', ') (asks for administrator approval)"
            $modifyArgs = @('modify', '--installPath', "`"$buildTools`"", '--quiet', '--norestart') + ($missing | ForEach-Object { @('--add', $_) })
            $p = Start-Process -FilePath (Join-Path $installer 'setup.exe') -ArgumentList $modifyArgs -Verb RunAs -Wait -PassThru
            if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { Fail "the Visual Studio Installer failed (exit $($p.ExitCode))." }
        }
    }

    # --- The checkout
    $dir = $env:BEAGLEDOCK_DIR
    if (-not $dir -and $PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot '..\package.json'))) {
        $dir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
    }
    if (-not $dir) { $dir = Join-Path $env:USERPROFILE 'BeagleDock' }
    if (-not (Test-Path (Join-Path $dir 'package.json'))) {
        Say "cloning into $dir"
        & git clone https://github.com/rumofy/BeagleDock.git $dir
        if ($LASTEXITCODE -ne 0) { Fail 'git clone failed.' }
    }

    # --- Build and install (npm run update)
    Remove-Item Env:NoDefaultCurrentDirectoryInExePath -ErrorAction SilentlyContinue
    Push-Location $dir
    try {
        & node scripts/update.mjs
        if ($LASTEXITCODE -ne 0) { Fail "the build or install failed (exit $LASTEXITCODE)." }
    } finally {
        Pop-Location
    }
    Say 'done. Open BeagleDock from the Start menu. To update later: npm run update (in the checkout) or run this again.'
}

Install-BeagleDock
