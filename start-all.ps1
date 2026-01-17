# Start All Services Script
# Starts both the Next.js app and the Python Geometry Service

Write-Host "🚀 Starting PIL.IA Services..." -ForegroundColor Cyan
Write-Host ""

# Check if Python venv exists
if (-not (Test-Path "geometry-service\venv\Scripts\python.exe")) {
    Write-Host "❌ Python virtual environment not found!" -ForegroundColor Red
    Write-Host "   Run: cd geometry-service && python -m venv venv && .\venv\Scripts\pip install -r requirements.txt"
    exit 1
}

# Start Python Geometry Service in background
Write-Host "🐍 Starting Python Geometry Service (port 8000)..." -ForegroundColor Yellow
$pythonJob = Start-Process -PassThru -NoNewWindow -FilePath "geometry-service\venv\Scripts\uvicorn" `
    -ArgumentList "main:app", "--reload", "--port", "8000" `
    -WorkingDirectory "geometry-service"

Start-Sleep -Seconds 3

# Check if Python service started
try {
    $health = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 5
    Write-Host "   ✅ Python service is healthy" -ForegroundColor Green
} catch {
    Write-Host "   ⚠️ Python service may still be starting..." -ForegroundColor Yellow
}

Write-Host ""

# Start Next.js in foreground
Write-Host "⚡ Starting Next.js App (port 9002)..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C to stop all services" -ForegroundColor DarkGray
Write-Host ""

npm run dev

# Cleanup: stop Python service when Next.js stops
if ($pythonJob -and -not $pythonJob.HasExited) {
    Write-Host ""
    Write-Host "🛑 Stopping Python service..." -ForegroundColor Yellow
    Stop-Process -Id $pythonJob.Id -Force
    Write-Host "   ✅ All services stopped" -ForegroundColor Green
}
