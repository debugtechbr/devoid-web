@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e abra este arquivo de novo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando as pecas do projeto. Isso pode demorar alguns minutos...
  call npm install
  if errorlevel 1 (
    echo Erro na instalacao. Veja a mensagem acima.
    pause
    exit /b 1
  )
)
echo Gerando o instalador. Aguarde...
call npm run build:win
if errorlevel 1 (
  echo Erro ao gerar o instalador. Veja a mensagem acima.
  pause
  exit /b 1
)
echo.
echo Pronto! O instalador esta na pasta dist.
explorer dist
pause
