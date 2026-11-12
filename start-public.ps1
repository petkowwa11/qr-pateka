# Този файл е старият временен тунел и вече не се ползва.
# За часа и за телефона се отваря https://qr-pateka.thevibehosting.com/. Този файл не се пуска.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSCommandPath
$port = 8080
$exe = Join-Path $root "tools\cloudflared.exe"
$passwordPath = Join-Path $root "data\teacher-password.txt"

function Test-GamePort {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $wait = $client.BeginConnect("127.0.0.1", $port, $null, $null)
        $ok = $wait.AsyncWaitHandle.WaitOne(500, $false)
        if (-not $ok) { return $false }
        $client.EndConnect($wait)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

if (-not (Test-GamePort)) {
    Start-Process -FilePath "powershell" -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $root "start.ps1")
    )
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-GamePort) { $ready = $true; break }
    }
    if (-not $ready) {
        Write-Host "Сървърът не тръгна. За часа отвори https://qr-pateka.thevibehosting.com/."
        exit 1
    }
}

if (Test-Path -LiteralPath $passwordPath) {
    $saved = ([System.IO.File]::ReadAllText($passwordPath, [System.Text.Encoding]::UTF8)).Trim()
    if ($saved.Length -lt 10) {
        Write-Host "Кодът за учителя е къс за страница, отворена към интернет."
        Write-Host "Смени го от менюто Нов код, преди да оставиш адреса отворен."
        Write-Host ""
    }
}

if (-not (Test-Path -LiteralPath $exe)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $exe) | Out-Null
    $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    Write-Host "Свалям cloudflared..."
    Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
}

$already = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
if ($already) {
    Write-Host "Публичният адрес вече е пуснат. Този прозорец не отваря втори."
    exit 0
}

$urlFile = Join-Path $root "data\public-url.txt"
$desktop = [Environment]::GetFolderPath("Desktop")
$desktopFile = Join-Path $desktop "QR-адрес.txt"
$utf8 = New-Object System.Text.UTF8Encoding $false

Write-Host "Пускам публичен адрес. Компютърът трябва да остане включен и да не заспи."
Write-Host "Като се появи https адрес, отвори него на този компютър и оттам печатай QR."
Write-Host "Ако този прозорец се затвори, адресът умира. Не го затваряй по време на часа."
Write-Host ""
$ErrorActionPreference = "Continue"
while ($true) {
    & $exe tunnel --url "http://127.0.0.1:$port" --no-autoupdate 2>&1 | ForEach-Object {
        $line = "$_"
        Write-Host $line
        if ($line -match "https://[a-z0-9-]+\.trycloudflare\.com") {
            $public = $Matches[0]
            [System.IO.File]::WriteAllText($urlFile, $public, $utf8)
            $note = "Адрес на играта:`r`n$public`r`n`r`nОтвори го, преди да печаташ QR. Ако компютърът е заспал или прозорецът е затворен, адресът спира."
            if ($desktop) { [System.IO.File]::WriteAllText($desktopFile, $note, $utf8) }
        }
    }
    Write-Host "Връзката спря. Пускам нов адрес. Старите QR кодове спират."
    Start-Sleep -Seconds 5
}
