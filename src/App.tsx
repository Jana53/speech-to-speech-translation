/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PhoneOff, Phone, Languages, Mic, User, Building2, ArrowLeftRight, Zap } from 'lucide-react';
import { useLiveSession } from './hooks/useLiveSession';

const LANGUAGES = [
  { code: 'en-US', name: 'English', flag: '🇺🇸' },
  { code: 'es-ES', name: 'Spanish', flag: '🇪🇸' },
  { code: 'hi-IN', name: 'Hindi', flag: '🇮🇳' },
  { code: 'fr-FR', name: 'French', flag: '🇫🇷' },
  { code: 'de-DE', name: 'German', flag: '🇩🇪' },
  { code: 'zh-CN', name: 'Chinese', flag: '🇨🇳' },
  { code: 'ar-SA', name: 'Arabic', flag: '🇸🇦' },
  { code: 'pt-BR', name: 'Portuguese', flag: '🇧🇷' },
  { code: 'ja-JP', name: 'Japanese', flag: '🇯🇵' },
];

// Gemini voices: Aoede / Leda / Zephyr = feminine; Charon / Fenrir / Orus = masculine
// Voice matches the ORIGINAL SPEAKER's gender (not the listener)
const CUSTOMER_VOICE = 'Aoede';   // female — customer is female, her translated voice stays female
const BANKER_VOICE = 'Charon';    // male   — banker is male, his translated voice stays male

type Role = 'caller' | 'banker';
type Transcript = { text: string; role: Role; id: number };

const CUSTOMER_NAME = 'Customer';
const BANKER_NAME = 'Banker';

export default function App() {
  const [callerLang, setCallerLang] = useState(LANGUAGES[2]); // Hindi
  const [bankerLang, setBankerLang] = useState(LANGUAGES[0]); // English
  const [activeRole, setActiveRole] = useState<Role>('caller');
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>('Ready to connect');
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Shared microphone state
  const micStreamRef = useRef<MediaStream | null>(null);
  const recordingCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // Keep activeRole accessible inside the audio processor closure
  const activeRoleRef = useRef<Role>('caller');
  useEffect(() => { activeRoleRef.current = activeRole; }, [activeRole]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  // ── System instructions ──────────────────────────────────────────────────

  // Customer session: hears Bhavya (callerLang), outputs in bankerLang via female voice
  const customerSystemInstruction = `
You are a real-time live interpreter at a bank branch.
The CUSTOMER is named ${CUSTOMER_NAME} and speaks ${callerLang.name}.
The BANKER is named ${BANKER_NAME} and speaks ${bankerLang.name}.
You are currently listening to ${CUSTOMER_NAME}.
Your ONLY job: instantly translate everything ${CUSTOMER_NAME} says into ${bankerLang.name} and speak it aloud in a natural, conversational tone — as if you are ${CUSTOMER_NAME}'s voice in ${bankerLang.name}.
Rules:
- Translate faithfully. No commentary, no additions, no explanations.
- Preserve tone, intent and all banking terms (IBAN, SWIFT, account numbers, interest rates) exactly as spoken.
- Be ultra-low latency — begin speaking as soon as you understand the phrase.
- If ${CUSTOMER_NAME} uses a banking term in English within her ${callerLang.name} speech, keep it in English.
  `.trim();

  // Banker session: hears Janardhan (bankerLang), outputs in callerLang via male voice
  const bankerSystemInstruction = `
You are a real-time live interpreter at a bank branch.
The BANKER is named ${BANKER_NAME} and speaks ${bankerLang.name}.
The CUSTOMER is named ${CUSTOMER_NAME} and speaks ${callerLang.name}.
You are currently listening to ${BANKER_NAME}.
Your ONLY job: instantly translate everything ${BANKER_NAME} says into ${callerLang.name} and speak it aloud in a natural, conversational tone — as if you are ${BANKER_NAME}'s voice in ${callerLang.name}.
Rules:
- Translate faithfully. No commentary, no additions, no explanations.
- Preserve tone, intent and all banking terms (IBAN, SWIFT, account numbers, interest rates) exactly as spoken.
- Be ultra-low latency — begin speaking as soon as you understand the phrase.
- If ${BANKER_NAME} uses a banking term, keep it as-is in the translation.
  `.trim();

  // ── Transcription handlers ───────────────────────────────────────────────

  const handleCustomerTranscription = useCallback((text: string, isModel: boolean) => {
    if (!text.trim()) return;
    // When isModel=true, it's the banker-voice translation; role = 'banker' side display
    setTranscripts(prev => [
      ...prev.slice(-20),
      { text, role: isModel ? 'banker' : 'caller', id: Date.now() },
    ]);
  }, []);

  const handleBankerTranscription = useCallback((text: string, isModel: boolean) => {
    if (!text.trim()) return;
    setTranscripts(prev => [
      ...prev.slice(-20),
      { text, role: isModel ? 'caller' : 'banker', id: Date.now() },
    ]);
  }, []);

  // ── Two sessions ─────────────────────────────────────────────────────────

  const customerSession = useLiveSession({
    systemInstruction: customerSystemInstruction,
    voiceName: CUSTOMER_VOICE,        // female (Aoede) — customer's words translated in her voice
    onTranscription: handleCustomerTranscription,
    onStatusChange: setStatusMessage,
  });

  const bankerSession = useLiveSession({
    systemInstruction: bankerSystemInstruction,
    voiceName: BANKER_VOICE,          // male (Charon) — banker's words translated in his voice
    onTranscription: handleBankerTranscription,
    onStatusChange: setStatusMessage,
  });

  const isConnected = customerSession.isConnected && bankerSession.isConnected;
  const isConnecting = customerSession.isConnecting || bankerSession.isConnecting;
  const errorMessage = customerSession.errorMessage || bankerSession.errorMessage;

  // ── Shared microphone ────────────────────────────────────────────────────

  const startMicrophone = useCallback(async () => {
    if (micStreamRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    micStreamRef.current = stream;

    const ctx = new AudioContext({ sampleRate: 16000 });
    recordingCtxRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      const role = activeRoleRef.current;
      if (role === 'caller') {
        customerSession.sendAudio(data);
      } else {
        bankerSession.sendAudio(data);
      }
    };

    source.connect(processor);
    processor.connect(ctx.destination);
    processorRef.current = processor;
  }, [customerSession, bankerSession]);

  const stopMicrophone = useCallback(() => {
    try { processorRef.current?.disconnect(); } catch (_) { }
    processorRef.current = null;
    try { recordingCtxRef.current?.close(); } catch (_) { }
    recordingCtxRef.current = null;
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
  }, []);

  // ── Session lifecycle ────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    await Promise.all([customerSession.connect(), bankerSession.connect()]);
    await startMicrophone();
  }, [customerSession, bankerSession, startMicrophone]);

  const stopSession = useCallback(() => {
    stopMicrophone();
    customerSession.stopSession();
    bankerSession.stopSession();
    setTranscripts([]);
  }, [customerSession, bankerSession, stopMicrophone]);

  // Start mic once both sessions are open
  useEffect(() => {
    if (customerSession.isConnected && bankerSession.isConnected) {
      startMicrophone();
    }
  }, [customerSession.isConnected, bankerSession.isConnected, startMicrophone]);

  // ── UI helpers ───────────────────────────────────────────────────────────

  const swapLanguages = () => {
    if (isConnected) return;
    setCallerLang(bankerLang);
    setBankerLang(callerLang);
  };

  const callerTranscripts = transcripts.filter(t => t.role === 'caller');
  const bankerTranscripts = transcripts.filter(t => t.role === 'banker');

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }} className="min-h-screen bg-slate-50 text-slate-900 overflow-hidden selection:bg-blue-200">
      <div className="relative z-10 flex flex-col h-screen max-w-7xl mx-auto px-6 py-5">

        {/* ── HEADER ── */}
        <header className="flex items-center justify-between mb-6 bg-white py-3 px-5 rounded-2xl shadow-sm border border-slate-200 shrink-0">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-10 h-10 rounded-xl bg-blue-900 flex items-center justify-center shadow-md">
                <Languages className="w-5 h-5 text-white" />
              </div>
              {isConnected && (
                <motion.div
                  animate={{ scale: [1, 1.3, 1], opacity: [0.8, 0.2, 0.8] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white"
                />
              )}
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight leading-none">Branch Translation Assistant</h1>
              <p className="text-xs text-slate-500 mt-1 font-medium">Real-Time · Gender-Adaptive Voices</p>
            </div>
          </div>

          {/* Voice badges */}
          <div className="flex items-center gap-3">
            <span className="text-[11px] px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-bold">
              👩 {CUSTOMER_NAME} → <span className="font-mono">{CUSTOMER_VOICE}</span>
            </span>
            <span className="text-[11px] px-3 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-700 font-bold">
              👨 {BANKER_NAME} → <span className="font-mono">{BANKER_VOICE}</span>
            </span>
          </div>

          <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-wider border transition-all duration-500 ${isConnected
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : isConnecting
              ? 'bg-amber-50 border-amber-200 text-amber-700'
              : errorMessage
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-slate-100 border-slate-200 text-slate-600'
            }`}>
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' :
              isConnecting ? 'bg-amber-500 animate-pulse' :
                errorMessage ? 'bg-red-500' : 'bg-slate-400'
              }`} />
            {isConnected ? 'Interpreter Active' : isConnecting ? 'Connecting…' : errorMessage ? 'System Error' : 'Standby Mode'}
          </div>
        </header>

        {/* ── MAIN LAYOUT ── */}
        <main className="flex-1 grid grid-cols-[1fr_220px_1fr] gap-6 min-h-0">

          {/* ── CUSTOMER PANEL ── */}
          <div className={`flex flex-col h-full rounded-2xl border bg-white overflow-hidden transition-all duration-500 shadow-sm ${activeRole === 'caller' && isConnected
            ? 'border-blue-500 ring-1 ring-blue-500 shadow-blue-900/5'
            : 'border-slate-200'
            }`}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${activeRole === 'caller' && isConnected
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-slate-100 text-slate-500'
                  }`}>
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Customer</p>
                  <p className="text-sm font-bold text-slate-900 mt-0.5">{CUSTOMER_NAME} · {callerLang.flag} {callerLang.name}</p>
                  <p className="text-[10px] text-blue-500 font-semibold mt-0.5">Voice: {CUSTOMER_VOICE} (female)</p>
                </div>
              </div>
              {activeRole === 'caller' && isConnected && (
                <motion.div className="flex gap-1 items-end h-5">
                  {[...Array(5)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{ height: ['30%', '100%', '50%', '80%', '30%'] }}
                      transition={{ duration: 0.4 + i * 0.1, repeat: Infinity, delay: i * 0.07 }}
                      className="w-1.5 bg-blue-500 rounded-full"
                    />
                  ))}
                </motion.div>
              )}
            </div>

            <div className="px-5 py-3 border-b border-slate-100 bg-white">
              <select
                value={callerLang.code}
                onChange={e => setCallerLang(LANGUAGES.find(l => l.code === e.target.value)!)}
                disabled={isConnected}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
              </select>
            </div>

            <div className="flex-1 p-5 overflow-y-auto space-y-3 min-h-0 bg-slate-50/30">
              <AnimatePresence initial={false}>
                {callerTranscripts.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-3 opacity-40">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
                      <Mic className="w-6 h-6 text-slate-400" />
                    </div>
                    <p className="text-sm text-slate-500 max-w-[200px]">Customer speech and translations will appear here.</p>
                  </div>
                ) : callerTranscripts.map(t => (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, y: 8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    className="p-4 rounded-xl rounded-tl-sm bg-blue-50 border border-blue-100 text-sm text-slate-800 leading-relaxed shadow-sm"
                  >
                    {t.text}
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={transcriptEndRef} />
            </div>

            <div className="p-4 border-t border-slate-100 bg-white shrink-0">
              <button
                onClick={() => setActiveRole('caller')}
                disabled={!isConnected}
                className={`w-full h-[52px] rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2 ${activeRole === 'caller'
                  ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20'
                  : 'bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-slate-50'
                  }`}
              >
                <Mic className={`w-4 h-4 ${activeRole === 'caller' && isConnected ? 'animate-pulse' : ''}`} />
                {activeRole === 'caller' && isConnected ? `${CUSTOMER_NAME} Speaking…` : `Tap to Speak — ${CUSTOMER_NAME}`}
              </button>
            </div>
          </div>

          {/* ── CENTER COLUMN ── */}
          <div className="flex flex-col items-center h-full w-full min-h-0">
            <div className="flex flex-col items-center gap-4 w-full shrink-0">
              <div className="w-full rounded-2xl border border-slate-200 bg-white p-5 flex flex-col items-center gap-4 shadow-sm">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm transition-all duration-300 ${isConnected ? 'bg-blue-900' : 'bg-slate-800'}`}>
                  <Languages className="w-6 h-6 text-white" />
                </div>

                <div className="text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">AI Interpreter</p>
                  <p className="text-sm font-bold text-slate-900 mt-1">Gemini Live</p>
                  <div className="flex items-center justify-center gap-1 mt-1.5">
                    <Zap className="w-3 h-3 text-amber-500" />
                    <span className="text-[10px] text-amber-600 font-bold uppercase tracking-wide">Dual-Voice</span>
                  </div>
                </div>

                <div className="flex gap-1 h-6 items-end mt-2">
                  {isConnected ? [...Array(8)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{ height: ['20%', '100%', '40%', '80%', '20%'] }}
                      transition={{ duration: 0.5 + i * 0.07, repeat: Infinity, delay: i * 0.08 }}
                      className="w-1.5 bg-blue-500 rounded-full"
                    />
                  )) : (
                    [...Array(8)].map((_, i) => (
                      <div key={i} className="w-1.5 h-1.5 bg-slate-200 rounded-full" />
                    ))
                  )}
                </div>

                <p className="text-[11px] font-medium text-slate-600 text-center leading-tight px-2 mt-2">
                  {errorMessage ? <span className="text-red-600">{errorMessage.substring(0, 55)}</span> : statusMessage}
                </p>
              </div>

              <div className="flex flex-col items-center gap-2 text-[11px] text-slate-500 font-bold uppercase tracking-widest my-1">
                <span>{callerLang.flag} {callerLang.name.slice(0, 4)}</span>
                <ArrowLeftRight className="w-5 h-5 text-slate-400" />
                <span>{bankerLang.flag} {bankerLang.name.slice(0, 4)}</span>
              </div>

              <button
                onClick={swapLanguages}
                disabled={isConnected}
                className="w-full py-2.5 px-3 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all disabled:opacity-40 shadow-sm flex items-center justify-center gap-2"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                Swap Languages
              </button>
            </div>

            <div className="flex-1 w-full flex flex-col justify-end min-h-[1rem] pb-4">
              <div className={`w-full rounded-xl bg-blue-50 border border-blue-100 p-3 text-center transition-all duration-300 ${isConnected ? 'opacity-100 visible' : 'opacity-0 invisible'}`}>
                <p className="text-[10px] text-blue-600 uppercase tracking-widest font-bold">Mic Active</p>
                <p className="text-xs font-bold text-blue-900 mt-1">
                  {activeRole === 'caller' ? `${callerLang.flag} ${CUSTOMER_NAME}` : `${bankerLang.flag} ${BANKER_NAME}`}
                </p>
              </div>
            </div>

            <div className="w-full shrink-0 pb-4">
              <button
                id="session-toggle-btn"
                onClick={() => isConnected ? stopSession() : connect()}
                disabled={isConnecting}
                className={`w-full h-[52px] rounded-xl font-bold text-sm transition-all duration-200 flex items-center justify-center gap-2 shadow-sm ${isConnected
                  ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-600/20'
                  : 'bg-blue-900 hover:bg-blue-800 text-white shadow-blue-900/20'
                  } ${isConnecting ? 'opacity-70 cursor-wait' : ''}`}
              >
                {isConnecting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span className="text-xs font-semibold tracking-wide uppercase">Connecting…</span>
                  </>
                ) : isConnected ? (
                  <>
                    <PhoneOff className="w-5 h-5" />
                    <span className="text-xs font-semibold tracking-wide uppercase">End Session</span>
                  </>
                ) : (
                  <>
                    <Phone className="w-5 h-5" />
                    <span className="text-xs font-semibold tracking-wide uppercase">Start Session</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* ── BANKER PANEL ── */}
          <div className={`flex flex-col h-full rounded-2xl border bg-white overflow-hidden transition-all duration-500 shadow-sm ${activeRole === 'banker' && isConnected
            ? 'border-teal-500 ring-1 ring-teal-500 shadow-teal-900/5'
            : 'border-slate-200'
            }`}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${activeRole === 'banker' && isConnected
                  ? 'bg-teal-100 text-teal-700'
                  : 'bg-slate-100 text-slate-500'
                  }`}>
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Branch Banker</p>
                  <p className="text-sm font-bold text-slate-900 mt-0.5">{BANKER_NAME} · {bankerLang.flag} {bankerLang.name}</p>
                  <p className="text-[10px] text-teal-500 font-semibold mt-0.5">Voice: {BANKER_VOICE} (male)</p>
                </div>
              </div>
              {activeRole === 'banker' && isConnected && (
                <motion.div className="flex gap-1 items-end h-5">
                  {[...Array(5)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{ height: ['30%', '100%', '50%', '80%', '30%'] }}
                      transition={{ duration: 0.4 + i * 0.1, repeat: Infinity, delay: i * 0.07 }}
                      className="w-1.5 bg-teal-500 rounded-full"
                    />
                  ))}
                </motion.div>
              )}
            </div>

            <div className="px-5 py-3 border-b border-slate-100 bg-white">
              <select
                value={bankerLang.code}
                onChange={e => setBankerLang(LANGUAGES.find(l => l.code === e.target.value)!)}
                disabled={isConnected}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-700 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
              </select>
            </div>

            <div className="flex-1 p-5 overflow-y-auto space-y-3 min-h-0 bg-slate-50/30">
              <AnimatePresence initial={false}>
                {bankerTranscripts.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-3 opacity-40">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
                      <Mic className="w-6 h-6 text-slate-400" />
                    </div>
                    <p className="text-sm text-slate-500 max-w-[200px]">Banker speech and translations will appear here.</p>
                  </div>
                ) : bankerTranscripts.map(t => (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, y: 8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    className="p-4 rounded-xl rounded-tr-sm bg-teal-50 border border-teal-100 text-sm text-slate-800 leading-relaxed shadow-sm"
                  >
                    {t.text}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <div className="p-4 border-t border-slate-100 bg-white shrink-0">
              <button
                onClick={() => setActiveRole('banker')}
                disabled={!isConnected}
                className={`w-full h-[52px] rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2 ${activeRole === 'banker'
                  ? 'bg-teal-600 hover:bg-teal-700 text-white shadow-md shadow-teal-600/20'
                  : 'bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-slate-50'
                  }`}
              >
                <Mic className={`w-4 h-4 ${activeRole === 'banker' && isConnected ? 'animate-pulse' : ''}`} />
                {activeRole === 'banker' && isConnected ? `${BANKER_NAME} Speaking…` : `Tap to Speak — ${BANKER_NAME}`}
              </button>
            </div>
          </div>
        </main>

      </div>
    </div>
  );
}