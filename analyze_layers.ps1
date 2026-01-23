$csv = Import-Csv "C:\Users\nicog\Downloads\wetransfer_lds-pak-licitacion-oocc_2026-01-08_0027\PIL.IA\LDS_PAK - (LC) Copia Clean.csv"

Write-Output "=== LAYER ANALYSIS WITH AREAS ===`n"

# Group by layer and calculate total areas
$layerStats = $csv | Where-Object { $_.Area_m2 -ne '' -and [double]$_.Area_m2 -gt 0.01 } | 
    Group-Object Layer | 
    ForEach-Object {
        $layer = $_.Name
        $totalArea = ($_.Group | ForEach-Object { [double]$_.Area_m2 } | Measure-Object -Sum).Sum
        $colors = $_.Group | Where-Object { $_.Color -ne '' -and $_.Color -ne 'ByLayer' } | 
                  Select-Object -ExpandProperty Color -Unique | Select-Object -First 3
        
        [PSCustomObject]@{
            Layer = $layer
            TotalArea_m2 = [math]::Round($totalArea, 2)
            EntityCount = $_.Count
            Colors = ($colors -join ', ')
        }
    } | Sort-Object TotalArea_m2 -Descending

Write-Output "Top 30 Layers by Area:"
$layerStats | Select-Object -First 30 | Format-Table -AutoSize

Write-Output "`n=== KEY LAYERS FOR MATCHING ===`n"
$keyLayers = @('FA_TABIQUES', 'FA-PAVIMENTO', 'A-ARQ-CIELO FALSO', 'FA_COLOR 12', 'MB-ELEV 2', 'MB-ELEV 4')
foreach ($key in $keyLayers) {
    $found = $layerStats | Where-Object { $_.Layer -eq $key }
    if ($found) {
        Write-Output "$($found.Layer): $($found.TotalArea_m2) m² ($($found.EntityCount) entities) - Colors: $($found.Colors)"
    } else {
        Write-Output "$key: NOT FOUND"
    }
}
