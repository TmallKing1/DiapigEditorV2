$ErrorActionPreference = 'Stop'
# Explicit UTF-8 also works in Windows PowerShell 5.1 with BOM-less source files.
. ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot '../src-tauri/src/joypad.ps1'))))

function Assert($Condition, [string]$Message) { if (!$Condition) { throw $Message } }
function Reject([scriptblock]$Run) {
    $failed = $false
    try { & $Run | Out-Null } catch { $failed = $true }
    Assert $failed 'Expected rejection'
}

foreach ($encoding in @([Text.UTF8Encoding]::new($false, $true), [Text.Encoding]::GetEncoding(28591))) {
    foreach ($state in @('true', 'false')) {
        foreach ($nuls in @(0, 1, 3)) {
            $text = '{ "name":"café", "other":[1,2], "isUsingJoypad" : ' + $state + ' }'
            $body = $encoding.GetBytes($text)
            $raw = [byte[]]::new($body.Length + $nuls)
            [Array]::Copy($body, $raw, $body.Length)
            $data = Read-JoypadData $raw
            $changed = Convert-JoypadData $data
            $parsed = Read-JoypadData $changed
            Assert ($parsed.UsingJoypad -ne $data.UsingJoypad) 'State did not invert'
            Assert ($parsed.Nuls -eq $nuls) 'NUL suffix changed'
            $restored = Convert-JoypadData $parsed
            Assert ([Convert]::ToBase64String($restored) -ceq [Convert]::ToBase64String($raw)) 'Bytes did not round trip'
        }
    }
}
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$bomRaw = $utf8.GetBytes([string][char]0xFEFF + '{"isUsingJoypad":true,"中文":"值"}' + [char]0)
$bomRoundtrip = Convert-JoypadData (Read-JoypadData (Convert-JoypadData (Read-JoypadData $bomRaw)))
Assert ([Convert]::ToBase64String($bomRaw) -ceq [Convert]::ToBase64String($bomRoundtrip)) 'BOM changed'
foreach ($text in @('null', '{}', '{"isUsingJoypad":"true"}', '{"isUsingJoypad":true,"child":{"isUsingJoypad":false}}', '{"isUsingJoypad":true,"isUsingJoypad":false}', 'bad json')) {
    Reject { Read-JoypadData $utf8.GetBytes($text) }
}
Reject { Read-JoypadData ([byte[]]@(0, 0)) }
foreach ($uid in @('', '0', '000', ' 123456780', '123456780 ', '１２３４５', '12345x780', "123456780`n")) {
    Reject { Assert-Uid $uid }
}
Assert-Uid '123456780'
$uids = @(Get-JoypadUids @('USD_0_h1', 'USD_000_h2', 'USD_123456780_h1', 'USD_123456780_h2', 'USD_123456789_h12', 'USD_5_h99', 'USD_123_hX', 'usd_123_h1', 'USD_1_h1_extra', "USD_2_h1`n"))
Assert (($uids -join ',') -ceq '123456780,123456789,5') 'UID list filtering or deduplication failed'
Assert (@(Get-JoypadUids @('USD_0_h1')).Count -eq 0) 'Zero UID was not filtered'
$backup = New-RegBackup 'USD_123456780_h123' $bomRaw
$hex = (($backup -split "`r`n" | Select-Object -Skip 3) -join '') -replace '^"[^"]+"=hex:', '' -replace '[\\\s]', ''
$bytes = [byte[]]@($hex.Split(',') | ForEach-Object { [Convert]::ToByte($_, 16) })
Assert ([Convert]::ToBase64String($bytes) -ceq [Convert]::ToBase64String($bomRaw)) 'Backup bytes changed'
Write-Output 'Joypad codec, UID validation and .reg backup tests passed (no registry writes).'
