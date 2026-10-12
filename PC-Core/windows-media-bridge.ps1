# MusicBridge - Yerel Windows Medya ve Ses Denetim Köprüsü (GSMTC & CoreAudio)
# Eren Teknoloji - 2026

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$stdoutStream = [Console]::OpenStandardOutput()

# 1. Windows CoreAudio Master Volume & C# Yerel Non-blocking Stdin Kuyruğu
$nativeSource = @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Concurrent;
using System.Threading.Tasks;

namespace MusicBridgeNative {
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioEndpointVolume {
        int RegisterControlChangeNotify(IntPtr pNotify);
        int UnregisterControlChangeNotify(IntPtr pNotify);
        int GetChannelCount(out uint pnChannelCount);
        int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
        int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
        int GetMasterVolumeLevel(out float pfLevelDB);
        int GetMasterVolumeLevelScalar(out float pfLevel);
        int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
        int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
        int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
        int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
        int GetMute(out bool pbMute);
        int GetVolumeStepInfo(out uint pnStep, out uint pnStepCount);
        int VolumeStepUp(ref Guid pguidEventContext);
        int VolumeStepDown(ref Guid pguidEventContext);
        int QueryHardwareSupport(out uint pdwHardwareSupportMask);
        int GetVolumeRange(out float pflVolumeMindB, out float pflVolumeMaxdB, out float pflVolumeIncrementdB);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDevice {
        int Activate(ref Guid id, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object interfacePointer);
        int OpenPropertyStore(int stgmAccess, out IntPtr properties);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
        int GetState(out int pdwState);
    }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IMMDevice ppDevice);
        int RegisterEndpointNotificationCallback(IntPtr pClient);
        int UnregisterEndpointNotificationCallback(IntPtr pClient);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    public class MMDeviceEnumeratorComObject { }

    public class MasterAudio {
        public static float GetVolume() {
            try {
                var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
                IMMDevice dev;
                enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
                var IID_IAudioEndpointVolume = typeof(IAudioEndpointVolume).GUID;
                object epv;
                dev.Activate(ref IID_IAudioEndpointVolume, 1, IntPtr.Zero, out epv);
                var vol = (IAudioEndpointVolume)epv;
                float currentVol;
                vol.GetMasterVolumeLevelScalar(out currentVol);
                return (float)Math.Round(currentVol * 100.0f);
            } catch {
                return 50.0f;
            }
        }

        public static void SetVolume(float levelPercent) {
            try {
                var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
                IMMDevice dev;
                enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
                var IID_IAudioEndpointVolume = typeof(IAudioEndpointVolume).GUID;
                object epv;
                dev.Activate(ref IID_IAudioEndpointVolume, 1, IntPtr.Zero, out epv);
                var vol = (IAudioEndpointVolume)epv;
                Guid empty = Guid.Empty;
                float clamped = Math.Max(0.0f, Math.Min(1.0f, levelPercent / 100.0f));
                vol.SetMasterVolumeLevelScalar(clamped, ref empty);
            } catch {}
        }
    }

    public static class CommandQueue {
        public static ConcurrentQueue<string> Queue = new ConcurrentQueue<string>();
        public static void Enqueue(string cmd) { Queue.Enqueue(cmd); }
        public static string Dequeue() {
            string res;
            if (Queue.TryDequeue(out res)) return res;
            return null;
        }

        public static void StartReader() {
            Task.Run(() => {
                try {
                    while (true) {
                        string line = Console.ReadLine();
                        if (line == null) break;
                        if (!string.IsNullOrWhiteSpace(line)) {
                            Queue.Enqueue(line.Trim());
                        }
                    }
                } catch {}
            });
        }
    }
}
"@
Add-Type -TypeDefinition $nativeSource -ErrorAction SilentlyContinue

# 2. WinRT GSMTC ve Akış Dönüştürme
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' }
function Await-AsyncOp($op, $type) {
    if ($null -eq $op) { return $null }
    try {
        $method = $asTaskGeneric.MakeGenericMethod($type)
        $task = $method.Invoke($null, @($op))
        $task.Wait()
        return $task.Result
    } catch {
        return $null
    }
}
$asStreamMethod = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsStream' -and $_.GetParameters().Count -eq 1 }

# 3. C# Yerel Non-blocking Stdin Dinleyicisini Başlat
[MusicBridgeNative.CommandQueue]::StartReader()

$mgrOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
$manager = Await-AsyncOp $mgrOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

$selectedSessionIndex = -1
$pinnedSource = "auto"
$resolvedIndex = 0
$lastArtKey = ""
$cachedArtB64 = ""
$artRetryCount = 0

function Send-JsonPayload($obj) {
    $json = ($obj | ConvertTo-Json -Compress) + "`n"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $stdoutStream.Write($bytes, 0, $bytes.Length)
    $stdoutStream.Flush()
}

# 4. Ana Döngü
while ($true) {
    # Oturum listesini her döngüde taze al
    $rawSessions = @($manager.GetSessions())

    # 4a. Gelen komutları çalıştır
    $cmdRaw = [MusicBridgeNative.CommandQueue]::Dequeue()
    while ($null -ne $cmdRaw) {
        try {
            $cmdObj = $cmdRaw | ConvertFrom-Json
            $action = $cmdObj.action
            $data = $cmdObj.data

            if ($action -eq "setVolume") {
                [MusicBridgeNative.MasterAudio]::SetVolume([float]$data)
            } elseif ($action -eq "nextSession") {
                if ($rawSessions.Count -gt 1) {
                    $pinnedSource = "manual"
                    $curIdx = if ($resolvedIndex -ge 0 -and $resolvedIndex -lt $rawSessions.Count) { $resolvedIndex } else { 0 }
                    $selectedSessionIndex = ($curIdx + 1) % $rawSessions.Count
                    $resolvedIndex = $selectedSessionIndex
                }
            } elseif ($action -eq "prevSession") {
                if ($rawSessions.Count -gt 1) {
                    $pinnedSource = "manual"
                    $curIdx = if ($resolvedIndex -ge 0 -and $resolvedIndex -lt $rawSessions.Count) { $resolvedIndex } else { 0 }
                    $selectedSessionIndex = ($curIdx - 1 + $rawSessions.Count) % $rawSessions.Count
                    $resolvedIndex = $selectedSessionIndex
                }
            } elseif ($action -eq "selectSession") {
                if ($data -eq "auto") {
                    $pinnedSource = "auto"
                    $selectedSessionIndex = -1
                } else {
                    $pinnedSource = "manual"
                    $selectedSessionIndex = [int]$data
                    $resolvedIndex = $selectedSessionIndex
                }
            } elseif ($action -eq "pinSource") {
                $pinnedSource = [string]$data
                if ($pinnedSource -eq "auto") {
                    $selectedSessionIndex = -1
                }
            } else {
                # Medya taşıma komutları: Hedef oturuma uygula
                $cmdTarget = $null
                if ($selectedSessionIndex -ge 0 -and $selectedSessionIndex -lt $rawSessions.Count) {
                    $cmdTarget = $rawSessions[$selectedSessionIndex]
                } else {
                    $cmdTarget = $manager.GetCurrentSession()
                    if (-not $cmdTarget -and $rawSessions.Count -gt 0) {
                        $cmdTarget = $rawSessions[0]
                    }
                }

                if ($cmdTarget) {
                    if ($action -eq "playPause") {
                        Await-AsyncOp ($cmdTarget.TryTogglePlayPauseAsync()) ([bool]) | Out-Null
                    } elseif ($action -eq "play") {
                        Await-AsyncOp ($cmdTarget.TryPlayAsync()) ([bool]) | Out-Null
                    } elseif ($action -eq "pause") {
                        Await-AsyncOp ($cmdTarget.TryPauseAsync()) ([bool]) | Out-Null
                    } elseif ($action -eq "next") {
                        Await-AsyncOp ($cmdTarget.TrySkipNextAsync()) ([bool]) | Out-Null
                    } elseif ($action -eq "previous") {
                        Await-AsyncOp ($cmdTarget.TrySkipPreviousAsync()) ([bool]) | Out-Null
                    } elseif ($action -eq "seekTo") {
                        $ts = [TimeSpan]::FromSeconds([double]$data)
                        $cmdTarget.TryChangePlaybackPositionAsync($ts.Ticks) | Out-Null
                    }
                }
            }
        } catch {}
        $cmdRaw = [MusicBridgeNative.CommandQueue]::Dequeue()
    }

    # 4b. Güncel Medya ve Oturum Durumlarını Çözümle
    try {
        $curVol = [MusicBridgeNative.MasterAudio]::GetVolume()

        # Tüm oturumların meta verilerini hazırla
        $sessionsInfo = @()
        for ($i = 0; $i -lt $rawSessions.Count; $i++) {
            $s = $rawSessions[$i]
            $sAppId = if ($s.SourceAppUserModelId) { $s.SourceAppUserModelId } else { "" }
            $sProps = Await-AsyncOp ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
            $sPlayInfo = $s.GetPlaybackInfo()

            $sTitle = if ($sProps -and $sProps.Title) { $sProps.Title.Trim() } else { "Bilinmiyor" }
            $sArtist = if ($sProps -and $sProps.Artist) { $sProps.Artist.Trim() } else { "" }

            # Anlaşılır uygulama adı tespiti
            $sAppName = "Medya Oynatıcı"
            if ($sAppId -like "*Spotify*") {
                $sAppName = "Spotify"
            } elseif ($sAppId -like "*cinhimbnkkghhklpknlkffjgod*" -or $sTitle -like "*YouTube Music*" -or $sArtist -like "*YouTube Music*") {
                $sAppName = "YouTube Music"
            } elseif ($sAppId -like "*Chrome*" -or $sAppId -like "*Edge*" -or $sAppId -like "*Brave*") {
                if ($sTitle -like "*YouTube*" -or $sArtist -like "*YouTube*" -or $sAppId -like "*agimnkijcamfeangaknmldooml*") {
                    $sAppName = "YouTube"
                } else {
                    $sAppName = "Web Tarayıcı"
                }
            }

            $isSPlaying = ($sPlayInfo -and $sPlayInfo.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing)

            $sessionsInfo += @{
                id = $i
                app = $sAppName
                title = $sTitle
                artist = $sArtist
                isPlaying = $isSPlaying
            }
        }

        # Aktif / Hedef oturumu belirle
        $targetSession = $null
        $resolvedIndex = 0

        # Kural 1: YouTube Music'e sabitleme modu aktifse
        if ($pinnedSource -eq "youtube_music") {
            for ($i = 0; $i -lt $sessionsInfo.Count; $i++) {
                if ($sessionsInfo[$i].app -eq "YouTube Music" -or $sessionsInfo[$i].title -like "*YouTube Music*") {
                    $targetSession = $rawSessions[$i]
                    $resolvedIndex = $i
                    $selectedSessionIndex = $i
                    break
                }
            }
        }
        
        # Kural 2: Kullanıcı belirli bir oturumu elle seçtiyse (Manuel / Ok tuşları)
        if (-not $targetSession -and $pinnedSource -eq "manual" -and $selectedSessionIndex -ge 0 -and $selectedSessionIndex -lt $rawSessions.Count) {
            $targetSession = $rawSessions[$selectedSessionIndex]
            $resolvedIndex = $selectedSessionIndex
        }

        # Kural 3: Otomatik mod (Windows en son oynatılan veya ilk oturum)
        if (-not $targetSession) {
            $winCurrent = $manager.GetCurrentSession()
            if ($winCurrent) {
                $targetSession = $winCurrent
                for ($i = 0; $i -lt $rawSessions.Count; $i++) {
                    if ($rawSessions[$i].SourceAppUserModelId -eq $winCurrent.SourceAppUserModelId) {
                        $resolvedIndex = $i
                        break
                    }
                }
            } elseif ($rawSessions.Count -gt 0) {
                $targetSession = $rawSessions[0]
                $resolvedIndex = 0
            }
        }

        if ($targetSession) {
            $propsOp = $targetSession.TryGetMediaPropertiesAsync()
            $props = Await-AsyncOp $propsOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
            $timeline = $targetSession.GetTimelineProperties()
            $playback = $targetSession.GetPlaybackInfo()

            $title = if ($props -and $props.Title) { $props.Title.Trim() } else { "Bilinmiyor" }
            $artist = if ($props -and $props.Artist) { $props.Artist.Trim() } else { "" }
            $album = if ($props -and $props.AlbumTitle) { $props.AlbumTitle.Trim() } else { "" }
            $activeApp = if ($sessionsInfo.Count -gt $resolvedIndex) { $sessionsInfo[$resolvedIndex].app } else { "Medya Oynatıcı" }

            # Albüm kapağı: Parça değiştiğinde veya henüz kapak yüklenemediyse tekrar dene
            $artKey = "$title|$artist"
            if ($artKey -ne $lastArtKey) {
                $lastArtKey = $artKey
                $cachedArtB64 = ""
                $artRetryCount = 0
            }

            if ([string]::IsNullOrEmpty($cachedArtB64) -and $artRetryCount -lt 15) {
                $artRetryCount++
                if ($props -and $props.Thumbnail) {
                    try {
                        $streamOp = $props.Thumbnail.OpenReadAsync()
                        $stream = Await-AsyncOp $streamOp ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
                        if ($stream) {
                            $netStream = $asStreamMethod.Invoke($null, @($stream))
                            $mem = New-Object System.IO.MemoryStream
                            $netStream.CopyTo($mem)
                            $bytes = $mem.ToArray()
                            if ($bytes.Length -gt 0) {
                                $mime = if ($stream.ContentType) { $stream.ContentType } else { "image/jpeg" }
                                $cachedArtB64 = "data:$mime;base64," + [Convert]::ToBase64String($bytes)
                            }
                        }
                    } catch {}
                }
            }

            $isPlaying = ($playback -and $playback.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing)
            
            # Gerçek zamanlı akıcı süre çubuğu hesabı
            $curSec = if ($timeline) {
                if ($isPlaying -and $timeline.LastUpdatedTime) {
                    $diff = ([DateTimeOffset]::UtcNow - $timeline.LastUpdatedTime.ToUniversalTime()).TotalSeconds
                    $pos = $timeline.Position.TotalSeconds + $diff
                    if ($timeline.EndTime -and $pos -gt $timeline.EndTime.TotalSeconds) {
                        $pos = $timeline.EndTime.TotalSeconds
                    }
                    [Math]::Floor([Math]::Max(0, $pos))
                } else {
                    [Math]::Floor($timeline.Position.TotalSeconds)
                }
            } else { 0 }

            $durSec = if ($timeline) { [Math]::Floor($timeline.EndTime.TotalSeconds) } else { 0 }

            $payload = @{
                type = "media"
                title = $title
                artist = $artist
                album = $album
                artwork = $cachedArtB64
                isPlaying = $isPlaying
                currentTime = $curSec
                duration = $durSec
                volume = [int]$curVol
                sourceApp = $activeApp
                sessions = $sessionsInfo
                activeSessionIndex = $resolvedIndex
                totalSessions = $rawSessions.Count
                pinnedSource = $pinnedSource
            }
            Send-JsonPayload $payload
        } else {
            # Oynatıcı kapalı veya duraklatılmış, ancak ses seviyesi hala aktiftir
            $payload = @{
                type = "media"
                title = "Müzik Bekleniyor..."
                artist = "YouTube Music / Spotify"
                album = ""
                artwork = ""
                isPlaying = $false
                currentTime = 0
                duration = 0
                volume = [int]$curVol
                sourceApp = "Boşta"
                sessions = @()
                activeSessionIndex = 0
                totalSessions = 0
                pinnedSource = $pinnedSource
            }
            Send-JsonPayload $payload
        }
    } catch {}

    Start-Sleep -Milliseconds 150
}
