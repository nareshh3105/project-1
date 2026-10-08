// vcamtool: registers the camera's COM class for the current user and runs the
// camera until it is told to stop.
//
//   vcamtool register <dll>     put the class in HKCU
//   vcamtool unregister         take it out
//   vcamtool run                create the camera and keep it until stdin closes or a line arrives

#define WINVER 0x0A00
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfvirtualcamera.h>
#include <cstdio>
#include <string>
#include "guids.h"

#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfsensorgroup.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "advapi32.lib")

static const wchar_t* kKey = L"Software\\Classes\\CLSID\\" VCAM_CLSID_STRING;

static int Register(const wchar_t* dll) {
  HKEY key = nullptr;
  std::wstring base = kKey;
  if (RegCreateKeyExW(HKEY_CURRENT_USER, base.c_str(), 0, nullptr, 0, KEY_WRITE, nullptr, &key, nullptr) != ERROR_SUCCESS) return 1;
  RegSetValueExW(key, nullptr, 0, REG_SZ, (const BYTE*)VCAM_NAME, (DWORD)((wcslen(VCAM_NAME) + 1) * 2));
  RegCloseKey(key);
  std::wstring server = base + L"\\InprocServer32";
  if (RegCreateKeyExW(HKEY_CURRENT_USER, server.c_str(), 0, nullptr, 0, KEY_WRITE, nullptr, &key, nullptr) != ERROR_SUCCESS) return 1;
  RegSetValueExW(key, nullptr, 0, REG_SZ, (const BYTE*)dll, (DWORD)((wcslen(dll) + 1) * 2));
  const wchar_t* model = L"Both";
  RegSetValueExW(key, L"ThreadingModel", 0, REG_SZ, (const BYTE*)model, (DWORD)((wcslen(model) + 1) * 2));
  RegCloseKey(key);
  printf("registered %ls\n", dll);
  return 0;
}

static int Unregister() {
  RegDeleteTreeW(HKEY_CURRENT_USER, kKey);
  printf("unregistered\n");
  return 0;
}

static int Run() {
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) { printf("CoInitializeEx failed 0x%08x\n", hr); return 2; }
  hr = MFStartup(MF_VERSION);
  if (FAILED(hr)) { printf("MFStartup failed 0x%08x\n", hr); return 2; }

  IMFVirtualCamera* camera = nullptr;
  hr = MFCreateVirtualCamera(MFVirtualCameraType_SoftwareCameraSource, MFVirtualCameraLifetime_Session,
                             MFVirtualCameraAccess_CurrentUser, VCAM_NAME, VCAM_CLSID_STRING, nullptr, 0, &camera);
  if (FAILED(hr)) { printf("MFCreateVirtualCamera failed 0x%08x\n", hr); return 3; }
  hr = camera->Start(nullptr);
  if (FAILED(hr)) { printf("Start failed 0x%08x\n", hr); return 4; }
  printf("camera started\n");
  fflush(stdout);

  // Runs until a line (or the end of the input) arrives.
  char line[16];
  fgets(line, sizeof line, stdin);

  camera->Remove();
  camera->Release();
  MFShutdown();
  printf("camera removed\n");
  return 0;
}

int wmain(int argc, wchar_t** argv) {
  if (argc >= 3 && wcscmp(argv[1], L"register") == 0) return Register(argv[2]);
  if (argc >= 2 && wcscmp(argv[1], L"unregister") == 0) return Unregister();
  if (argc >= 2 && wcscmp(argv[1], L"run") == 0) return Run();
  printf("usage: vcamtool register <dll> | unregister | run\n");
  return 1;
}
