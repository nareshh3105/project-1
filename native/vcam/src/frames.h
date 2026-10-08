#pragma once
#include <winsock2.h>
#include <ws2tcpip.h>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <thread>
#include <vector>

// The picture the camera sends: NV12, which every app that reads a webcam takes.
#define VCAM_WIDTH 1280
#define VCAM_HEIGHT 720
#define VCAM_FPS 30
#define VCAM_FRAME_BYTES (VCAM_WIDTH * VCAM_HEIGHT * 3 / 2)

// Where the app is listening. The camera runs inside a Windows service, in a
// different session from the app, so a plain local connection is the way across.
#define VCAM_PORT 12347

// Frames from the app: raw NV12 pictures, one after another, over a connection to
// 127.0.0.1. The camera is the client and keeps trying until the app is there.
class NetFrames {
public:
  NetFrames() : latest_(VCAM_FRAME_BYTES), incoming_(VCAM_FRAME_BYTES) {
    WSADATA data;
    WSAStartup(MAKEWORD(2, 2), &data);
    thread_ = std::thread([this] { Run(); });
  }
  ~NetFrames() {
    stop_ = true;
    SOCKET s = socket_.exchange(INVALID_SOCKET);
    if (s != INVALID_SOCKET) closesocket(s);
    if (thread_.joinable()) thread_.join();
    WSACleanup();
  }

  // Copies the newest picture into `nv12`. False if the app is not sending one.
  bool Latest(uint8_t* nv12) {
    if (!live_) return false;
    // A picture older than this means the app has stopped sending.
    const auto age = std::chrono::steady_clock::now() - stamp_.load();
    if (age > std::chrono::milliseconds(1500)) return false;
    std::lock_guard<std::mutex> g(lock_);
    memcpy(nv12, latest_.data(), VCAM_FRAME_BYTES);
    return true;
  }

private:
  void Run() {
    while (!stop_) {
      SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
      if (s == INVALID_SOCKET) { Sleep(500); continue; }
      sockaddr_in addr{};
      addr.sin_family = AF_INET;
      addr.sin_port = htons(VCAM_PORT);
      inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
      socket_ = s;
      if (connect(s, reinterpret_cast<sockaddr*>(&addr), sizeof addr) == 0) {
        Read(s);
      }
      live_ = false;
      SOCKET mine = socket_.exchange(INVALID_SOCKET);
      if (mine != INVALID_SOCKET) closesocket(mine);
      if (!stop_) Sleep(500);
    }
  }

  void Read(SOCKET s) {
    size_t have = 0;
    while (!stop_) {
      const int n = recv(s, reinterpret_cast<char*>(incoming_.data()) + have, static_cast<int>(VCAM_FRAME_BYTES - have), 0);
      if (n <= 0) return;
      have += n;
      if (have == VCAM_FRAME_BYTES) {
        {
          std::lock_guard<std::mutex> g(lock_);
          latest_.swap(incoming_);
        }
        stamp_ = std::chrono::steady_clock::now();
        live_ = true;
        have = 0;
      }
    }
  }

  std::thread thread_;
  std::atomic<bool> stop_{false};
  std::atomic<bool> live_{false};
  std::atomic<SOCKET> socket_{INVALID_SOCKET};
  std::atomic<std::chrono::steady_clock::time_point> stamp_{};
  std::mutex lock_;
  std::vector<uint8_t> latest_;
  std::vector<uint8_t> incoming_;
};

// What the camera sends: the app's picture when there is one, and otherwise a
// plain dark frame with a bar moving along the bottom, so a viewer can tell the
// camera is working while the app has nothing to show.
class FrameSource {
public:
  void Next(uint8_t* nv12) {
    if (net_.Latest(nv12)) return;
    Waiting(nv12);
  }

private:
  void Waiting(uint8_t* nv12) {
    uint8_t* y = nv12;
    uint8_t* uv = nv12 + VCAM_WIDTH * VCAM_HEIGHT;
    memset(y, 24, VCAM_WIDTH * VCAM_HEIGHT);
    memset(uv, 128, VCAM_WIDTH * VCAM_HEIGHT / 2);
    const int sweep = (frame_ * 8) % VCAM_WIDTH;
    for (int row = VCAM_HEIGHT - 24; row < VCAM_HEIGHT - 8; row++) {
      for (int col = sweep; col < sweep + 120 && col < VCAM_WIDTH; col++) y[row * VCAM_WIDTH + col] = 200;
    }
    frame_++;
  }

  NetFrames net_;
  uint32_t frame_ = 0;
};
