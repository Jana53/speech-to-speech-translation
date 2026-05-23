/**
 * Audio processing utilities for the Gemini Multimodal Live API.
 */

/**
 * Converts Float32Array PCM data to Base64-encoded Int16 PCM data.
 */
export function float32ToInt16Base64(float32Array: Float32Array): string {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  const buffer = int16Array.buffer;
  const binary = new Uint8Array(buffer);
  let binaryString = '';
  for (let i = 0; i < binary.byteLength; i++) {
    binaryString += String.fromCharCode(binary[i]);
  }
  return btoa(binaryString);
}

/**
 * Decodes a Base64-encoded Int16 PCM string back to Float32Array.
 */
export function base64ToFloat32(base64: string): Float32Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const int16Array = new Int16Array(bytes.buffer);
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }
  return float32Array;
}
