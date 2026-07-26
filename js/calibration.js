/**
 * Calibration bench — one CSV row per track for the week-one gate.
 * Question: do the numbers separate records that sound different?
 */

const CSV_HEADER = [
  "filename",
  "sample_rate",
  "duration_sec",
  "frames",
  "centroid_hz",
  "air",
  "sibilance",
  "harshness",
  "mud",
  "peak_db",
  "rms_db",
  "crest_db",
  "range_db",
  "corr",
  "side_mid",
  ...["sub", "bass", "low_mid", "mid", "presence", "brilliance", "air_band", "top"].map(
    (id) => `band_${id}`
  ),
].join(",");

function esc(value) {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function readoutToCsvRow(sourceName, readout) {
  const bandMap = Object.fromEntries(readout.bands.map((b) => [b.id, b.dbRelTotal]));
  const cells = [
    sourceName,
    readout.sampleRate,
    readout.durationSec.toFixed(3),
    readout.frames,
    readout.centroidHz.toFixed(2),
    readout.tone.air.toFixed(3),
    readout.tone.sibilance.toFixed(3),
    readout.tone.harshness.toFixed(3),
    readout.tone.mud.toFixed(3),
    readout.dynamics.peakDb.toFixed(3),
    readout.dynamics.rmsDb.toFixed(3),
    readout.dynamics.crestDb.toFixed(3),
    readout.dynamics.shortTermRangeDb.toFixed(3),
    readout.stereo.correlation.toFixed(4),
    readout.stereo.sideMidRatio.toFixed(4),
    bandMap.sub?.toFixed(3) ?? "",
    bandMap.bass?.toFixed(3) ?? "",
    bandMap.low_mid?.toFixed(3) ?? "",
    bandMap.mid?.toFixed(3) ?? "",
    bandMap.presence?.toFixed(3) ?? "",
    bandMap.brilliance?.toFixed(3) ?? "",
    bandMap.air?.toFixed(3) ?? "",
    bandMap.top?.toFixed(3) ?? "",
  ];
  return cells.map(esc).join(",");
}

export function buildCsv(rows) {
  return [CSV_HEADER, ...rows].join("\n") + "\n";
}

export function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export { CSV_HEADER };
