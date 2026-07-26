/**
 * Decode local audio only — no chain/recommend deps (keeps Find lightweight).
 */

export async function decodeFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    return audioBuffer;
  } finally {
    await ctx.close().catch(() => {});
  }
}
