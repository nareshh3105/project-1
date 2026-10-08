@echo off
rem Builds the virtual camera: CodeBuildersCamera.dll (the media source Windows loads)
rem and vcamtool.exe (registers it and runs it). Needs Visual Studio Build Tools.
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
set OUT=%~dp0build
if not exist "%OUT%" mkdir "%OUT%"
pushd "%OUT%"
cl /nologo /std:c++17 /O2 /EHsc /MT /W3 /LD /Fe:CodeBuildersCamera.dll "%~dp0src\source.cpp" /link /DEF:"%~dp0src\source.def" mfplat.lib mf.lib mfuuid.lib strmiids.lib ole32.lib oleaut32.lib propsys.lib uuid.lib || exit /b 1
cl /nologo /std:c++17 /O2 /EHsc /MT /W3 /Fe:vcamtool.exe "%~dp0src\tool.cpp" /link mfplat.lib mfsensorgroup.lib mf.lib mfuuid.lib ole32.lib advapi32.lib || exit /b 1
popd
