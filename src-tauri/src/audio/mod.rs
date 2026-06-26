use std::collections::HashMap;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const AUDIO_LEVELS_EVENT: &str = "audio:levels";
const METER_INTERVAL_MS: u64 = 50;

// Ordered channel IDs for consistent front-end display
pub const CHANNEL_ORDER: &[&str] = &["desktop", "mic", "browser", "music"];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelLevelEvent {
    pub id:     String,
    pub peak_l: f32,
    pub peak_r: f32,
    pub rms_l:  f32,
    pub rms_r:  f32,
}

pub struct AudioChannel {
    pub name:     String,
    pub volume:   f32,   // 0.0 – 1.0 linear
    pub muted:    bool,
    base_db:      f32,   // typical RMS level in dBFS for this channel
    phase:        f64,   // simulation oscillator phase
    envelope:     f64,   // smoothed envelope value 0..1
}

impl AudioChannel {
    pub fn new(name: &str, base_db: f32, phase_offset: f64) -> Self {
        Self {
            name:     name.to_string(),
            volume:   1.0,
            muted:    false,
            base_db,
            phase:    phase_offset,
            envelope: 0.0,
        }
    }

    fn tick(&mut self) -> (f32, f32, f32, f32) {
        self.phase += 0.08;

        // Pseudo-random signal from sum of incommensurate sinusoids
        let sig = (self.phase * 1.7).sin()
                + (self.phase * 2.9).sin() * 0.50
                + (self.phase * 5.1).sin() * 0.25
                + (self.phase * 8.3).sin() * 0.12;
        let abs = (sig.abs() / 1.87).min(1.0);

        // Envelope follower: fast attack, slow release
        self.envelope = if abs > self.envelope {
            abs * 0.8 + self.envelope * 0.2
        } else {
            abs * 0.03 + self.envelope * 0.97
        };

        if self.muted || self.volume < 0.001 {
            return (-100.0, -100.0, -100.0, -100.0);
        }

        let vol_db = 20.0 * self.volume.max(0.001_f32).log10();
        let env    = self.envelope as f32;
        let rms_db = (20.0 * env.max(0.0001_f32).log10() + self.base_db + vol_db)
            .max(-60.0)
            .min(0.0);
        let peak_db = (rms_db + 3.0).min(0.0);

        // Slight stereo variation
        let stereo = (self.phase as f32 * 0.8).sin() * 1.2;
        (
            (peak_db + stereo).min(0.0),
            (peak_db - stereo).min(0.0),
            (rms_db + stereo * 0.4).min(0.0),
            (rms_db - stereo * 0.4).min(0.0),
        )
    }
}

pub type AudioChannels = Arc<Mutex<HashMap<String, AudioChannel>>>;

pub fn default_channels() -> HashMap<String, AudioChannel> {
    let mut m = HashMap::new();
    m.insert("desktop".into(), AudioChannel::new("Desktop", -18.0, 0.0));
    m.insert("mic".into(),     AudioChannel::new("Mic/Aux", -35.0, 1.2));
    m.insert("browser".into(), AudioChannel::new("Browser", -22.0, 2.4));
    m.insert("music".into(),   AudioChannel::new("Music",   -12.0, 3.6));
    m
}

pub fn spawn_audio_thread(
    app:      AppHandle,
    channels: AudioChannels,
    running:  Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        let interval = std::time::Duration::from_millis(METER_INTERVAL_MS);
        while running.load(Ordering::Relaxed) {
            let t = std::time::Instant::now();

            let levels: Vec<ChannelLevelEvent> = {
                let mut guard = channels.lock().unwrap();
                CHANNEL_ORDER.iter().filter_map(|id| {
                    let ch = guard.get_mut(*id)?;
                    let (peak_l, peak_r, rms_l, rms_r) = ch.tick();
                    Some(ChannelLevelEvent { id: id.to_string(), peak_l, peak_r, rms_l, rms_r })
                }).collect()
            };

            let _ = app.emit(AUDIO_LEVELS_EVENT, levels);

            let elapsed = t.elapsed();
            if elapsed < interval {
                std::thread::sleep(interval - elapsed);
            }
        }
    });
}
