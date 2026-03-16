/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { GoogleGenAI, ThinkingLevel, Modality } from "@google/genai";
import { Upload, FileImage, Loader2, BarChart3, Info, Lightbulb, HelpCircle, X, Send, MessageSquare, Volume2, Square } from 'lucide-react';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'model', text: string }[]>([]);
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [isResponding, setIsResponding] = useState(false);
  const [isNarrating, setIsNarrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (PNG, JPG, etc.)');
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      setImage(e.target?.result as string);
      setAnalysis(null);
    };
    reader.readAsDataURL(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const analyzeChart = async () => {
    if (!image) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const base64Data = image.split(',')[1];
      
      const prompt = `
        You are a data analyst AI that explains charts to non-experts.
        Analyze this chart and provide:
        1. Identification of the chart type and variables.
        2. A simple explanation of the overall trend.
        3. 3 key insights.
        4. Any anomalies or surprising values.
        5. 2 suggested questions for the user to ask about this data.
        
        Use clear, conversational language. Format the output with Markdown headers and bullet points.
      `;

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/png",
                  data: base64Data
                }
              }
            ]
          }
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
        }
      });

      const text = result.text || "Could not generate analysis.";
      setAnalysis(text);
      setChatHistory([{ role: 'model', text }]);
    } catch (err) {
      console.error("Analysis error:", err);
      setError("Failed to analyze the image. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUpQuestion.trim() || !image || isResponding) return;

    const question = followUpQuestion;
    setFollowUpQuestion('');
    setChatHistory(prev => [...prev, { role: 'user', text: question }]);
    setIsResponding(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const base64Data = image.split(',')[1];

      // We include the image and the history for context
      const contents = [
        {
          role: 'user',
          parts: [
            { text: "Here is the chart we are discussing." },
            { inlineData: { mimeType: "image/png", data: base64Data } }
          ]
        },
        ...chatHistory.map(msg => ({
          role: msg.role,
          parts: [{ text: msg.text }]
        })),
        {
          role: 'user',
          parts: [{ text: question }]
        }
      ];

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
        }
      });

      const responseText = result.text || "I'm sorry, I couldn't process that question.";
      setChatHistory(prev => [...prev, { role: 'model', text: responseText }]);
    } catch (err) {
      console.error("Follow-up error:", err);
      setError("Failed to get a response. Please try again.");
    } finally {
      setIsResponding(false);
    }
  };

  const stopNarration = () => {
    setIsNarrating(false);
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    nextStartTimeRef.current = 0;
  };

  const startNarration = async () => {
    if (!analysis || isNarrating) return;

    setIsNarrating(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // Initialize Audio Context
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
      nextStartTimeRef.current = audioContextRef.current.currentTime;

      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        callbacks: {
          onopen: () => {
            sessionPromise.then((session) => {
              session.sendRealtimeInput({
                text: `Please narrate the following chart analysis in a professional and engaging voice. Keep it conversational but clear. Here is the analysis: ${analysis}`
              });
            });
          },
          onmessage: async (message) => {
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && audioContextRef.current) {
              const binaryString = atob(base64Audio);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              
              // Convert PCM16 to Float32
              const pcm16 = new Int16Array(bytes.buffer);
              const float32 = new Float32Array(pcm16.length);
              for (let i = 0; i < pcm16.length; i++) {
                float32[i] = pcm16[i] / 32768.0;
              }

              const audioBuffer = audioContextRef.current.createBuffer(1, float32.length, 24000);
              audioBuffer.getChannelData(0).set(float32);

              const source = audioContextRef.current.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(audioContextRef.current.destination);
              
              const startTime = Math.max(nextStartTimeRef.current, audioContextRef.current.currentTime);
              source.start(startTime);
              nextStartTimeRef.current = startTime + audioBuffer.duration;
            }

            if (message.serverContent?.turnComplete) {
              // We don't stop immediately to allow buffer to finish
              setTimeout(() => {
                if (isNarrating) setIsNarrating(false);
              }, 2000);
            }
          },
          onclose: () => setIsNarrating(false),
          onerror: (err) => {
            console.error("Live API error:", err);
            setError("Voice narration failed.");
            setIsNarrating(false);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: "You are a professional data analyst narrating a report.",
        },
      });

    } catch (err) {
      console.error("Narration setup error:", err);
      setError("Could not start voice narration.");
      setIsNarrating(false);
    }
  };

  const reset = () => {
    setImage(null);
    setAnalysis(null);
    setChatHistory([]);
    setFollowUpQuestion('');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#fbfbf9] text-[#1a1a1a] font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="border-b border-black/5 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
              <BarChart3 size={18} />
            </div>
            <h1 className="font-semibold tracking-tight text-lg">Chart Explainer</h1>
          </div>
          <button 
            onClick={reset}
            className="text-sm font-medium text-gray-500 hover:text-black transition-colors"
          >
            New Analysis
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          
          {/* Left Column: Upload & Preview */}
          <div className="lg:col-span-5 space-y-6">
            <div className="space-y-2">
              <h2 className="text-3xl font-serif italic font-medium tracking-tight">Visualize Clarity.</h2>
              <p className="text-gray-500 leading-relaxed">
                Upload any chart, graph, or data screenshot. Our AI will break down the complexity into human insights.
              </p>
            </div>

            {!image ? (
              <div 
                onDragOver={onDragOver}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className="aspect-[4/5] border-2 border-dashed border-gray-200 rounded-3xl flex flex-col items-center justify-center gap-4 bg-white hover:border-emerald-500 hover:bg-emerald-50/30 transition-all cursor-pointer group"
              >
                <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-emerald-100 group-hover:text-emerald-600 transition-colors">
                  <Upload size={24} />
                </div>
                <div className="text-center">
                  <p className="font-medium">Drop your chart here</p>
                  <p className="text-sm text-gray-400">or click to browse</p>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  className="hidden" 
                  accept="image/*"
                />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative aspect-auto rounded-3xl overflow-hidden bg-white shadow-xl shadow-black/5 border border-black/5">
                  <img 
                    src={image} 
                    alt="Uploaded chart" 
                    className="w-full h-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                  <button 
                    onClick={reset}
                    className="absolute top-4 right-4 w-8 h-8 bg-black/50 backdrop-blur-md text-white rounded-full flex items-center justify-center hover:bg-black transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
                
                {!analysis && (
                  <button
                    onClick={analyzeChart}
                    disabled={isAnalyzing}
                    className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="animate-spin" size={20} />
                        Analyzing Data...
                      </>
                    ) : (
                      <>
                        Analyze Chart
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-medium border border-red-100">
                {error}
              </div>
            )}
          </div>

          {/* Right Column: Analysis Output */}
          <div className="lg:col-span-7">
            {isAnalyzing ? (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center space-y-4 bg-white rounded-3xl border border-black/5 p-12">
                <div className="relative">
                  <div className="w-16 h-16 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <BarChart3 size={20} className="text-emerald-600" />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="font-medium text-lg">Processing Visuals</p>
                  <p className="text-gray-400 text-sm">Identifying trends and extracting key data points...</p>
                </div>
              </div>
            ) : chatHistory.length > 0 ? (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="bg-white rounded-3xl border border-black/5 p-8 lg:p-12 shadow-sm space-y-8">
                  <div className="flex items-center gap-3 text-emerald-600 border-b border-black/5 pb-4">
                    <Lightbulb size={24} />
                    <h3 className="text-xl font-semibold">Analysis & Conversation</h3>
                    <div className="ml-auto flex gap-2">
                      {isNarrating ? (
                        <button 
                          onClick={stopNarration}
                          className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl text-sm font-medium hover:bg-red-100 transition-colors"
                        >
                          <Square size={14} fill="currentColor" />
                          Stop Narration
                        </button>
                      ) : (
                        <button 
                          onClick={startNarration}
                          className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-sm font-medium hover:bg-emerald-100 transition-colors"
                        >
                          <Volume2 size={14} />
                          Listen to Analysis
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <div className="space-y-8">
                    {chatHistory.map((msg, idx) => (
                      <div 
                        key={idx} 
                        className={cn(
                          "flex flex-col gap-2",
                          msg.role === 'user' ? "items-end" : "items-start"
                        )}
                      >
                        <div className={cn(
                          "max-w-[90%] rounded-2xl p-4 lg:p-6",
                          msg.role === 'user' 
                            ? "bg-emerald-50 text-emerald-900 rounded-tr-none" 
                            : "bg-gray-50 text-gray-900 rounded-tl-none border border-black/5"
                        )}>
                          <div className="prose prose-slate max-w-none prose-headings:font-serif prose-headings:italic prose-headings:font-medium prose-p:leading-relaxed prose-li:marker:text-emerald-500">
                            <Markdown>{msg.text}</Markdown>
                          </div>
                        </div>
                        <span className="text-[10px] uppercase tracking-widest text-gray-400 font-medium px-2">
                          {msg.role === 'user' ? 'You' : 'Analyst'}
                        </span>
                      </div>
                    ))}

                    {isResponding && (
                      <div className="flex flex-col gap-2 items-start animate-pulse">
                        <div className="bg-gray-50 rounded-2xl rounded-tl-none border border-black/5 p-4 lg:p-6 flex items-center gap-3">
                          <Loader2 className="animate-spin text-emerald-600" size={18} />
                          <span className="text-sm text-gray-500 font-medium italic">Thinking...</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Follow-up Input */}
                <form 
                  onSubmit={handleFollowUp}
                  className="relative group"
                >
                  <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none text-gray-400 group-focus-within:text-emerald-500 transition-colors">
                    <MessageSquare size={18} />
                  </div>
                  <input
                    type="text"
                    value={followUpQuestion}
                    onChange={(e) => setFollowUpQuestion(e.target.value)}
                    placeholder="Ask a follow-up question about this chart..."
                    disabled={isResponding}
                    className="w-full bg-white border border-black/5 rounded-2xl py-4 pl-12 pr-16 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!followUpQuestion.trim() || isResponding}
                    className="absolute right-2 top-2 bottom-2 px-4 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-0 disabled:scale-90 transition-all duration-300 flex items-center justify-center"
                  >
                    <Send size={18} />
                  </button>
                </form>

                <div className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-gray-400">
                  <Info size={14} />
                  Reasoning enabled (ThinkingLevel.HIGH)
                </div>
              </div>
            ) : (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center space-y-6 bg-gray-50/50 rounded-3xl border border-dashed border-gray-200 p-12">
                <div className="w-20 h-20 bg-white rounded-2xl shadow-sm flex items-center justify-center text-gray-300">
                  <HelpCircle size={40} />
                </div>
                <div className="max-w-xs space-y-2">
                  <p className="font-medium text-gray-600">Ready for Analysis</p>
                  <p className="text-gray-400 text-sm">Upload a chart on the left to see the AI's detailed breakdown here.</p>
                </div>
              </div>
            )}
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-6 py-12 border-t border-black/5">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 opacity-40 grayscale">
            <BarChart3 size={16} />
            <span className="text-xs font-mono uppercase tracking-widest">Chart Explainer v1.0</span>
          </div>
          <div className="flex gap-8">
            <a href="#" className="text-xs font-medium text-gray-400 hover:text-black transition-colors uppercase tracking-wider">Documentation</a>
            <a href="#" className="text-xs font-medium text-gray-400 hover:text-black transition-colors uppercase tracking-wider">Privacy</a>
            <a href="#" className="text-xs font-medium text-gray-400 hover:text-black transition-colors uppercase tracking-wider">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
