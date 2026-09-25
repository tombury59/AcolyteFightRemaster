import * as r from './audio.model';

// NOTE (remaster): the original offline audio pre-buffering ran in an iframe
// worker (audioWorker.html + /dist/audioWorker.js, webpack multi-entry build).
// That is stubbed out for now — the game falls back to real-time synthesis.
// TODO: reimplement as a proper Vite module worker if offline buffering is wanted.

export function init(): Promise<void> {
    return Promise.resolve();
}

export async function isBufferingAvailable(): Promise<boolean> {
    return false;
}

export async function bufferSoundBite(_bite: SoundBite, _ctx: BaseAudioContext): Promise<AudioBuffer> {
    return null;
}

// Keep the module import used so the audio message types stay referenced.
export type Message = r.Message;
