use std::sync::{Arc, atomic::AtomicBool};
use crate::db::Db;
use crate::audio::AudioChannels;
use crate::output::OutputState;

pub struct AppState {
    pub db:              Db,
    pub preview_running: Arc<AtomicBool>,
    pub audio_channels:  AudioChannels,
    pub audio_running:   Arc<AtomicBool>,
    pub output:          OutputState,
}
