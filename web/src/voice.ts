// iOS-вебвью не играет OGG/Opus: декодируем в WAV в браузере (WASM, ленивый import).
export async function decodeOpusToWav(ogg: Uint8Array): Promise<ArrayBuffer> {
  const { OggOpusDecoder } = await import('ogg-opus-decoder');
  const dec = new OggOpusDecoder();
  try {
    await dec.ready;
    const { channelData, samplesDecoded, sampleRate } = await dec.decodeFile(ogg);
    if (!samplesDecoded || channelData.length === 0) throw new Error('empty opus');
    return encodeWav(channelData, sampleRate, samplesDecoded);
  } finally {
    dec.free();
  }
}

function encodeWav(channels: Float32Array[], sampleRate: number, frames: number): ArrayBuffer {
  const numCh = channels.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataLen = frames * blockAlign;
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i] ?? 0));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return buf;
}
