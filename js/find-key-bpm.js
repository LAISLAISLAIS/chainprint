/**
 * Lightweight key + BPM finder (no full vocal-chain analysis).
 */

import { decodeFile } from "./analyze.js";
import { resolveReferenceUrl } from "./source.js";
import { estimateTempo } from "./dsp/tempo.js";
import { estimatePitchProfile, relativeKey } from "./dsp/pitch.js";

function monoFromBuffer(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
  const mono = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) mono[i] = 0.5 * (left[i] + right[i]);
  return { mono, sampleRate, durationSec: audioBuffer.duration };
}

function parseKeyLabel(label) {
  if (!label) return null;
  const m = String(label).match(/^(.+?)\s+(major|minor)$/i);
  if (!m) return null;
  return { key: m[1], mode: m[2].toLowerCase(), label: `${m[1]} ${m[2].toLowerCase()}` };
}

function buildResult(tempo, pitch, meta = null) {
  // Finder always surfaces the best key guess; reliability is labeled in UI
  const key = pitch.key && pitch.mode
    ? { key: pitch.key, mode: pitch.mode, label: pitch.keyLabel }
    : parseKeyLabel(pitch.keyCandidates?.[0]?.label);

  const rel = pitch.relativeKey
    ? { label: pitch.relativeKey }
    : key
      ? relativeKey(key.key, key.mode)
      : null;

  return {
    bpm: tempo.bpm,
    bpmConfidence: tempo.confidence,
    bpmReliable: Boolean(tempo.reliable),
    bpmFeel: tempo.feel || null,
    key: key?.label || null,
    keyConfidence: pitch.keyConfidence,
    keyReliable: Boolean(pitch.keyReliable),
    relativeKey: rel?.label || null,
    runnerUp: pitch.keyRunnerUp || null,
    durationSec: null,
    meta,
    note: pitch.note || tempo.note || null,
  };
}

export async function findKeyBpmFromFile(file) {
  const buffer = await decodeFile(file);
  const { mono, sampleRate, durationSec } = monoFromBuffer(buffer);
  const tempo = estimateTempo(mono, sampleRate);
  const pitch = estimatePitchProfile(mono, sampleRate);
  const result = buildResult(tempo, pitch);
  result.durationSec = durationSec;
  result.sourceName = file.name;
  result.audioFile = file;
  return result;
}

export async function findKeyBpmFromUrl(raw, opts = {}) {
  const resolved = await resolveReferenceUrl(raw, { manualQuery: opts.manualQuery });
  const buffer = await decodeFile(resolved.file);
  const { mono, sampleRate, durationSec } = monoFromBuffer(buffer);
  const tempo = estimateTempo(mono, sampleRate);
  const pitch = estimatePitchProfile(mono, sampleRate);
  const result = buildResult(tempo, pitch, resolved.meta);
  result.durationSec = durationSec;
  result.audioFile = resolved.file;
  result.sourceName =
    resolved.meta?.matchedTitle ||
    resolved.meta?.title ||
    resolved.file?.name ||
    "Link";
  if (resolved.meta?.matchedArtist || resolved.meta?.artist) {
    result.sourceName = `${resolved.meta.matchedArtist || resolved.meta.artist} — ${result.sourceName}`;
  }
  return result;
}
