import { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { base64ToFloat32, float32ToInt16Base64 } from '../lib/audio-utils';

interface UseLiveSessionProps {
  systemInstruction: string;
  voiceName: string;
  onTranscription?: (text: string, isModel: boolean) => void;
  onStatusChange?: (status: string) => void;
}

// Shared single playback context per session instance (24kHz for Gemini output)
function createPlaybackContext() {
  return new AudioContext({ sampleRate: 24000 });
}

export function useLiveSession({
  systemInstruction,
  voiceName,
  onTranscription,
  onStatusChange,
}: UseLiveSessionProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sessionRef = useRef<any>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const playbackContextRef = useRef<AudioContext | null>(null);

  const setStatus = (msg: string) => {
    console.log(`[LiveSession:${voiceName}]`, msg);
    onStatusChange?.(msg);
  };

  const stopSession = useCallback(() => {
    setStatus('Stopping session...');
    try { sessionRef.current?.close(); } catch (_) { }
    sessionRef.current = null;

    try { playbackContextRef.current?.close(); } catch (_) { }
    playbackContextRef.current = null;

    audioQueueRef.current = [];
    isPlayingRef.current = false;

    setIsConnected(false);
    setIsConnecting(false);
    setStatus('Session stopped.');
  }, [voiceName]);

  const playNextChunk = useCallback(() => {
    const ctx = playbackContextRef.current;
    if (!ctx || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }

    isPlayingRef.current = true;
    const chunk = audioQueueRef.current.shift()!;
    const buffer = ctx.createBuffer(1, chunk.length, 24000);
    buffer.getChannelData(0).set(chunk);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => playNextChunk();
    source.start();
  }, []);

  /**
   * Called externally by App.tsx with raw Float32 audio when this session's
   * role is "active" (i.e. the mic is assigned to this speaker).
   */
  const sendAudio = useCallback((inputData: Float32Array) => {
    if (!sessionRef.current) return;
    const base64Data = float32ToInt16Base64(inputData);
    try {
      sessionRef.current.sendRealtimeInput({
        audio: { mimeType: 'audio/pcm;rate=16000', data: base64Data },
      });
    } catch (err) {
      console.error(`[LiveSession:${voiceName}] sendRealtimeInput error:`, err);
    }
  }, [voiceName]);

  const connect = useCallback(async () => {
    if (isConnecting || isConnected) return;

    setErrorMessage(null);
    setIsConnecting(true);
    setStatus('Connecting to Gemini Live API...');

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY is not set. Check your .env file.');
      setStatus(`Using API key: ${apiKey.substring(0, 8)}...`);

      const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1beta' } });
      playbackContextRef.current = createPlaybackContext();

      setStatus('Opening WebSocket...');

      const session = await ai.live.connect({
        model: 'gemini-3.1-flash-live-preview',
        callbacks: {
          onopen: () => {
            setStatus('WebSocket OPEN — session connected!');
            setIsConnected(true);
            setIsConnecting(false);
          },
          onmessage: async (message: any) => {
            try {
              const sc = message.serverContent;
              if (!sc) return;

              // ── Audio response from Gemini ──────────────────────────────
              const parts = sc.modelTurn?.parts ?? [];
              for (const part of parts) {
                if (part.inlineData?.data) {
                  const float32Data = base64ToFloat32(part.inlineData.data);
                  audioQueueRef.current.push(float32Data);
                  if (!isPlayingRef.current) playNextChunk();
                }
                if (part.text && onTranscription) {
                  onTranscription(part.text, true);
                }
              }

              // ── Input transcription (speaker's words) ───────────────────
              // The SDK sends this under inputTranscription.text in the response
              // (enabled via inputAudioTranscription:{} in the config)
              const inputText =
                sc.inputTranscription?.text ??
                sc.inputAudioTranscription?.text ??
                sc.inputAudioTranscription?.transcription;
              if (inputText) {
                console.log(`[LiveSession:${voiceName}] INPUT:`, inputText);
                onTranscription?.(inputText, false);
              }

              // ── Output transcription (AI's translation) ─────────────────
              const outputText =
                sc.outputTranscription?.text ??
                sc.outputAudioTranscription?.text ??
                sc.outputAudioTranscription?.transcription;
              if (outputText) {
                console.log(`[LiveSession:${voiceName}] OUTPUT:`, outputText);
                onTranscription?.(outputText, true);
              }

              // Debug: log keys present (safe, no stringify of audio blobs)
              console.log(`[LiveSession:${voiceName}] sc keys:`, Object.keys(sc));

            } catch (err) {
              console.error(`[LiveSession:${voiceName}] onmessage error:`, err);
            }
          },
          onclose: (evt: any) => {
            setStatus(`WebSocket CLOSED: code=${evt?.code} reason=${evt?.reason}`);
            stopSession();
          },
          onerror: (err: any) => {
            const msg = err?.message ?? JSON.stringify(err);
            setStatus(`WebSocket ERROR: ${msg}`);
            setErrorMessage(msg);
            stopSession();
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
          systemInstruction: { parts: [{ text: systemInstruction }] },
          // @ts-ignore
          inputAudioTranscription: {},
          // @ts-ignore
          outputAudioTranscription: {},
        },
      });

      sessionRef.current = session;
      setStatus('Session object created, waiting for onopen...');
    } catch (error: any) {
      const msg = error?.message ?? String(error);
      console.error(`[LiveSession:${voiceName}] Connection failed:`, error);
      setErrorMessage(msg);
      setStatus(`Connection FAILED: ${msg}`);
      setIsConnecting(false);
    }
  }, [isConnecting, isConnected, systemInstruction, voiceName, onTranscription, stopSession, playNextChunk]);

  useEffect(() => {
    return () => stopSession();
  }, [stopSession]);

  return {
    isConnected,
    isConnecting,
    errorMessage,
    connect,
    stopSession,
    sendAudio,
  };
}
