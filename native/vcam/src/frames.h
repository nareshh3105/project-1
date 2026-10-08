#pragma once
#include <cstdint>
#include <cstring>

// The picture the camera sends: NV12, which every app that reads a webcam takes.
#define VCAM_WIDTH 1280
#define VCAM_HEIGHT 720
#define VCAM_FPS 30
#define VCAM_FRAME_BYTES (VCAM_WIDTH * VCAM_HEIGHT * 3 / 2)

// Where frames come from. For now: a test pattern, a bar sweeping across colour bars.
class FrameSource {
public:
  void Next(uint8_t* nv12) {
    uint8_t* y = nv12;
    uint8_t* uv = nv12 + VCAM_WIDTH * VCAM_HEIGHT;
    // Seven colour bars (Y, U, V).
    static const uint8_t bars[7][3] = {
      {180, 128, 128}, {162, 44, 142}, {131, 156, 44}, {112, 72, 58}, {84, 184, 198}, {65, 100, 212}, {35, 212, 114},
    };
    const int sweep = (frame_ * 8) % VCAM_WIDTH;
    for (int row = 0; row < VCAM_HEIGHT; row++) {
      for (int col = 0; col < VCAM_WIDTH; col++) {
        const int bar = col * 7 / VCAM_WIDTH;
        const bool white = col >= sweep && col < sweep + 24;
        y[row * VCAM_WIDTH + col] = white ? 235 : bars[bar][0];
      }
    }
    for (int row = 0; row < VCAM_HEIGHT / 2; row++) {
      for (int col = 0; col < VCAM_WIDTH; col += 2) {
        const int bar = col * 7 / VCAM_WIDTH;
        const bool white = col >= sweep && col < sweep + 24;
        uv[row * VCAM_WIDTH + col] = white ? 128 : bars[bar][1];
        uv[row * VCAM_WIDTH + col + 1] = white ? 128 : bars[bar][2];
      }
    }
    frame_++;
  }

private:
  uint32_t frame_ = 0;
};
