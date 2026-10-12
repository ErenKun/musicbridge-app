# MusicBridge - Windows Bildirim Alani (System Tray) Uygulamasi
# Eren Teknoloji - 2026

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# 1. Server.js calisiyor mu kontrol et, calismiyorsa arka planda baslat
$existing = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*server.js*' }
if (-not $existing) {
    Start-Process -FilePath "node.exe" -ArgumentList "server.js" -WorkingDirectory $scriptDir -WindowStyle Hidden
}

# 2. System Tray Bilesenleri
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

$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# Web Arayuzunu Ac
$openWebItem = New-Object System.Windows.Forms.ToolStripMenuItem
$openWebItem.Text = "Web Arayuzunu Ac (localhost:8765)"
$openWebItem.add_Click({
    Start-Process "http://localhost:8765"
})
$contextMenu.Items.Add($openWebItem) | Out-Null

# IP Kopyala
$copyIpItem = New-Object System.Windows.Forms.ToolStripMenuItem
$copyIpItem.Text = "Baglanti Adresini Kopyala"
$copyIpItem.add_Click({
    try {
        $res = Invoke-RestMethod -Uri "http://localhost:8765/api/status" -TimeoutSec 2
        $ip = if ($res.network.lan.Count -gt 0) { $res.network.lan[0] } else { "localhost" }
        [System.Windows.Forms.Clipboard]::SetText("http://$ip:8765")
        $notifyIcon.ShowBalloonTip(2000, "MusicBridge", "Adres panoya kopyalandi: http://$ip:8765", [System.Windows.Forms.ToolTipIcon]::Info)
    } catch {
        [System.Windows.Forms.Clipboard]::SetText("http://localhost:8765")
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
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*server.js*' -or $_.CommandLine -like '*windows-media-bridge.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    [System.Windows.Forms.Application]::Exit()
})
$contextMenu.Items.Add($exitItem) | Out-Null

$notifyIcon.ContextMenuStrip = $contextMenu

# Cift tiklandiginda web oynatici acilsin
$notifyIcon.add_DoubleClick({
    Start-Process "http://localhost:8765"
})

$notifyIcon.ShowBalloonTip(2500, "MusicBridge Aktif!", "MusicBridge arka planda calisiyor. Tiklayarak acabilirsiniz.", [System.Windows.Forms.ToolTipIcon]::Info)

# Mesaj dongusu
[System.Windows.Forms.Application]::Run()
