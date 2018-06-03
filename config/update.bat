for %%i in (\..\*.*) do if not "%%i"=="update.bat" if not "%%i"=="yarninstall.bat" if not "%%i"=="module.json" if not "%%i"=="yarn.lock" if not "%%i"=="package.json" del /q "%%i"
FOR /D %%p IN ("%cd%\..\lib") DO rmdir "%%p" /s /q
start /min cmd /C "yarn install"