# За часа и за телефона се ползва https://qr-pateka.thevibehosting.com/. Този файл не се пуска преди това. Той е само местно копие на един компютър.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSCommandPath
$port = 8080
$utf8 = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Web.Extensions
$script:Serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$script:Serializer.MaxJsonLength = 8000000
$script:Serializer.RecursionLimit = 20
$storePath = Join-Path $root "data\store.json"
$seedPath = Join-Path $root "data\seed.json"
$passwordPath = Join-Path $root "data\teacher-password.txt"
$script:TeacherTokens = @{}

function Get-LanIPv4 {
    $skip = "Loopback|vEthernet|Bluetooth|Virtual|VMware|Hyper-V|WSL|Default Switch"
    $items = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notlike "127.*" -and
            $_.IPAddress -notlike "169.254.*" -and
            $_.InterfaceAlias -notmatch $skip
        }
    $picked = $items | Where-Object { $_.PrefixOrigin -eq "Dhcp" } | Select-Object -First 1
    if (-not $picked) { $picked = $items | Select-Object -First 1 }
    if ($picked) { return $picked.IPAddress }
    return $null
}

function Read-HttpRequest([System.Net.Sockets.NetworkStream]$stream) {
    $ms = New-Object System.IO.MemoryStream
    $buffer = New-Object byte[] 4096
    $headerEnd = -1
    while ($ms.Length -lt 900000) {
        $n = $stream.Read($buffer, 0, $buffer.Length)
        if ($n -le 0) { break }
        $ms.Write($buffer, 0, $n)
        $raw = $ms.ToArray()
        for ($i = 0; $i -le $raw.Length - 4; $i++) {
            if ($raw[$i] -eq 13 -and $raw[$i + 1] -eq 10 -and $raw[$i + 2] -eq 13 -and $raw[$i + 3] -eq 10) {
                $headerEnd = $i
                break
            }
        }
        if ($headerEnd -ge 0) { break }
    }
    if ($headerEnd -lt 0) { return @{ Header = ""; Body = [byte[]]@() } }
    $raw = $ms.ToArray()
    $header = [System.Text.Encoding]::ASCII.GetString($raw, 0, $headerEnd)
    $contentLength = 0
    foreach ($line in ($header -split "`r`n")) {
        if ($line -match '(?i)^Content-Length:\s*(\d+)') { $contentLength = [int]$Matches[1] }
    }
    if ($contentLength -gt 400000) { $contentLength = 400000 }
    $bodyStart = $headerEnd + 4
    while (($raw.Length - $bodyStart) -lt $contentLength -and $ms.Length -lt 900000) {
        $n = $stream.Read($buffer, 0, $buffer.Length)
        if ($n -le 0) { break }
        $ms.Write($buffer, 0, $n)
        $raw = $ms.ToArray()
    }
    $body = New-Object byte[] $contentLength
    $have = [Math]::Max(0, $raw.Length - $bodyStart)
    if ($contentLength -gt 0 -and $have -gt 0) {
        [Array]::Copy($raw, $bodyStart, $body, 0, [Math]::Min($contentLength, $have))
    }
    return @{ Header = $header; Body = $body }
}

function Send-Bytes($stream, [int]$status, [string]$statusText, [string]$contentType, [byte[]]$body) {
    if (-not $body) { $body = [byte[]]@() }
    $head = "HTTP/1.1 $status $statusText`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nConnection: close`r`nCache-Control: no-cache`r`n`r`n"
    $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($hb, 0, $hb.Length)
    if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
}

function Send-Json($stream, [int]$status, [string]$statusText, $obj) {
    $json = $script:Serializer.Serialize($obj)
    Send-Bytes $stream $status $statusText "application/json; charset=utf-8" $utf8.GetBytes($json)
}

function Get-ContentType([string]$path) {
    switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
        ".html" { return "text/html; charset=utf-8" }
        ".css"  { return "text/css; charset=utf-8" }
        ".js"   { return "text/javascript; charset=utf-8" }
        ".svg"  { return "image/svg+xml" }
        ".png"  { return "image/png" }
        ".gif"  { return "image/gif" }
        ".jpg"  { return "image/jpeg" }
        ".ico"  { return "image/x-icon" }
        ".json" { return "application/json; charset=utf-8" }
        default { return "application/octet-stream" }
    }
}

function Get-Prop($obj, [string]$name) {
    if ($null -eq $obj) { return $null }
    if ($obj -is [System.Collections.IDictionary]) { return $obj[$name] }
    return $null
}

function Read-Store {
    if (-not (Test-Path -LiteralPath $storePath)) {
        Copy-Item -LiteralPath $seedPath -Destination $storePath
    }
    $json = [System.IO.File]::ReadAllText($storePath, [System.Text.Encoding]::UTF8)
    $store = $script:Serializer.DeserializeObject($json)
    if ($null -eq (Get-Prop $store "trails")) { $store["trails"] = @() }
    if ($null -eq (Get-Prop $store "results")) { $store["results"] = @() }
    return $store
}

function Write-Store($store) {
    $json = $script:Serializer.Serialize($store)
    $bom = New-Object System.Text.UTF8Encoding $true
    [System.IO.File]::WriteAllText($storePath, $json, $bom)
}

function Get-HeaderValue([string]$header, [string]$name) {
    foreach ($line in ($header -split "`r`n")) {
        $parts = $line.Split([char[]]@(":"), 2)
        if ($parts.Length -eq 2 -and $parts[0].Trim().Equals($name, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $parts[1].Trim()
        }
    }
    return ""
}

function Get-TeacherPassword {
    if (Test-Path -LiteralPath $passwordPath) {
        $saved = ([System.IO.File]::ReadAllText($passwordPath, [System.Text.Encoding]::UTF8)).Trim()
        if ($saved.Length -ge 4 -and $saved.Length -le 40 -and $saved -notmatch '[<>]') { return $saved }
    }
    $bytes = New-Object byte[] 4
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $code = ([string](([BitConverter]::ToUInt32($bytes, 0) % 900000) + 100000))
    $folder = Split-Path -Parent $passwordPath
    if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Force -Path $folder | Out-Null }
    [System.IO.File]::WriteAllText($passwordPath, $code, $utf8)
    return $code
}

function Set-TeacherPassword([string]$code) {
    [System.IO.File]::WriteAllText($passwordPath, $code, $utf8)
}

function New-TeacherToken {
    $bytes = New-Object byte[] 24
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $chars = foreach ($byte in $bytes) { $byte.ToString("x2") }
    return -join $chars
}

function Test-Teacher([string]$header) {
    $token = Get-HeaderValue $header "X-Teacher-Token"
    if (-not $token) { return $false }
    return $script:TeacherTokens.ContainsKey($token)
}

function New-Id([string]$prefix) {
    return "$prefix-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())-$(Get-Random -Minimum 100 -Maximum 999)"
}

function Get-CleanText($value, [int]$max, [int]$min = 1) {
    if ($value -isnot [string]) { return $null }
    $text = $value.Trim()
    if ($text.Length -lt $min -or $text.Length -gt $max) { return $null }
    if ($text -match '[<>]') { return $null }
    return $text
}

function ConvertTo-ArrayList($value) {
    $list = New-Object System.Collections.ArrayList
    foreach ($item in @($value)) {
        if ($null -ne $item) { [void]$list.Add($item) }
    }
    return ,$list
}

function Convert-ToDouble($value) {
    if ($value -is [int] -or $value -is [long] -or $value -is [double] -or $value -is [decimal]) {
        return [double]$value
    }
    $number = 0.0
    $styles = [System.Globalization.NumberStyles]::Float
    $culture = [System.Globalization.CultureInfo]::InvariantCulture
    if ([double]::TryParse([string]$value, $styles, $culture, [ref]$number)) { return $number }
    return $null
}

function Test-Nearly($a, $b) {
    return ([Math]::Abs(([double]$a) - ([double]$b)) -lt 0.001)
}

function New-CleanStation($raw, [string]$keepId) {
    $type = [string](Get-Prop $raw "type")
    if ($type -notin @("yesno", "numbers", "choice")) { return $null }
    $title = Get-CleanText (Get-Prop $raw "title") 80
    $teaser = Get-CleanText (Get-Prop $raw "teaser") 160
    $printPrompt = Get-CleanText (Get-Prop $raw "printPrompt") 400
    $hint = Get-CleanText (Get-Prop $raw "hint") 400
    $success = Get-CleanText (Get-Prop $raw "success") 500
    if (-not ($title -and $teaser -and $printPrompt -and $hint -and $success)) { return $null }
    $id = $keepId
    if (-not $id) { $id = New-Id "st" }
    $station = @{
        id = $id
        title = $title
        teaser = $teaser
        printPrompt = $printPrompt
        hint = $hint
        success = $success
        type = $type
    }
    $story = Get-Prop $raw "story"
    if ($story -is [string] -and $story.Trim().Length -gt 0) {
        $cleanStory = Get-CleanText $story 500
        if (-not $cleanStory) { return $null }
        $station["story"] = $cleanStory
    }
    if ($type -eq "yesno" -or $type -eq "numbers") {
        $items = ConvertTo-ArrayList (Get-Prop $raw "items")
        if ($items.Count -lt 1 -or $items.Count -gt 8) { return $null }
        $clean = New-Object System.Collections.ArrayList
        $letters = @("a", "b", "c", "d", "e", "f", "g", "h")
        for ($i = 0; $i -lt $items.Count; $i++) {
            $item = $items[$i]
            $expr = Get-CleanText (Get-Prop $item "expr") 240
            if (-not $expr) { return $null }
            if ($type -eq "yesno") {
                $answer = Get-Prop $item "answer"
                if ($answer -isnot [bool]) { return $null }
                [void]$clean.Add(@{ id = $letters[$i]; expr = $expr; answer = $answer })
            } else {
                $name = Get-CleanText (Get-Prop $item "name") 20
                $number = Convert-ToDouble (Get-Prop $item "answer")
                if ($null -eq $number) { return $null }
                if (-not $name) { return $null }
                [void]$clean.Add(@{ id = $letters[$i]; expr = $expr; name = $name; answer = $number })
            }
        }
        $station["items"] = $clean.ToArray()
    } else {
        $shown = Get-CleanText (Get-Prop $raw "shown") 240
        $wrong = Get-CleanText (Get-Prop $raw "wrong") 300
        $choices = ConvertTo-ArrayList (Get-Prop $raw "choices")
        if (-not $shown -or -not $wrong -or $choices.Count -lt 2 -or $choices.Count -gt 4) { return $null }
        $clean = New-Object System.Collections.ArrayList
        $correctCount = 0
        $letters = @("a", "b", "c", "d")
        for ($i = 0; $i -lt $choices.Count; $i++) {
            $choice = $choices[$i]
            $text = Get-CleanText (Get-Prop $choice "text") 240
            $correct = Get-Prop $choice "correct"
            if (-not $text -or $correct -isnot [bool]) { return $null }
            if ($correct) { $correctCount++ }
            [void]$clean.Add(@{ id = $letters[$i]; text = $text; correct = $correct })
        }
        if ($correctCount -ne 1) { return $null }
        $station["shown"] = $shown
        $station["wrong"] = $wrong
        $station["choices"] = $clean.ToArray()
    }
    return $station
}

function Copy-PublicStation($station) {
    $type = [string](Get-Prop $station "type")
    $public = @{
        id = [string](Get-Prop $station "id")
        title = [string](Get-Prop $station "title")
        teaser = [string](Get-Prop $station "teaser")
        hint = [string](Get-Prop $station "hint")
        type = $type
    }
    $story = Get-Prop $station "story"
    if ($story -is [string] -and $story.Length -gt 0) { $public["story"] = $story }
    if ($type -eq "yesno" -or $type -eq "numbers") {
        $items = New-Object System.Collections.ArrayList
        foreach ($item in @(Get-Prop $station "items")) {
            $row = @{ id = [string](Get-Prop $item "id"); expr = [string](Get-Prop $item "expr") }
            if ($type -eq "numbers") { $row["name"] = [string](Get-Prop $item "name") }
            [void]$items.Add($row)
        }
        $public["items"] = $items.ToArray()
    } elseif ($type -eq "choice") {
        $public["shown"] = [string](Get-Prop $station "shown")
        $public["wrong"] = [string](Get-Prop $station "wrong")
        $choices = New-Object System.Collections.ArrayList
        foreach ($choice in @(Get-Prop $station "choices")) {
            [void]$choices.Add(@{ id = [string](Get-Prop $choice "id"); text = [string](Get-Prop $choice "text") })
        }
        $public["choices"] = $choices.ToArray()
    } elseif ($type -eq "number") {
        $public["prompt"] = [string](Get-Prop $station "prompt")
    }
    return $public
}

function Get-PublicBoard($store) {
    $trails = New-Object System.Collections.ArrayList
    foreach ($trail in @(Get-Prop $store "trails")) {
        $stations = New-Object System.Collections.ArrayList
        foreach ($station in @(Get-Prop $trail "stations")) {
            [void]$stations.Add((Copy-PublicStation $station))
        }
        [void]$trails.Add(@{
            id = [string](Get-Prop $trail "id")
            title = [string](Get-Prop $trail "title")
            className = [string](Get-Prop $trail "className")
            stations = $stations.ToArray()
        })
    }
    return @{ trails = $trails.ToArray() }
}

function Get-WrongIds($station, $answers) {
    $ids = New-Object System.Collections.Generic.List[string]
    $type = [string](Get-Prop $station "type")
    if ($type -eq "yesno" -or $type -eq "numbers") {
        foreach ($item in @(Get-Prop $station "items")) {
            $id = [string](Get-Prop $item "id")
            $given = Get-Prop $answers $id
            $ok = $false
            if ($type -eq "yesno") {
                $ok = ($given -is [bool]) -and ($given -eq [bool](Get-Prop $item "answer"))
            } else {
                $number = Convert-ToDouble $given
                $expected = Convert-ToDouble (Get-Prop $item "answer")
                $ok = ($null -ne $number) -and ($null -ne $expected) -and (Test-Nearly $number $expected)
            }
            if (-not $ok) { $ids.Add($id) }
        }
    } elseif ($type -eq "choice") {
        $picked = [string](Get-Prop $answers "choice")
        $ok = $false
        foreach ($choice in @(Get-Prop $station "choices")) {
            if ([string](Get-Prop $choice "id") -eq $picked -and [bool](Get-Prop $choice "correct")) { $ok = $true }
        }
        if (-not $ok) { $ids.Add("choice") }
    } elseif ($type -eq "number") {
        $given = Convert-ToDouble (Get-Prop $answers "value")
        $expected = Convert-ToDouble (Get-Prop $station "answer")
        if ($null -eq $given -or $null -eq $expected -or -not (Test-Nearly $given $expected)) { $ids.Add("value") }
    } else {
        $ids.Add("station")
    }
    return ,$ids.ToArray()
}

function Test-Answers($station, $answers) {
    $type = [string](Get-Prop $station "type")
    if ($type -eq "yesno") {
        foreach ($item in @(Get-Prop $station "items")) {
            $given = Get-Prop $answers ([string](Get-Prop $item "id"))
            if ($given -isnot [bool] -or $given -ne [bool](Get-Prop $item "answer")) { return $false }
        }
        return $true
    }
    if ($type -eq "numbers") {
        foreach ($item in @(Get-Prop $station "items")) {
            $given = Convert-ToDouble (Get-Prop $answers ([string](Get-Prop $item "id")))
            $expected = Convert-ToDouble (Get-Prop $item "answer")
            if ($null -eq $given -or $null -eq $expected -or -not (Test-Nearly $given $expected)) { return $false }
        }
        return $true
    }
    if ($type -eq "choice") {
        $picked = [string](Get-Prop $answers "choice")
        foreach ($choice in @(Get-Prop $station "choices")) {
            if ([string](Get-Prop $choice "id") -eq $picked -and [bool](Get-Prop $choice "correct")) { return $true }
        }
        return $false
    }
    return $false
}

function Get-Score([int]$attempts, [bool]$hintUsed) {
    if ($hintUsed -or $attempts -ge 3) { return 30 }
    if ($attempts -le 1) { return 100 }
    return 60
}

function Find-Trail($store, [string]$id) {
    foreach ($trail in @(Get-Prop $store "trails")) {
        if ([string](Get-Prop $trail "id") -eq $id) { return $trail }
    }
    return $null
}

function Find-Station($trail, [string]$id) {
    foreach ($station in @(Get-Prop $trail "stations")) {
        if ([string](Get-Prop $station "id") -eq $id) { return $station }
    }
    return $null
}

function Handle-Api($stream, [string]$method, [string]$path, [byte[]]$body, [string]$header) {
    if ($method -eq "GET" -and $path -eq "/api/board") {
        Send-Json $stream 200 "OK" (Get-PublicBoard (Read-Store))
        return
    }
    if ($method -eq "GET" -and $path -eq "/api/state") {
        if (-not (Test-Teacher $header)) {
            Send-Json $stream 401 "Unauthorized" @{ error = "Нужен е кодът на учителя." }
            return
        }
        Send-Json $stream 200 "OK" (Read-Store)
        return
    }
    if ($method -ne "POST") {
        Send-Json $stream 404 "Not Found" @{ error = "Няма такъв адрес." }
        return
    }
    $text = $utf8.GetString($body).Trim([char]0)
    if (-not $text) {
        Send-Json $stream 400 "Bad Request" @{ error = "Празна заявка." }
        return
    }
    $payload = $script:Serializer.DeserializeObject($text)
    if ($path -eq "/api/login") {
        $password = Get-Prop $payload "password"
        if ($password -isnot [string]) { $password = "" }
        if ($password.Trim() -ne (Get-TeacherPassword)) {
            Send-Json $stream 401 "Unauthorized" @{ error = "Кодът не е верен." }
            return
        }
        $token = New-TeacherToken
        $script:TeacherTokens[$token] = $true
        Send-Json $stream 200 "OK" @{ token = $token }
        return
    }
    if ($path -eq "/api/password") {
        if (-not (Test-Teacher $header)) {
            Send-Json $stream 401 "Unauthorized" @{ error = "Нужен е кодът на учителя." }
            return
        }
        $old = Get-Prop $payload "oldPassword"
        if ($old -isnot [string]) { $old = "" }
        if ($old.Trim() -ne (Get-TeacherPassword)) {
            Send-Json $stream 400 "Bad Request" @{ error = "Старият код не е верен." }
            return
        }
        $next = Get-CleanText (Get-Prop $payload "password") 40 4
        if (-not $next) {
            Send-Json $stream 400 "Bad Request" @{ error = "Новият код трябва да е от 4 до 40 знака, без < и >." }
            return
        }
        Set-TeacherPassword $next
        Send-Json $stream 200 "OK" @{ ok = $true }
        return
    }
    $store = Read-Store
    if ($path -eq "/api/trails" -or $path -eq "/api/trails/update" -or $path -eq "/api/trails/delete" -or $path -eq "/api/stations" -or $path -eq "/api/stations/update" -or $path -eq "/api/stations/delete" -or $path -eq "/api/stations/move") {
        if (-not (Test-Teacher $header)) {
            Send-Json $stream 401 "Unauthorized" @{ error = "Нужен е кодът на учителя." }
            return
        }
    }
    if ($path -eq "/api/trails") {
        $title = Get-CleanText (Get-Prop $payload "title") 80
        $className = Get-CleanText (Get-Prop $payload "className") 60
        if (-not $title -or -not $className) {
            Send-Json $stream 400 "Bad Request" @{ error = "Попълни име на трасето и клас." }
            return
        }
        $trails = ConvertTo-ArrayList (Get-Prop $store "trails")
        if ($trails.Count -ge 40) {
            Send-Json $stream 400 "Bad Request" @{ error = "Твърде много трасета." }
            return
        }
        $trail = @{ id = (New-Id "trail"); title = $title; className = $className; stations = @() }
        [void]$trails.Add($trail)
        $store["trails"] = $trails.ToArray()
        Write-Store $store
        Send-Json $stream 200 "OK" $trail
        return
    }
    if ($path -eq "/api/trails/update") {
        $title = Get-CleanText (Get-Prop $payload "title") 80
        $className = Get-CleanText (Get-Prop $payload "className") 60
        $trail = Find-Trail $store ([string](Get-Prop $payload "id"))
        if (-not $trail) {
            Send-Json $stream 404 "Not Found" @{ error = "Няма такова трасе." }
            return
        }
        if (-not $title -or -not $className) {
            Send-Json $stream 400 "Bad Request" @{ error = "Попълни име на трасето и клас." }
            return
        }
        $trail["title"] = $title
        $trail["className"] = $className
        Write-Store $store
        Send-Json $stream 200 "OK" $trail
        return
    }
    if ($path -eq "/api/trails/delete") {
        $id = [string](Get-Prop $payload "id")
        $trails = ConvertTo-ArrayList (Get-Prop $store "trails")
        $keptTrails = New-Object System.Collections.ArrayList
        $found = $false
        foreach ($trail in @($trails)) {
            if ([string](Get-Prop $trail "id") -eq $id) { $found = $true }
            else { [void]$keptTrails.Add($trail) }
        }
        if (-not $found) {
            Send-Json $stream 404 "Not Found" @{ error = "Няма такова трасе." }
            return
        }
        $keptResults = New-Object System.Collections.ArrayList
        foreach ($row in (ConvertTo-ArrayList (Get-Prop $store "results"))) {
            if ([string](Get-Prop $row "trailId") -ne $id) { [void]$keptResults.Add($row) }
        }
        $store["trails"] = $keptTrails.ToArray()
        $store["results"] = $keptResults.ToArray()
        Write-Store $store
        Send-Json $stream 200 "OK" @{ ok = $true }
        return
    }
    if ($path -eq "/api/stations") {
        $trail = Find-Trail $store ([string](Get-Prop $payload "trailId"))
        if (-not $trail) {
            Send-Json $stream 404 "Not Found" @{ error = "Няма такова трасе." }
            return
        }
        $stations = ConvertTo-ArrayList (Get-Prop $trail "stations")
        if ($stations.Count -ge 30) {
            Send-Json $stream 400 "Bad Request" @{ error = "Трасето има твърде много станции." }
            return
        }
        $station = New-CleanStation (Get-Prop $payload "station")
        if (-not $station) {
            Send-Json $stream 400 "Bad Request" @{ error = "Станцията не е попълнена докрай." }
            return
        }
        [void]$stations.Add($station)
        $trail["stations"] = $stations.ToArray()
        Write-Store $store
        Send-Json $stream 200 "OK" $station
        return
    }
    if ($path -eq "/api/stations/update" -or $path -eq "/api/stations/delete" -or $path -eq "/api/stations/move") {
        $trail = Find-Trail $store ([string](Get-Prop $payload "trailId"))
        if (-not $trail) {
            Send-Json $stream 404 "Not Found" @{ error = "Няма такова трасе." }
            return
        }
        $stationId = [string](Get-Prop $payload "stationId")
        $stations = ConvertTo-ArrayList (Get-Prop $trail "stations")
        $index = -1
        for ($i = 0; $i -lt $stations.Count; $i++) {
            if ([string](Get-Prop $stations[$i] "id") -eq $stationId) { $index = $i; break }
        }
        if ($index -lt 0) {
            Send-Json $stream 404 "Not Found" @{ error = "Няма такава станция." }
            return
        }
        if ($path -eq "/api/stations/update") {
            $station = New-CleanStation (Get-Prop $payload "station") $stationId
            if (-not $station) {
                Send-Json $stream 400 "Bad Request" @{ error = "Станцията не е попълнена докрай." }
                return
            }
            $stations[$index] = $station
            $trail["stations"] = $stations.ToArray()
            Write-Store $store
            Send-Json $stream 200 "OK" $station
            return
        }
        if ($path -eq "/api/stations/delete") {
            $keptStations = New-Object System.Collections.ArrayList
            foreach ($item in @($stations)) {
                if ([string](Get-Prop $item "id") -ne $stationId) { [void]$keptStations.Add($item) }
            }
            $keptResults = New-Object System.Collections.ArrayList
            foreach ($row in (ConvertTo-ArrayList (Get-Prop $store "results"))) {
                $sameTrail = [string](Get-Prop $row "trailId") -eq [string](Get-Prop $trail "id")
                $sameStation = [string](Get-Prop $row "stationId") -eq $stationId
                if (-not ($sameTrail -and $sameStation)) { [void]$keptResults.Add($row) }
            }
            $trail["stations"] = $keptStations.ToArray()
            $store["results"] = $keptResults.ToArray()
            Write-Store $store
            Send-Json $stream 200 "OK" @{ ok = $true }
            return
        }
        $direction = [string](Get-Prop $payload "direction")
        $delta = 0
        if ($direction -eq "up") { $delta = -1 }
        elseif ($direction -eq "down") { $delta = 1 }
        $target = $index + $delta
        if ($delta -eq 0 -or $target -lt 0 -or $target -ge $stations.Count) {
            Send-Json $stream 400 "Bad Request" @{ error = "Станцията не може да се премести." }
            return
        }
        $moving = $stations[$index]
        $stations[$index] = $stations[$target]
        $stations[$target] = $moving
        $trail["stations"] = $stations.ToArray()
        Write-Store $store
        Send-Json $stream 200 "OK" @{ ok = $true }
        return
    }
    if ($path -eq "/api/results") {
        $name = Get-CleanText (Get-Prop $payload "name") 40
        $trail = Find-Trail $store ([string](Get-Prop $payload "trailId"))
        $station = $null
        if ($trail) { $station = Find-Station $trail ([string](Get-Prop $payload "stationId")) }
        $attemptsValue = Get-Prop $payload "attempts"
        $hintUsed = Get-Prop $payload "hintUsed"
        $attemptsOk = $attemptsValue -is [int] -or $attemptsValue -is [long] -or $attemptsValue -is [decimal]
        if (-not $name -or -not $station -or ($hintUsed -isnot [bool]) -or -not $attemptsOk) {
            Send-Json $stream 400 "Bad Request" @{ error = "Липсват име или отговори." }
            return
        }
        $attempts = [int]$attemptsValue
        if ($attempts -lt 1 -or $attempts -gt 20) {
            Send-Json $stream 400 "Bad Request" @{ error = "Невалиден опит." }
            return
        }
        $wrong = Get-WrongIds $station (Get-Prop $payload "answers")
        if ($wrong.Length -gt 0) {
            Send-Json $stream 400 "Bad Request" @{ error = "Отговорите не се приемат."; wrong = $wrong }
            return
        }
        $points = Get-Score $attempts $hintUsed
        $stars = 1
        if ($points -ge 100) { $stars = 3 } elseif ($points -ge 60) { $stars = 2 }
        $nameKey = $name.ToLowerInvariant()
        $results = ConvertTo-ArrayList (Get-Prop $store "results")
        $kept = $null
        foreach ($row in $results) {
            if ([string](Get-Prop $row "trailId") -eq [string](Get-Prop $trail "id") -and
                [string](Get-Prop $row "stationId") -eq [string](Get-Prop $station "id") -and
                [string](Get-Prop $row "nameKey") -eq $nameKey) {
                $kept = $row
                break
            }
        }
        if ($kept) {
            $oldStars = [int](Get-Prop $kept "stars")
            $oldPoints = [int](Get-Prop $kept "points")
            if ($stars -gt $oldStars -or ($stars -eq $oldStars -and $points -gt $oldPoints)) {
                $kept["stars"] = $stars
                $kept["points"] = $points
                $kept["name"] = $name
            }
        } else {
            [void]$results.Add(@{
                trailId = [string](Get-Prop $trail "id")
                stationId = [string](Get-Prop $station "id")
                name = $name
                nameKey = $nameKey
                stars = $stars
                points = $points
            })
        }
        $store["results"] = $results.ToArray()
        Write-Store $store
        Send-Json $stream 200 "OK" @{ ok = $true; stars = $stars; points = $points; success = [string](Get-Prop $station "success") }
        return
    }
    Send-Json $stream 404 "Not Found" @{ error = "Няма такъв адрес." }
}

$listener = $null
try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::IPv6Any, $port)
    $listener.Server.SetSocketOption(
        [System.Net.Sockets.SocketOptionLevel]::IPv6,
        [System.Net.Sockets.SocketOptionName]::IPv6Only,
        $false)
    $listener.Start()
} catch {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $port)
    $listener.Start()
}

if (-not (Test-Path -LiteralPath $storePath)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $storePath) | Out-Null
    Copy-Item -LiteralPath $seedPath -Destination $storePath
}

$lan = Get-LanIPv4
$teacherCode = Get-TeacherPassword
Write-Host ""
Write-Host "QR пътека слуша на порт $port"
Write-Host "На този компютър:  http://127.0.0.1:${port}/"
if ($lan) {
    Write-Host "На телефона:        http://${lan}:${port}/"
    Write-Host "Отвори адреса за телефона, преди да печаташ QR кодовете."
} else {
    Write-Host "Няма намерен мрежов адрес. Телефонът няма да стигне до играта, докато компютърът не е във Wi-Fi."
}
Write-Host "Код за учителя:   $teacherCode"
Write-Host "Ученикът влиза само с QR кода. Този код отваря страницата на учителя."
Write-Host "Ако Windows пита за защитна стена, разреши достъпа в частни мрежи."
Write-Host "Спри сървъра с Ctrl+C."
Write-Host ""

$rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\')

while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
        $client.ReceiveTimeout = 8000
        $stream = $client.GetStream()
        $stream.ReadTimeout = 8000
        $request = Read-HttpRequest $stream
        $header = $request.Header
        if ($header -notmatch '^(GET|HEAD|POST)\s+(\S+)\s+HTTP/') {
            Send-Bytes $stream 400 "Bad Request" "text/plain; charset=utf-8" $utf8.GetBytes("Bad request")
            continue
        }
        $method = $Matches[1]
        $rawPath = ($Matches[2] -split '\?')[0]
        $urlPath = [Uri]::UnescapeDataString($rawPath)
        if ($urlPath.StartsWith("/api/")) {
            Handle-Api $stream $method $urlPath $request.Body $header
            Write-Host "$method $urlPath"
            continue
        }
        if ($method -eq "POST") {
            Send-Bytes $stream 404 "Not Found" "text/plain; charset=utf-8" $utf8.GetBytes("Not found")
            continue
        }
        if ($urlPath -eq "/favicon.ico") {
            Send-Bytes $stream 204 "No Content" "image/x-icon" ([byte[]]@())
            continue
        }
        if ($urlPath -eq "/" -or $urlPath -eq "") { $urlPath = "/index.html" }
        if ($urlPath.Contains("..") -or $urlPath.Contains("\") -or $urlPath.StartsWith("/data/")) {
            Send-Bytes $stream 400 "Bad Request" "text/plain; charset=utf-8" $utf8.GetBytes("Bad path")
            continue
        }
        $rel = $urlPath.TrimStart("/").Replace("/", "\")
        $full = [System.IO.Path]::GetFullPath((Join-Path $rootFull $rel))
        $inside = $full.Equals($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -or
            $full.StartsWith($rootFull + "\", [System.StringComparison]::OrdinalIgnoreCase)
        if (-not $inside -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
            Send-Bytes $stream 404 "Not Found" "text/plain; charset=utf-8" $utf8.GetBytes("Страницата липсва.")
            Write-Host "404 $urlPath"
            continue
        }
        Send-Bytes $stream 200 "OK" (Get-ContentType $full) ([System.IO.File]::ReadAllBytes($full))
        Write-Host "200 $urlPath"
    } catch {
        Write-Host ("грешка: " + $_.Exception.Message)
    } finally {
        $client.Close()
    }
}
