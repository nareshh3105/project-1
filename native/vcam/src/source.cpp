// The CodeBuilders virtual camera: a Media Foundation media source that
// Windows' Frame Server loads, so that apps (Zoom, Teams, browsers) see it as a
// webcam. This first version draws a moving test pattern; frames from the app
// are added on top of it.

#define WINVER 0x0A00
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfobjects.h>
#include <mferror.h>
#include <mfvirtualcamera.h>
#include <ks.h>
#include <ksmedia.h>
#include <ksproxy.h>
#include <atomic>
#include <thread>
#include <mutex>
#include <vector>
#include <cstdint>

#include "frames.h"
#include <initguid.h>
#include "guids.h"

static std::atomic<long> g_objects{0};
static std::atomic<long> g_locks{0};
HMODULE g_module = nullptr;

// ── The media source ────────────────────────────────────────────────────────

class Stream;

class Source final : public IMFMediaSourceEx, public IMFGetService, public IKsControl {
public:
  Source();
  HRESULT Init();

  // IUnknown
  STDMETHODIMP QueryInterface(REFIID riid, void** out) override {
    if (!out) return E_POINTER;
    *out = nullptr;
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IMFMediaEventGenerator) ||
        riid == __uuidof(IMFMediaSource) || riid == __uuidof(IMFMediaSourceEx)) *out = static_cast<IMFMediaSourceEx*>(this);
    else if (riid == __uuidof(IMFGetService)) *out = static_cast<IMFGetService*>(this);
    else if (riid == __uuidof(IKsControl)) *out = static_cast<IKsControl*>(this);
    else return E_NOINTERFACE;
    AddRef();
    return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return ++refs_; }
  STDMETHODIMP_(ULONG) Release() override { ULONG n = --refs_; if (n == 0) delete this; return n; }

  // IMFMediaEventGenerator
  STDMETHODIMP GetEvent(DWORD flags, IMFMediaEvent** e) override { return queue_->GetEvent(flags, e); }
  STDMETHODIMP BeginGetEvent(IMFAsyncCallback* cb, IUnknown* state) override { return queue_->BeginGetEvent(cb, state); }
  STDMETHODIMP EndGetEvent(IMFAsyncResult* r, IMFMediaEvent** e) override { return queue_->EndGetEvent(r, e); }
  STDMETHODIMP QueueEvent(MediaEventType t, REFGUID ext, HRESULT hr, const PROPVARIANT* v) override { return queue_->QueueEventParamVar(t, ext, hr, v); }

  // IMFMediaSource
  STDMETHODIMP GetCharacteristics(DWORD* c) override { *c = MFMEDIASOURCE_IS_LIVE; return S_OK; }
  STDMETHODIMP CreatePresentationDescriptor(IMFPresentationDescriptor** pd) override;
  STDMETHODIMP Start(IMFPresentationDescriptor* pd, const GUID* fmt, const PROPVARIANT* pos) override;
  STDMETHODIMP Stop() override;
  STDMETHODIMP Pause() override { return MF_E_INVALID_STATE_TRANSITION; }
  STDMETHODIMP Shutdown() override;

  // IMFMediaSourceEx
  STDMETHODIMP GetSourceAttributes(IMFAttributes** a) override { attrs_->AddRef(); *a = attrs_; return S_OK; }
  STDMETHODIMP GetStreamAttributes(DWORD id, IMFAttributes** a) override;
  STDMETHODIMP SetD3DManager(IUnknown*) override { return S_OK; }

  // IMFGetService
  STDMETHODIMP GetService(REFGUID, REFIID, LPVOID*) override { return MF_E_UNSUPPORTED_SERVICE; }

  // IKsControl: nothing is supported, and that is said plainly.
  STDMETHODIMP KsProperty(PKSPROPERTY, ULONG, LPVOID, ULONG, ULONG*) override { return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND); }
  STDMETHODIMP KsMethod(PKSMETHOD, ULONG, LPVOID, ULONG, ULONG*) override { return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND); }
  STDMETHODIMP KsEvent(PKSEVENT, ULONG, LPVOID, ULONG, ULONG*) override { return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND); }

  IMFMediaEventQueue* queue() { return queue_; }

private:
  ~Source();
  std::atomic<ULONG> refs_{1};
  IMFMediaEventQueue* queue_ = nullptr;
  IMFAttributes* attrs_ = nullptr;
  IMFStreamDescriptor* descriptor_ = nullptr;
  Stream* stream_ = nullptr;
  bool shutdown_ = false;
  std::mutex lock_;
};

// ── The one video stream ────────────────────────────────────────────────────

class Stream final : public IMFMediaStream2 {
public:
  Stream(Source* source, IMFStreamDescriptor* descriptor) : source_(source), descriptor_(descriptor) {
    source_->AddRef();
    descriptor_->AddRef();
    MFCreateEventQueue(&queue_);
    MFCreateAttributes(&attrs_, 4);
    attrs_->SetGUID(MF_DEVICESTREAM_STREAM_CATEGORY, PINNAME_VIDEO_CAPTURE);
    attrs_->SetUINT32(MF_DEVICESTREAM_STREAM_ID, 0);
    attrs_->SetUINT32(MF_DEVICESTREAM_FRAMESERVER_SHARED, 1);
    ++g_objects;
  }

  STDMETHODIMP QueryInterface(REFIID riid, void** out) override {
    if (!out) return E_POINTER;
    *out = nullptr;
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IMFMediaEventGenerator) ||
        riid == __uuidof(IMFMediaStream) || riid == __uuidof(IMFMediaStream2)) *out = static_cast<IMFMediaStream2*>(this);
    else return E_NOINTERFACE;
    AddRef();
    return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return ++refs_; }
  STDMETHODIMP_(ULONG) Release() override { ULONG n = --refs_; if (n == 0) delete this; return n; }

  STDMETHODIMP GetEvent(DWORD flags, IMFMediaEvent** e) override { return queue_->GetEvent(flags, e); }
  STDMETHODIMP BeginGetEvent(IMFAsyncCallback* cb, IUnknown* state) override { return queue_->BeginGetEvent(cb, state); }
  STDMETHODIMP EndGetEvent(IMFAsyncResult* r, IMFMediaEvent** e) override { return queue_->EndGetEvent(r, e); }
  STDMETHODIMP QueueEvent(MediaEventType t, REFGUID ext, HRESULT hr, const PROPVARIANT* v) override { return queue_->QueueEventParamVar(t, ext, hr, v); }

  STDMETHODIMP GetMediaSource(IMFMediaSource** s) override { source_->AddRef(); *s = source_; return S_OK; }
  STDMETHODIMP GetStreamDescriptor(IMFStreamDescriptor** d) override { descriptor_->AddRef(); *d = descriptor_; return S_OK; }
  STDMETHODIMP RequestSample(IUnknown* token) override {
    std::lock_guard<std::mutex> g(lock_);
    if (!running_) return MF_E_MEDIA_SOURCE_WRONGSTATE;
    if (token) token->AddRef();
    tokens_.push_back(token);
    return S_OK;
  }

  STDMETHODIMP SetStreamState(MF_STREAM_STATE s) override { state_ = s; return S_OK; }
  STDMETHODIMP GetStreamState(MF_STREAM_STATE* s) override { *s = state_; return S_OK; }

  IMFAttributes* attributes() { return attrs_; }

  void Start(bool first) {
    {
      std::lock_guard<std::mutex> g(lock_);
      running_ = true;
    }
    queue_->QueueEventParamVar(MEStreamStarted, GUID_NULL, S_OK, nullptr);
    if (!worker_.joinable()) {
      stop_ = false;
      worker_ = std::thread([this] { Run(); });
    }
    (void)first;
  }

  void Stop() {
    {
      std::lock_guard<std::mutex> g(lock_);
      running_ = false;
      for (auto* t : tokens_) if (t) t->Release();
      tokens_.clear();
    }
    queue_->QueueEventParamVar(MEStreamStopped, GUID_NULL, S_OK, nullptr);
  }

  void Shutdown() {
    stop_ = true;
    if (worker_.joinable()) worker_.join();
    std::lock_guard<std::mutex> g(lock_);
    for (auto* t : tokens_) if (t) t->Release();
    tokens_.clear();
    if (queue_) queue_->Shutdown();
  }

private:
  ~Stream() {
    Shutdown();
    if (queue_) queue_->Release();
    if (attrs_) attrs_->Release();
    descriptor_->Release();
    source_->Release();
    --g_objects;
  }

  void Run() {
    FrameSource frames;
    const auto period = std::chrono::microseconds(1000000 / VCAM_FPS);
    auto next = std::chrono::steady_clock::now();
    std::vector<uint8_t> buffer(VCAM_FRAME_BYTES);
    while (!stop_) {
      next += period;
      std::this_thread::sleep_until(next);

      IUnknown* token = nullptr;
      {
        std::lock_guard<std::mutex> g(lock_);
        if (!running_ || tokens_.empty()) continue;
        token = tokens_.front();
        tokens_.erase(tokens_.begin());
      }

      frames.Next(buffer.data());

      IMFSample* sample = nullptr;
      IMFMediaBuffer* media = nullptr;
      if (SUCCEEDED(MFCreateSample(&sample)) && SUCCEEDED(MFCreateMemoryBuffer(VCAM_FRAME_BYTES, &media))) {
        BYTE* data = nullptr;
        if (SUCCEEDED(media->Lock(&data, nullptr, nullptr))) {
          memcpy(data, buffer.data(), VCAM_FRAME_BYTES);
          media->Unlock();
        }
        media->SetCurrentLength(VCAM_FRAME_BYTES);
        sample->AddBuffer(media);
        sample->SetSampleTime(MFGetSystemTime());
        sample->SetSampleDuration(10'000'000LL / VCAM_FPS);
        if (token) sample->SetUnknown(MFSampleExtension_Token, token);
        queue_->QueueEventParamUnk(MEMediaSample, GUID_NULL, S_OK, sample);
      }
      if (media) media->Release();
      if (sample) sample->Release();
      if (token) token->Release();
    }
  }

  std::atomic<ULONG> refs_{1};
  Source* source_;
  IMFStreamDescriptor* descriptor_;
  IMFMediaEventQueue* queue_ = nullptr;
  IMFAttributes* attrs_ = nullptr;
  MF_STREAM_STATE state_ = MF_STREAM_STATE_STOPPED;
  std::mutex lock_;
  std::vector<IUnknown*> tokens_;
  bool running_ = false;
  std::atomic<bool> stop_{false};
  std::thread worker_;
};

// ── Source methods ──────────────────────────────────────────────────────────

Source::Source() { ++g_objects; }

Source::~Source() {
  if (stream_) { stream_->Shutdown(); stream_->Release(); }
  if (descriptor_) descriptor_->Release();
  if (attrs_) attrs_->Release();
  if (queue_) queue_->Release();
  --g_objects;
}

HRESULT Source::Init() {
  HRESULT hr = MFCreateEventQueue(&queue_);
  if (FAILED(hr)) return hr;
  hr = MFCreateAttributes(&attrs_, 4);
  if (FAILED(hr)) return hr;
  attrs_->SetString(MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME, L"CodeBuilders Virtual Camera");
  attrs_->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);

  IMFMediaType* type = nullptr;
  hr = MFCreateMediaType(&type);
  if (FAILED(hr)) return hr;
  type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
  type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12);
  MFSetAttributeSize(type, MF_MT_FRAME_SIZE, VCAM_WIDTH, VCAM_HEIGHT);
  MFSetAttributeRatio(type, MF_MT_FRAME_RATE, VCAM_FPS, 1);
  MFSetAttributeRatio(type, MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
  type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
  type->SetUINT32(MF_MT_ALL_SAMPLES_INDEPENDENT, TRUE);
  type->SetUINT32(MF_MT_DEFAULT_STRIDE, VCAM_WIDTH);
  type->SetUINT32(MF_MT_SAMPLE_SIZE, VCAM_FRAME_BYTES);
  type->SetUINT32(MF_MT_AVG_BITRATE, VCAM_WIDTH * VCAM_HEIGHT * 12 * VCAM_FPS);

  hr = MFCreateStreamDescriptor(0, 1, &type, &descriptor_);
  if (SUCCEEDED(hr)) {
    IMFMediaTypeHandler* handler = nullptr;
    if (SUCCEEDED(descriptor_->GetMediaTypeHandler(&handler))) {
      handler->SetCurrentMediaType(type);
      handler->Release();
    }
    descriptor_->SetUINT32(MF_DEVICESTREAM_STREAM_ID, 0);
    descriptor_->SetGUID(MF_DEVICESTREAM_STREAM_CATEGORY, PINNAME_VIDEO_CAPTURE);
    descriptor_->SetUINT32(MF_DEVICESTREAM_FRAMESERVER_SHARED, 1);
  }
  type->Release();
  if (FAILED(hr)) return hr;

  stream_ = new Stream(this, descriptor_);
  return S_OK;
}

STDMETHODIMP Source::CreatePresentationDescriptor(IMFPresentationDescriptor** pd) {
  std::lock_guard<std::mutex> g(lock_);
  if (shutdown_) return MF_E_SHUTDOWN;
  HRESULT hr = MFCreatePresentationDescriptor(1, &descriptor_, pd);
  if (SUCCEEDED(hr)) (*pd)->SelectStream(0);
  return hr;
}

STDMETHODIMP Source::Start(IMFPresentationDescriptor*, const GUID*, const PROPVARIANT*) {
  std::lock_guard<std::mutex> g(lock_);
  if (shutdown_) return MF_E_SHUTDOWN;
  queue_->QueueEventParamUnk(MENewStream, GUID_NULL, S_OK, static_cast<IMFMediaStream*>(stream_));
  stream_->Start(true);
  PROPVARIANT start;
  PropVariantInit(&start);
  start.vt = VT_I8;
  start.hVal.QuadPart = 0;
  queue_->QueueEventParamVar(MESourceStarted, GUID_NULL, S_OK, &start);
  return S_OK;
}

STDMETHODIMP Source::Stop() {
  std::lock_guard<std::mutex> g(lock_);
  if (shutdown_) return MF_E_SHUTDOWN;
  stream_->Stop();
  queue_->QueueEventParamVar(MESourceStopped, GUID_NULL, S_OK, nullptr);
  return S_OK;
}

STDMETHODIMP Source::Shutdown() {
  std::lock_guard<std::mutex> g(lock_);
  if (shutdown_) return S_OK;
  shutdown_ = true;
  if (stream_) stream_->Shutdown();
  queue_->Shutdown();
  return S_OK;
}

STDMETHODIMP Source::GetStreamAttributes(DWORD id, IMFAttributes** a) {
  if (id != 0) return MF_E_INVALIDSTREAMNUMBER;
  IMFAttributes* attrs = stream_->attributes();
  attrs->AddRef();
  *a = attrs;
  return S_OK;
}

// ── Activation and the class factory ────────────────────────────────────────

// Windows asks for an IMFActivate (or a media source) by class id.
class Activate final : public IMFActivate {
public:
  Activate() { ++g_objects; MFCreateAttributes(&attrs_, 2); }

  STDMETHODIMP QueryInterface(REFIID riid, void** out) override {
    if (!out) return E_POINTER;
    *out = nullptr;
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IMFAttributes) || riid == __uuidof(IMFActivate)) *out = static_cast<IMFActivate*>(this);
    else return E_NOINTERFACE;
    AddRef();
    return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return ++refs_; }
  STDMETHODIMP_(ULONG) Release() override { ULONG n = --refs_; if (n == 0) delete this; return n; }

  STDMETHODIMP ActivateObject(REFIID riid, void** out) override {
    Source* source = new Source();
    HRESULT hr = source->Init();
    if (SUCCEEDED(hr)) hr = source->QueryInterface(riid, out);
    source->Release();
    return hr;
  }
  STDMETHODIMP ShutdownObject() override { return S_OK; }
  STDMETHODIMP DetachObject() override { return S_OK; }

#define FWD(call) return attrs_->call
  STDMETHODIMP GetItem(REFGUID k, PROPVARIANT* v) override { FWD(GetItem(k, v)); }
  STDMETHODIMP GetItemType(REFGUID k, MF_ATTRIBUTE_TYPE* t) override { FWD(GetItemType(k, t)); }
  STDMETHODIMP CompareItem(REFGUID k, REFPROPVARIANT v, BOOL* r) override { FWD(CompareItem(k, v, r)); }
  STDMETHODIMP Compare(IMFAttributes* o, MF_ATTRIBUTES_MATCH_TYPE t, BOOL* r) override { FWD(Compare(o, t, r)); }
  STDMETHODIMP GetUINT32(REFGUID k, UINT32* v) override { FWD(GetUINT32(k, v)); }
  STDMETHODIMP GetUINT64(REFGUID k, UINT64* v) override { FWD(GetUINT64(k, v)); }
  STDMETHODIMP GetDouble(REFGUID k, double* v) override { FWD(GetDouble(k, v)); }
  STDMETHODIMP GetGUID(REFGUID k, GUID* v) override { FWD(GetGUID(k, v)); }
  STDMETHODIMP GetStringLength(REFGUID k, UINT32* v) override { FWD(GetStringLength(k, v)); }
  STDMETHODIMP GetString(REFGUID k, LPWSTR b, UINT32 n, UINT32* l) override { FWD(GetString(k, b, n, l)); }
  STDMETHODIMP GetAllocatedString(REFGUID k, LPWSTR* b, UINT32* l) override { FWD(GetAllocatedString(k, b, l)); }
  STDMETHODIMP GetBlobSize(REFGUID k, UINT32* v) override { FWD(GetBlobSize(k, v)); }
  STDMETHODIMP GetBlob(REFGUID k, UINT8* b, UINT32 n, UINT32* l) override { FWD(GetBlob(k, b, n, l)); }
  STDMETHODIMP GetAllocatedBlob(REFGUID k, UINT8** b, UINT32* n) override { FWD(GetAllocatedBlob(k, b, n)); }
  STDMETHODIMP GetUnknown(REFGUID k, REFIID i, LPVOID* v) override { FWD(GetUnknown(k, i, v)); }
  STDMETHODIMP SetItem(REFGUID k, REFPROPVARIANT v) override { FWD(SetItem(k, v)); }
  STDMETHODIMP DeleteItem(REFGUID k) override { FWD(DeleteItem(k)); }
  STDMETHODIMP DeleteAllItems() override { FWD(DeleteAllItems()); }
  STDMETHODIMP SetUINT32(REFGUID k, UINT32 v) override { FWD(SetUINT32(k, v)); }
  STDMETHODIMP SetUINT64(REFGUID k, UINT64 v) override { FWD(SetUINT64(k, v)); }
  STDMETHODIMP SetDouble(REFGUID k, double v) override { FWD(SetDouble(k, v)); }
  STDMETHODIMP SetGUID(REFGUID k, REFGUID v) override { FWD(SetGUID(k, v)); }
  STDMETHODIMP SetString(REFGUID k, LPCWSTR v) override { FWD(SetString(k, v)); }
  STDMETHODIMP SetBlob(REFGUID k, const UINT8* b, UINT32 n) override { FWD(SetBlob(k, b, n)); }
  STDMETHODIMP SetUnknown(REFGUID k, IUnknown* v) override { FWD(SetUnknown(k, v)); }
  STDMETHODIMP LockStore() override { FWD(LockStore()); }
  STDMETHODIMP UnlockStore() override { FWD(UnlockStore()); }
  STDMETHODIMP GetCount(UINT32* n) override { FWD(GetCount(n)); }
  STDMETHODIMP GetItemByIndex(UINT32 i, GUID* k, PROPVARIANT* v) override { FWD(GetItemByIndex(i, k, v)); }
  STDMETHODIMP CopyAllItems(IMFAttributes* d) override { FWD(CopyAllItems(d)); }
#undef FWD

private:
  ~Activate() { if (attrs_) attrs_->Release(); --g_objects; }
  std::atomic<ULONG> refs_{1};
  IMFAttributes* attrs_ = nullptr;
};

class Factory final : public IClassFactory {
public:
  STDMETHODIMP QueryInterface(REFIID riid, void** out) override {
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IClassFactory)) { *out = this; AddRef(); return S_OK; }
    *out = nullptr;
    return E_NOINTERFACE;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return 2; }
  STDMETHODIMP_(ULONG) Release() override { return 1; }
  STDMETHODIMP CreateInstance(IUnknown* outer, REFIID riid, void** out) override {
    if (outer) return CLASS_E_NOAGGREGATION;
    if (!out) return E_POINTER;
    *out = nullptr;
    if (riid == __uuidof(IMFMediaSource) || riid == __uuidof(IMFMediaSourceEx)) {
      Source* source = new Source();
      HRESULT hr = source->Init();
      if (SUCCEEDED(hr)) hr = source->QueryInterface(riid, out);
      source->Release();
      return hr;
    }
    Activate* activate = new Activate();
    HRESULT hr = activate->QueryInterface(riid, out);
    activate->Release();
    return hr;
  }
  STDMETHODIMP LockServer(BOOL lock) override { if (lock) ++g_locks; else --g_locks; return S_OK; }
};

static Factory g_factory;

STDAPI DllGetClassObject(REFCLSID clsid, REFIID riid, void** out) {
  if (clsid != CLSID_CodeBuildersCamera) return CLASS_E_CLASSNOTAVAILABLE;
  return g_factory.QueryInterface(riid, out);
}

STDAPI DllCanUnloadNow() { return (g_objects == 0 && g_locks == 0) ? S_OK : S_FALSE; }

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) { g_module = module; DisableThreadLibraryCalls(module); }
  return TRUE;
}
