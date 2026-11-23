# Offline HKCU toggle, adapted from genshin-joypad-toggle/Toggle-GenshinJoypad.ps1.
# Inputs arrive as JSON on stdin, never as executable PowerShell text.
$ErrorActionPreference = 'Stop'

function Assert-Uid([string]$Uid) {
    if ($Uid -cnotmatch '\A[0-9]+\z' -or $Uid -notmatch '[1-9]') { throw 'UID 必须为非零的纯数字。' }
}

function Get-JoypadUids([string[]]$Names) {
    @($Names | ForEach-Object {
        if ($_ -cmatch '\AUSD_([0-9]+)_h[0-9]+\z') {
            $uid = $Matches[1]
            if ($uid -match '[1-9]') { $uid }
        }
    } | Sort-Object -Unique)
}

function Assert-GameStopped {
    $running = @(Get-Process -Name 'YuanShen' -ErrorAction SilentlyContinue)
    if ($running.Count) { throw '检测到 YuanShen.exe 正在运行，请先完全退出原神再切换输入设备。' }
}

function Read-JoypadData([byte[]]$Raw) {
    if ($null -eq $Raw -or !$Raw.Length) { throw '注册表值内容为空。' }
    $end = $Raw.Length
    while ($end -gt 0 -and $Raw[$end - 1] -eq 0) { $end-- }
    if (!$end) { throw '注册表值内容全是 0，无法解析。' }
    $body = [byte[]]::new($end)
    [Array]::Copy($Raw, $body, $end)
    $encoder = [Text.UTF8Encoding]::new($false, $true)
    try { $text = $encoder.GetString($body) }
    catch {
        $encoder = [Text.Encoding]::GetEncoding(28591)
        $text = $encoder.GetString($body)
    }
    if ([Convert]::ToBase64String($encoder.GetBytes($text)) -cne [Convert]::ToBase64String($body)) {
        throw '二进制与文本互转校验失败，已中止。'
    }
    $bom = $text.Length -gt 0 -and [int][char]$text[0] -eq 0xFEFF
    if ($bom) { $text = $text.Substring(1) }
    try { $json = ConvertFrom-Json -InputObject $text -ErrorAction Stop }
    catch { throw '注册表内容不是合法 JSON，已中止。' }
    if ($null -eq $json -or $null -eq $json.PSObject.Properties['isUsingJoypad']) {
        throw 'JSON 中没有 isUsingJoypad 字段，已中止。'
    }
    if ($json.isUsingJoypad -isnot [bool]) { throw 'isUsingJoypad 不是布尔值，已中止。' }
    $rx = [regex]'("isUsingJoypad"\s*:\s*)(true|false)'
    $hits = $rx.Matches($text)
    if ($hits.Count -ne 1) { throw 'JSON 中 isUsingJoypad 布尔字面量不唯一，已中止。' }
    if ($hits[0].Groups[2].Value -cne $json.isUsingJoypad.ToString().ToLowerInvariant()) {
        throw 'isUsingJoypad 的解析值与原始字面量不一致，已中止。'
    }
    return @{ Text = $text; Encoder = $encoder; Bom = $bom; Nuls = $Raw.Length - $end;
        UsingJoypad = $json.isUsingJoypad; Hit = $hits[0]; Regex = $rx }
}

function Convert-JoypadData($Data) {
    $literal = (!$Data.UsingJoypad).ToString().ToLowerInvariant()
    $hit = $Data.Hit
    $text = $Data.Text.Substring(0, $hit.Index) + $hit.Groups[1].Value + $literal + $Data.Text.Substring($hit.Index + $hit.Length)
    $json = ConvertFrom-Json -InputObject $text -ErrorAction Stop
    if ($json.isUsingJoypad -isnot [bool] -or $json.isUsingJoypad -eq $Data.UsingJoypad) {
        throw '修改后的 JSON 校验失败，未写入。'
    }
    if ($Data.Regex.Replace($Data.Text, '${1}<bool>') -cne $Data.Regex.Replace($text, '${1}<bool>')) {
        throw '修改波及了 isUsingJoypad 以外的内容，未写入。'
    }
    if ($Data.Bom) { $text = [string][char]0xFEFF + $text }
    $body = $Data.Encoder.GetBytes($text)
    $raw = [byte[]]::new($body.Length + $Data.Nuls)
    [Array]::Copy($body, $raw, $body.Length)
    return ,$raw
}

function New-RegBackup([string]$Name, [byte[]]$Bytes) {
    $prefix = '"' + $Name + '"=hex:'
    $capacity = [Math]::Max(1, [Math]::Floor((79 - $prefix.Length) / 3))
    $lines = [Collections.Generic.List[string]]::new()
    $lines.Add('Windows Registry Editor Version 5.00')
    $lines.Add('')
    $lines.Add('[HKEY_CURRENT_USER\Software\miHoYo\原神]')
    $offset = 0
    while ($offset -lt $Bytes.Length) {
        $count = [int][Math]::Min($capacity, $Bytes.Length - $offset)
        $chunk = [BitConverter]::ToString($Bytes, $offset, $count).ToLowerInvariant().Replace('-', ',')
        $offset += $count
        if ($offset -lt $Bytes.Length) { $chunk += ',\' }
        $lines.Add($prefix + $chunk)
        $prefix = '  '
        $capacity = 25
    }
    return ($lines -join "`r`n") + "`r`n"
}

function Invoke-Joypad($Request) {
    if ($Request.mode -cnotin @('list', 'inspect', 'commit')) { throw '未知的切换阶段。' }
    if ($Request.mode -cne 'list') { Assert-Uid $Request.uid }
    Assert-GameStopped
    $key = $null
    try {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\miHoYo\原神', $false)
        if ($null -eq $key) { throw '找不到原神注册表项，请确认这台电脑至少启动过一次国服原神。' }
        if ($Request.mode -ceq 'list') {
            $uids = @(Get-JoypadUids $key.GetValueNames())
            if (!$uids.Count) { throw '未找到 UID 非零的原神账号配置，请先在本机登录国服原神。' }
            return @{ uids = $uids }
        }
        $pattern = '\AUSD_' + [regex]::Escape($Request.uid) + '_h[0-9]+\z'
        $names = @($key.GetValueNames() | Where-Object { $_ -cmatch $pattern })
        if (!$names.Count) { throw "找不到 UID $($Request.uid) 对应的原神配置，请核对 UID。" }
        if ($names.Count -ne 1) { throw '该 UID 对应多个注册表值，无法唯一确定配置，已中止。' }
        $target = $names[0]
        if ($key.GetValueKind($target) -ne [Microsoft.Win32.RegistryValueKind]::Binary) {
            throw '原神配置不是 REG_BINARY 类型，已中止。'
        }
        $raw = $key.GetValue($target)
        $data = Read-JoypadData $raw
        $snapshot = [Convert]::ToBase64String($raw)
        if ($Request.mode -ceq 'inspect') {
            return @{ usingJoypad = $data.UsingJoypad; snapshot = $snapshot; target = $target }
        }
        if ($Request.snapshot -cne $snapshot -or $Request.target -cne $target) {
            throw '确认期间原神配置已变化，请重新点击切换输入设备。'
        }
        # Only compute the inverse after the UI confirmation and snapshot checks.
        $newRaw = Convert-JoypadData $data
        if ([Math]::Abs($newRaw.Length - $raw.Length) -gt 4) { throw '新旧数据长度差异异常，未写入。' }
        $key.Close()
        $key = $null
        try { $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\miHoYo\原神', $true) }
        catch { throw '无法获得原神注册表写权限，请以管理员身份运行 Diapig Editor 后重试，并检查安全软件。' }
        if ($null -eq $key) { throw '无法以写权限打开原神注册表项。' }
        [IO.Directory]::CreateDirectory($Request.backupDir) | Out-Null
        $backupPath = Join-Path $Request.backupDir ($target + '_' + [Guid]::NewGuid().ToString('N') + '.reg')
        [IO.File]::WriteAllText($backupPath, (New-RegBackup $target $raw), [Text.UnicodeEncoding]::new($false, $true))
        # Recheck immediately before the write, including changes during backup creation.
        Assert-GameStopped
        if ($key.GetValueKind($target) -ne [Microsoft.Win32.RegistryValueKind]::Binary -or
            [Convert]::ToBase64String($key.GetValue($target)) -cne $snapshot) {
            throw '写入前原神配置已变化，已中止。'
        }
        try {
            $key.SetValue($target, $newRaw, [Microsoft.Win32.RegistryValueKind]::Binary)
            if ($key.GetValueKind($target) -ne [Microsoft.Win32.RegistryValueKind]::Binary -or
                [Convert]::ToBase64String($key.GetValue($target)) -cne [Convert]::ToBase64String($newRaw)) {
                throw '写入后回读校验不一致。'
            }
        }
        catch {
            $reason = $_.Exception.Message
            try {
                $key.SetValue($target, $raw, [Microsoft.Win32.RegistryValueKind]::Binary)
                if ([Convert]::ToBase64String($key.GetValue($target)) -cne $snapshot) { throw '恢复校验失败' }
            }
            catch { throw "写入失败且未能恢复原值，请从备份还原：$backupPath。原因：$reason" }
            throw "写入失败，已恢复原值。原因：$reason"
        }
        return @{ usingJoypad = !$data.UsingJoypad; backupPath = $backupPath }
    }
    finally { if ($null -ne $key) { $key.Close() } }
}

# Dot-source in tests to exercise the pure codec without touching the registry.
if ($MyInvocation.InvocationName -eq '.') { return }
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    $request = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
    $result = Invoke-Joypad $request
    [Console]::Out.Write((ConvertTo-Json -InputObject $result -Compress))
}
catch {
    [Console]::Out.Write((ConvertTo-Json -InputObject @{ error = $_.Exception.Message } -Compress))
    exit 1
}
