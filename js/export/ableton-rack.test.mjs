/**
 * Smoke-test Ableton .adg assembly (no Live install required).
 * Run: node --test js/export/ableton-rack.test.mjs
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAbletonRack } from "./ableton-rack.js";

async function gunzip(bytes) {
  const ds = new DecompressionStream("gzip");
  return new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
}

test("ADG with delay loads as clean Live 11 gzip XML", async () => {
  const { blob, included } = await buildAbletonRack(
    {
      inserts: [
        { title: "Gain", visual: { kind: "gain" } },
        {
          title: "Slap delay",
          visual: { kind: "delay", time: "1/8", feedbackPct: 18 },
        },
        { title: "Room", visual: { kind: "reverb", size: "room" } },
      ],
      sends: [],
    },
    { name: "Test Chain" }
  );

  assert.ok(included.some((s) => /delay/i.test(s)));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(bytes[0], 0x1f);
  assert.equal(bytes[1], 0x8b);

  const xml = await gunzip(bytes);
  assert.match(xml, /<GroupDevicePreset>/);
  assert.match(xml, /<CrossDelay /);
  assert.equal((xml.match(/RelativePathElement/g) || []).length, 0);
  assert.equal((xml.match(/OverwriteProtectionNumber Value="2560"/g) || []).length, 0);
  assert.equal((xml.match(/FilePresetRef/g) || []).length, 0);
  assert.doesNotMatch(xml, /\/Users\//);
  assert.doesNotMatch(xml, /Dotted Eighth Note/);
  assert.doesNotMatch(xml, /<\/Device>\s*<PresetRef>\s*<Value>/);
});

test("ADG without delay still includes Utility", async () => {
  const { blob, included } = await buildAbletonRack({
    inserts: [{ title: "Comp", visual: { kind: "compressor", ratio: 3, attackMs: 10, releaseMs: 80 } }],
    sends: [],
  });
  assert.ok(included.length >= 1);
  const xml = await gunzip(new Uint8Array(await blob.arrayBuffer()));
  assert.match(xml, /<StereoGain |<Compressor2 /);
});
