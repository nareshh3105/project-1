#pragma once
#include <guiddef.h>

// The class id of the camera's media source. Registered by the app; the camera
// is created from it.
// {B4D1A2C7-5E3F-4C1A-9D6B-2F7E8A3C1D90}
DEFINE_GUID(CLSID_CodeBuildersCamera, 0xb4d1a2c7, 0x5e3f, 0x4c1a, 0x9d, 0x6b, 0x2f, 0x7e, 0x8a, 0x3c, 0x1d, 0x90);

#define VCAM_CLSID_STRING L"{B4D1A2C7-5E3F-4C1A-9D6B-2F7E8A3C1D90}"
#define VCAM_NAME L"CodeBuilders Virtual Camera"
