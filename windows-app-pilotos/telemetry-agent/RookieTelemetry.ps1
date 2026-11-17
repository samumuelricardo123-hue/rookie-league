# Rookie League Telemetry Agent - read-only local recorder
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$source = @'
using System;
using System.IO;
using System.IO.MemoryMappedFiles;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential, Pack=4, CharSet=CharSet.Unicode)]
public struct PhysicsPage {
 public int packetId;
 public float gas, brake, fuel;
 public int gear, rpms;
 public float steerAngle, speedKmh;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=3)] public float[] velocity;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=3)] public float[] accG;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=4)] public float[] wheelSlip;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=4)] public float[] wheelLoad;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=4)] public float[] wheelsPressure;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=4)] public float[] wheelAngularSpeed;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=4)] public float[] tyreWear;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=4)] public float[] tyreDirtyLevel;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=4)] public float[] tyreCoreTemperature;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=4)] public float[] camberRAD;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=4)] public float[] suspensionTravel;
 public float drs, tc, heading, pitch, roll, cgHeight;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=5)] public float[] carDamage;
 public int numberOfTyresOut, pitLimiterOn;
 public float abs, kersCharge, kersInput;
 public int autoShifterOn;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=2)] public float[] rideHeight;
 public float turboBoost, ballast, airDensity, airTemp, roadTemp;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=3)] public float[] localAngularVel;
 public float finalFF, performanceMeter;
 public int engineBrake, ersRecoveryLevel, ersPowerLevel, ersHeatCharging, ersIsCharging;
 public float kersCurrentKJ;
 public int drsAvailable, drsEnabled;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=4)] public float[] brakeTemp;
 public float clutch;
}

[StructLayout(LayoutKind.Sequential, Pack=4, CharSet=CharSet.Unicode)]
public struct GraphicsPage {
 public int packetId, status, session;
 [MarshalAs(UnmanagedType.ByValTStr, SizeConst=15)] public string currentTime;
 [MarshalAs(UnmanagedType.ByValTStr, SizeConst=15)] public string lastTime;
 [MarshalAs(UnmanagedType.ByValTStr, SizeConst=15)] public string bestTime;
 [MarshalAs(UnmanagedType.ByValTStr, SizeConst=15)] public string split;
 public int completedLaps, position, iCurrentTime, iLastTime, iBestTime;
 public float sessionTimeLeft, distanceTraveled;
 public int isInPit, currentSectorIndex, lastSectorTime, numberOfLaps;
 [MarshalAs(UnmanagedType.ByValTStr, SizeConst=33)] public string tyreCompound;
 public float replayTimeMultiplier, normalizedCarPosition;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=3)] public float[] carCoordinates;
 public float penaltyTime;
 public int flag, idealLineOn, isInPitLane;
 public float surfaceGrip;
}

[StructLayout(LayoutKind.Sequential, Pack=4, CharSet=CharSet.Unicode)]
public struct StaticPage {
 [MarshalAs(UnmanagedType.ByValTStr, SizeConst=15)] public string smVersion;
 [MarshalAs(UnmanagedType.ByValTStr, SizeConst=15)] public string acVersion;
 public int numberOfSessions, numCars;
 [MarshalAs(UnmanagedType.ByValTStr, SizeConst=33)] public string carModel;
 [MarshalAs(UnmanagedType.ByValTStr, SizeConst=33)] public string track;
 [MarshalAs(UnmanagedType.ByValTStr, SizeConst=33)] public string playerName;
 [MarshalAs(UnmanagedType.ByValTStr, SizeConst=33)] public string playerSurname;
 [MarshalAs(UnmanagedType.ByValTStr, SizeConst=33)] public string playerNick;
 public int sectorCount;
 public float maxTorque, maxPower;
 public int maxRpm;
 public float maxFuel;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=4)] public float[] suspensionMaxTravel;
 [MarshalAs(UnmanagedType.ByValArray, SizeConst=4)] public float[] tyreRadius;
 public float maxTurboBoost, deprecated1, deprecated2;
 public int penaltiesEnabled;
 public float aidFuelRate, aidTireRate, aidMechanicalDamage;
 public int aidAllowTyreBlankets;
 public float aidStability;
 public int aidAutoClutch, aidAutoBlip, hasDRS, hasERS, hasKERS;
 public float kersMaxJ;
 public int engineBrakeSettingsCount, ersPowerControllerCount;
 public float trackSPlineLength;
 [MarshalAs(UnmanagedType.ByValTStr, SizeConst=33)] public string trackConfiguration;
}
public static class AcMemoryReader {
 public static T Read<T>(MemoryMappedFile mmf) where T:struct {
   int size = Marshal.SizeOf(typeof(T));
   byte[] bytes = new byte[size];
   using (var view = mmf.CreateViewStream(0, size, MemoryMappedFileAccess.Read)) {
     int read=0; while(read<size) { int n=view.Read(bytes,read,size-read); if(n<=0) throw new EndOfStreamException(); read+=n; }
   }
   var handle=GCHandle.Alloc(bytes,GCHandleType.Pinned);
   try { return (T)Marshal.PtrToStructure(handle.AddrOfPinnedObject(),typeof(T)); }
   finally { handle.Free(); }
 }
 // Métodos concretos evitam a sintaxe de método genérico que o Windows PowerShell 5.1 não interpreta.
 public static PhysicsPage ReadPhysics(MemoryMappedFile mmf) { return Read<PhysicsPage>(mmf); }
 public static GraphicsPage ReadGraphics(MemoryMappedFile mmf) { return Read<GraphicsPage>(mmf); }
 public static StaticPage ReadStatic(MemoryMappedFile mmf) { return Read<StaticPage>(mmf); }
}
'@

try { Add-Type -TypeDefinition $source -Language CSharp } catch {
  [Console]::Error.WriteLine("Falha ao preparar leitor C#: " + $_.Exception.Message)
  exit 2
}

$outDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'RookieLeague\Telemetry'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$sessionFile = $null
$writer = $null
$lastLap = -1
$lastPacket = -1
$lastStatus = ''
$lastMeta = ''
# V130: arquivo local preserva amostras completas; somente o painel recebe 1 amostra/s.
$lastLiveEmitAt = [DateTime]::MinValue
$liveIntervalMs = 1000

function Emit($obj) {
  $json = $obj | ConvertTo-Json -Depth 8 -Compress
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

Emit @{ type='status'; status='aguardando'; message='Aguardando Assetto Corsa' }

while ($true) {
  $p=$null; $g=$null; $s=$null
  try {
    $p=[System.IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting('Local\acpmf_physics',[System.IO.MemoryMappedFiles.MemoryMappedFileRights]::Read)
    $g=[System.IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting('Local\acpmf_graphics',[System.IO.MemoryMappedFiles.MemoryMappedFileRights]::Read)
    $s=[System.IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting('Local\acpmf_static',[System.IO.MemoryMappedFiles.MemoryMappedFileRights]::Read)
    Emit @{ type='status'; status='conectado'; message='Conectado ao Assetto Corsa' }

    while ($true) {
      $physics=[AcMemoryReader]::ReadPhysics($p)
      $graphics=[AcMemoryReader]::ReadGraphics($g)
      $static=[AcMemoryReader]::ReadStatic($s)

      if ($graphics.status -eq 2) {
        $meta = "$($static.carModel)|$($static.track)|$($static.trackConfiguration)"
        if ($null -eq $writer -or $meta -ne $lastMeta) {
          if ($writer) { $writer.Flush(); $writer.Dispose() }
          $stamp=Get-Date -Format 'yyyyMMdd_HHmmss'
          $safeCar=($static.carModel -replace '[^a-zA-Z0-9_-]','_')
          $safeTrack=($static.track -replace '[^a-zA-Z0-9_-]','_')
          $sessionFile=Join-Path $outDir "AC_${safeTrack}_${safeCar}_${stamp}.jsonl"
          $writer=[System.IO.StreamWriter]::new($sessionFile,$true,[System.Text.UTF8Encoding]::new($false))
          $lastMeta=$meta
          $lastLap=$graphics.completedLaps
          Emit @{ type='status'; status='gravando'; message='Sessão local iniciada'; file=$sessionFile; car=$static.carModel; track=$static.track }
        }

        if ($writer -and $physics.packetId -ne $lastPacket) {
          $lastPacket=$physics.packetId
          $sample = @{
            type='sample'; timestamp=[DateTime]::UtcNow.ToString('o')
            data=@{
              speed_kmh=[Math]::Round($physics.speedKmh,2)
              rpm=$physics.rpms; gear=($physics.gear - 1)
              throttle=[Math]::Round($physics.gas,4)
              brake=[Math]::Round($physics.brake,4)
              clutch=[Math]::Round($physics.clutch,4)
              fuel_l=[Math]::Round($physics.fuel,2)
              lap=$graphics.completedLaps
              lap_time_ms=$graphics.iCurrentTime
              last_lap_ms=$graphics.iLastTime
              best_lap_ms=$graphics.iBestTime
              sector=$graphics.currentSectorIndex
              normalized_position=[Math]::Round($graphics.normalizedCarPosition,5)
              position_x=$graphics.carCoordinates[0]
              position_y=$graphics.carCoordinates[1]
              position_z=$graphics.carCoordinates[2]
              car=$static.carModel; track=$static.track; track_config=$static.trackConfiguration
              session_type=$graphics.session; status=$graphics.status
            }
          }
          $line=$sample | ConvertTo-Json -Depth 8 -Compress
          $writer.WriteLine($line)
          $nowLive = [DateTime]::UtcNow
          if (($nowLive - $lastLiveEmitAt).TotalMilliseconds -ge $liveIntervalMs) {
            Emit $sample
            $lastLiveEmitAt = $nowLive
          }
        }

        if ($graphics.completedLaps -gt $lastLap) {
          $lastLap=$graphics.completedLaps
          Emit @{ type='lap'; lap=$lastLap; lap_time_ms=$graphics.iLastTime; best_lap_ms=$graphics.iBestTime; file=$sessionFile; session_type=$graphics.session }
        }
      } elseif ($lastStatus -ne 'fora_da_pista') {
        $lastStatus='fora_da_pista'
        Emit @{ type='status'; status='fora_da_pista'; message='Aguardando entrada na pista' }
      }
      Start-Sleep -Milliseconds 50
    }
  } catch {
    if ($writer) { $writer.Flush(); $writer.Dispose(); $writer=$null }
    if ($p) { $p.Dispose() }; if ($g) { $g.Dispose() }; if ($s) { $s.Dispose() }
    Emit @{ type='status'; status='aguardando'; message='Assetto Corsa não detectado; tentando novamente'; detail=$_.Exception.Message }
    Start-Sleep -Seconds 2
  }
}
