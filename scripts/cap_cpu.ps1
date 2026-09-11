<#
.SYNOPSIS
    Cap this project's processes to a share of the machine's logical cores.

.DESCRIPTION
    The long jobs here are CPU-hungry and none of them can use the GPU: 7z
    extraction (LZMA2 is serial-dependent, no GPU decompressor exists), SNAP's
    Refined Lee and Terrain-Correction chain, and the mask-contouring pass in
    dataset assembly. Left alone they will take every core and make the machine
    unusable for anything else.

    Affinity is the right lever rather than reducing thread counts, because
    PHASE-02 pins `workers=8` from P004 section 2.7 -- changing that would be a
    deviation from the training protocol, where restricting *scheduling* is not.

    Child processes inherit affinity on Windows, so capping a parent before it
    spawns its dataloader workers caps the whole tree. Re-run this after
    launching a new job; it is idempotent.

.PARAMETER Fraction
    Share of logical cores to allow. Defaults to 0.8, agreed with the user.

.PARAMETER Priority
    Scheduling priority. BelowNormal keeps the desktop responsive without
    reducing throughput much, since these jobs are not latency-sensitive.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/cap_cpu.ps1
    powershell -ExecutionPolicy Bypass -File scripts/cap_cpu.ps1 -Fraction 0.5
#>
param(
    [double]$Fraction = 0.8,
    [string]$Priority = 'BelowNormal'
)

$cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$allowed = [int][Math]::Floor($cores * $Fraction)
if ($allowed -lt 1) { $allowed = 1 }

# Integer shift, not [Math]::Pow -- Pow returns a Double and IntPtr will not
# accept it, which fails with a type-conversion error rather than a bad mask.
$maskVal = ([int64]1 -shl $allowed) - 1
$mask = [IntPtr]$maskVal

Write-Output "logical cores: $cores | allowing $allowed ($([int]($Fraction*100))%) | mask 0x$([Convert]::ToString($maskVal,16))"

$targets = @('python', 'java', 'gpt', 'WinRAR', '7z')
$touched = 0

foreach ($name in $targets) {
    foreach ($proc in (Get-Process -Name $name -ErrorAction SilentlyContinue)) {
        try {
            $proc.ProcessorAffinity = $mask
            $proc.PriorityClass = $Priority
            Write-Output ("  capped {0,-8} pid {1,-7} -> {2} cores, {3}" -f $proc.ProcessName, $proc.Id, $allowed, $Priority)
            $touched++
        } catch {
            # A process that exited between enumeration and assignment, or one
            # owned by another user, is not an error worth failing the run over.
            Write-Output ("  skipped {0,-8} pid {1,-7} -> {2}" -f $proc.ProcessName, $proc.Id, $_.Exception.Message)
        }
    }
}

Write-Output "capped $touched process(es)"
