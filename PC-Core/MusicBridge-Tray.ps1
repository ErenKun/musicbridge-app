# MusicBridge - Windows Bildirim Alani (System Tray) Uygulamasi
# Eren Teknoloji - 2026

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# 1. Server.js calisiyor mu kontrol et, calismiyorsa arka planda baslat
$existing = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*server.js*' }
if (-not $existing) {
    Start-Process -FilePath "node.exe" -ArgumentList "server.js" -WorkingDirectory $scriptDir -WindowStyle Hidden
    Start-Sleep -Milliseconds 800
}

# 2. Aktif Port ve PIN Kodunu Tespit Et
$activePort = 8765
$serverPin = "----"

function RefreshServerInfo {
    global:activePort
    global:serverPin
    foreach ($p in 8765..8775) {
        try {
            $status = Invoke-RestMethod -Uri "http://127.0.0.1:$p/api/status" -TimeoutSec 1 -ErrorAction Stop
            if ($status.status -eq "online") {
                $global:activePort = $p
                if ($status.pin) { $global:serverPin = $status.pin }
                break
            }
        } catch {}
    }
}

RefreshServerInfo

# 3. System Tray Bilesenleri
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

# Varsayilan Muzik Notasi Simgesi
$iconPath = Join-Path (Split-Path -Parent $scriptDir) "musicbridge-icon.png"
if (Test-Path $iconPath) {
    try {
        $bitmap = [System.Drawing.Bitmap]::FromFile($iconPath)
        $hIcon = $bitmap.GetHicon()
        $notifyIcon.Icon = [System.Drawing.Icon]::FromHandle($hIcon)
    } catch {
        $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
    }
} else {
    $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
}

$notifyIcon.Text = "MusicBridge PC Core"
$notifyIcon.Visible = $true

# Menu Elemanlari
$titleItem = New-Object System.Windows.Forms.ToolStripMenuItem
$titleItem.Text = "MusicBridge PC Core (Aktif)"
$titleItem.Enabled = $false
$contextMenu.Items.Add($titleItem) | Out-Null

# Guvenlik PIN Elemani (Tiklayinca panoya kopyalar)
$pinItem = New-Object System.Windows.Forms.ToolStripMenuItem
$pinItem.Text = "🔑 Guvenlik PIN: $serverPin (Kopyala)"
$pinItem.Font = New-Object System.Drawing.Font($pinItem.Font, [System.Drawing.FontStyle]::Bold)
$pinItem.add_Click({
    RefreshServerInfo
    [System.Windows.Forms.Clipboard]::SetText($global:serverPin)
    $notifyIcon.ShowBalloonTip(2000, "MusicBridge PIN", "Guvenlik PIN kodu panoya kopyalandi: $($global:serverPin)", [System.Windows.Forms.ToolTipIcon]::Info)
})
$contextMenu.Items.Add($pinItem) | Out-Null

# PIN Degistir / Sabit PIN Belirle
$changePinItem = New-Object System.Windows.Forms.ToolStripMenuItem
$changePinItem.Text = "✏️ Ozel Sabit PIN Belirle..."
$changePinItem.add_Click({
    RefreshServerInfo
    $promptMsg = "MusicBridge baglantilari icin yeni 4 haneli PIN kodunu girin (ornegin: 1234):`n`nBu kod kalici olarak kaydedilir ve unutursaniz buradan degistirebilirsiniz."
    $inputVal = [Microsoft.VisualBasic.Interaction]::InputBox($promptMsg, "MusicBridge - Sabit PIN Belirle", $global:serverPin)
    if ($inputVal -and $inputVal.Trim() -ne "") {
        $cleanPin = $inputVal.Trim()
        if ($cleanPin -match '^\d{4}$') {
            try {
                $body = @{ pin = $cleanPin } | ConvertTo-Json
                $res = Invoke-RestMethod -Uri "http://127.0.0.1:$($global:activePort)/api/auth/pin" -Method Post -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 3
                if ($res.success) {
                    $global:serverPin = $res.pin
                    $pinItem.Text = "🔑 Guvenlik PIN: $($global:serverPin) (Kopyala)"
                    $notifyIcon.ShowBalloonTip(2500, "MusicBridge PIN Guncellendi", "Yeni Guvenlik PIN: $($res.pin)", [System.Windows.Forms.ToolTipIcon]::Info)
                }
            } catch {
                [System.Windows.Forms.MessageBox]::Show("PIN guncellenirken hata olustu: $($_.Exception.Message)", "MusicBridge Hata", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
            }
        } else {
            [System.Windows.Forms.MessageBox]::Show("Gecersiz PIN formati! PIN kodu tam 4 haneli rakamlardan olusmalidir (ornek: 1234).", "MusicBridge Uyari", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
        }
    }
})
$contextMenu.Items.Add($changePinItem) | Out-Null

# PIN Rastgele Uret / Sifirla
$resetPinItem = New-Object System.Windows.Forms.ToolStripMenuItem
$resetPinItem.Text = "🎲 Rastgele Yeni PIN Uret (Sifirla)"
$resetPinItem.add_Click({
    RefreshServerInfo
    try {
        $body = @{ pin = "random" } | ConvertTo-Json
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:$($global:activePort)/api/auth/pin" -Method Post -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 3
        if ($res.success) {
            $global:serverPin = $res.pin
            $pinItem.Text = "🔑 Guvenlik PIN: $($global:serverPin) (Kopyala)"
            $notifyIcon.ShowBalloonTip(2500, "MusicBridge PIN Sifirlandi", "Yeni Rastgele PIN: $($res.pin)", [System.Windows.Forms.ToolTipIcon]::Info)
        }
    } catch {
        [System.Windows.Forms.MessageBox]::Show("PIN sifirlanirken hata olustu: $($_.Exception.Message)", "MusicBridge Hata", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
    }
})
$contextMenu.Items.Add($resetPinItem) | Out-Null

$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# Web Arayuzunu Ac
$openWebItem = New-Object System.Windows.Forms.ToolStripMenuItem
$openWebItem.Text = "Web Arayuzunu Ac (localhost:$activePort)"
$openWebItem.add_Click({
    RefreshServerInfo
    Start-Process "http://localhost:$global:activePort"
})
$contextMenu.Items.Add($openWebItem) | Out-Null

# IP Kopyala
$copyIpItem = New-Object System.Windows.Forms.ToolStripMenuItem
$copyIpItem.Text = "Baglanti Adresini Kopyala"
$copyIpItem.add_Click({
    RefreshServerInfo
    try {
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:$global:activePort/api/status" -TimeoutSec 2
        $ip = if ($res.network.lan.Count -gt 0) { $res.network.lan[0] } else { "localhost" }
        $fullUrl = "http://$ip`:$global:activePort"
        [System.Windows.Forms.Clipboard]::SetText($fullUrl)
        $notifyIcon.ShowBalloonTip(2000, "MusicBridge", "Adres panoya kopyalandi: $fullUrl", [System.Windows.Forms.ToolTipIcon]::Info)
    } catch {
        [System.Windows.Forms.Clipboard]::SetText("http://localhost:$global:activePort")
    }
})
$contextMenu.Items.Add($copyIpItem) | Out-Null

$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# Baslangicta Calistir
$startupItem = New-Object System.Windows.Forms.ToolStripMenuItem
$startupItem.Text = "Windows Baslangicta Calistir"
$startupItem.CheckOnClick = $true

$startupFolder = [Environment]::GetFolderPath('Startup')
$startupLnk = Join-Path $startupFolder "MusicBridge.lnk"
$startupItem.Checked = (Test-Path $startupLnk)

$startupItem.add_Click({
    if ($startupItem.Checked) {
        $ws = New-Object -ComObject WScript.Shell
        $s = $ws.CreateShortcut($startupLnk)
        $s.TargetPath = Join-Path $scriptDir "MusicBridge-ArkaPlanda-Baslat.vbs"
        $s.WorkingDirectory = $scriptDir
        $s.WindowStyle = 7
        $s.Save()
        $notifyIcon.ShowBalloonTip(2000, "MusicBridge", "Baslangicta calistirma aktif edildi.", [System.Windows.Forms.ToolTipIcon]::Info)
    } else {
        if (Test-Path $startupLnk) { Remove-Item $startupLnk -Force }
        $notifyIcon.ShowBalloonTip(2000, "MusicBridge", "Baslangicta calistirma kapatildi.", [System.Windows.Forms.ToolTipIcon]::Info)
    }
})
$contextMenu.Items.Add($startupItem) | Out-Null

$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# Cikis
$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
$exitItem.Text = "MusicBridge'i Kapat"
$exitItem.add_Click({
    $notifyIcon.Visible = $false
    # Server ve bagli surecleri sonlandir
    Get-CimInstance Win32_Process | Where-Object { 
        $_.CommandLine -like '*server.js*' -or 
        $_.CommandLine -like '*windows-media-bridge.ps1*' -or 
        ($_.CommandLine -like '*MusicBridge-Tray.ps1*' -and $_.ProcessId -ne $PID)
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    [System.Windows.Forms.Application]::Exit()
})
$contextMenu.Items.Add($exitItem) | Out-Null

# Menu acilmadan hemen once PIN ve Portu guncelle
$contextMenu.add_Opening({
    RefreshServerInfo
    $pinItem.Text = "🔑 Guvenlik PIN: $global:serverPin (Kopyala)"
    $openWebItem.Text = "Web Arayuzunu Ac (localhost:$global:activePort)"
})

$notifyIcon.ContextMenuStrip = $contextMenu

# Cift tiklandiginda web oynatici acilsin
$notifyIcon.add_DoubleClick({
    RefreshServerInfo
    Start-Process "http://localhost:$global:activePort"
})

$notifyIcon.ShowBalloonTip(2500, "MusicBridge Aktif!", "🔑 PIN: $serverPin`nTiklayarak arayuzu acabilirsiniz.", [System.Windows.Forms.ToolTipIcon]::Info)

# Mesaj dongusu
[System.Windows.Forms.Application]::Run()
