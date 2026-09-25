import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";

export interface LiveTelemetry {
  ttfaMs?: number;
  lastToolLatencyMs?: number;
  bargeInStopMs?: number;
  totalAudioChunksReceived?: number;
}

export class LiveAudioSession {
  private ai: GoogleGenAI;
  private sessionPromise: Promise<any> | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private nextPlayTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private animationFrameId: number = 0;

  // Latency & performance telemetry tracking
  private lastUserSpeechTimestamp: number = 0;
  private awaitingFirstAudio: boolean = false;
  private toolCallStartTime: number = 0;
  private totalAudioChunks: number = 0;

  constructor(
    private papersContext: string, 
    private onStatusChange: (status: string) => void,
    private onVolumeChange?: (volume: number) => void,
    private paperIds: string[] = [],
    private onToolCall?: (toolName: string, query: string, status: 'searching' | 'completed') => void,
    private onTelemetry?: (telemetry: LiveTelemetry) => void
  ) {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  async start() {
    this.onStatusChange('Connecting to Live Voice with Full-Paper RAG...');
    this.audioContext = new AudioContext({ sampleRate: 16000 });
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.connect(this.audioContext.destination);
    this.nextPlayTime = this.audioContext.currentTime;
    this.startVisualizer();

    this.lastUserSpeechTimestamp = performance.now();
    this.awaitingFirstAudio = true;

    this.sessionPromise = this.ai.live.connect({
      model: "gemini-3.8-live",
      callbacks: {
        onopen: async () => {
          this.onStatusChange('Connected. Speak now!');
          await this.startMicrophone();
          // Send an initial message to prompt the model to speak and acknowledge papers & RAG capabilities
          if (this.sessionPromise) {
            this.sessionPromise.then(session => {
              this.lastUserSpeechTimestamp = performance.now();
              this.awaitingFirstAudio = true;
              session.sendClientContent({
                turns: [{
                  role: 'user',
                  parts: [{ 
                    text: 'Hello! Please introduce yourself as the ArxivCast research partner. Briefly summarize the paper(s) we are discussing in 1-2 conversational sentences, mention that you have full-text lookup capabilities for deep math, methodology, and experimental details, and ask what I would like to explore.' 
                  }]
                }]
              });
            });
          }
        },
        onmessage: (message: LiveServerMessage) => {
          this.handleServerMessage(message);
        },
        onclose: () => {
          this.onStatusChange('Disconnected');
          this.stop();
        },
        onerror: (err) => {
          console.error("Live API Error:", err);
          this.onStatusChange('Error occurred');
          this.stop();
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
        },
        systemInstruction: `You are an expert AI research scientist and conversational co-pilot.
You are discussing selected academic research papers with a fellow researcher.
You are equipped with a real-time Retrieval-Augmented Generation (RAG) tool: 'lookupPaperDetails'.

IMPORTANT INSTRUCTIONS ON FULL-PAPER RAG:
1. High-level questions: Answer naturally using your broad knowledge and the paper titles/abstracts below.
2. In-depth technical questions: Whenever the user asks about specific mathematical formulations, loss functions, neural network architectures, hyperparameter values, ablation studies, benchmark tables, datasets, proofs, or experimental setups, you MUST call 'lookupPaperDetails' with a targeted search query.
3. When the tool returns excerpts from the full paper, synthesize and explain the findings conversationally, concisely, and accurately.
4. Keep spoken responses fluid, engaging, and spoken-word friendly.

Selected Papers Overview:
${this.papersContext}`,
        tools: [
          {
            functionDeclarations: [
              {
                name: "lookupPaperDetails",
                description: "Search the complete text, methodology, equations, architecture, benchmarks, hyperparameters, tables, and experimental details of the selected arXiv papers.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    query: {
                      type: Type.STRING,
                      description: "The specific topic, concept, equation, metric, or technical parameter to search for in the full paper text.",
                    },
                    paper_id: {
                      type: Type.STRING,
                      description: "Optional arXiv paper ID if inquiring about a specific paper.",
                    }
                  },
                  required: ["query"],
                }
              }
            ]
          }
        ]
      },
    });
  }

  private async queryPaperRAG(query: string, paperId?: string): Promise<string> {
    try {
      const res = await fetch('/api/arxiv/rag-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          paper_ids: paperId ? [paperId] : (this.paperIds.length > 0 ? this.paperIds : undefined),
          top_k: 4,
        }),
      });

      const data = await res.json();
      if (!data.ok || !data.results || data.results.length === 0) {
        return "No specific full-text excerpts found matching this query in the selected papers.";
      }

      return data.results
        .map((r: any, idx: number) => `[Excerpt ${idx + 1} - Paper: ${r.title} | Section: ${r.section}]\n${r.content}`)
        .join('\n\n');
    } catch (err: any) {
      console.error("RAG search error:", err);
      return `Error searching paper: ${err.message}`;
    }
  }

  private async startMicrophone() {
    if (!this.audioContext) return;
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      this.processor.onaudioprocess = (e) => {
        const float32Data = e.inputBuffer.getChannelData(0);
        const pcm16Data = new Int16Array(float32Data.length);
        let hasVoiceActivity = false;

        for (let i = 0; i < float32Data.length; i++) {
          let s = Math.max(-1, Math.min(1, float32Data[i]));
          pcm16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          if (Math.abs(s) > 0.08) hasVoiceActivity = true;
        }

        if (hasVoiceActivity) {
          this.lastUserSpeechTimestamp = performance.now();
          this.awaitingFirstAudio = true;
        }
        
        // Fast base64 encoding
        const buffer = new Uint8Array(pcm16Data.buffer);
        let binary = '';
        for (let i = 0; i < buffer.byteLength; i++) {
          binary += String.fromCharCode(buffer[i]);
        }
        const base64 = btoa(binary);

        if (this.sessionPromise) {
          this.sessionPromise.then(session => {
            session.sendRealtimeInput({
              audio: { data: base64, mimeType: 'audio/pcm;rate=16000' }
            });
          });
        }
      };
    } catch (err) {
      console.error("Microphone access denied:", err);
      this.onStatusChange('Microphone access denied');
    }
  }

  private handleServerMessage(message: LiveServerMessage) {
    // Interruption / Barge-in
    if (message.serverContent?.interrupted) {
      const interruptStart = performance.now();
      this.nextPlayTime = this.audioContext?.currentTime || 0;
      this.activeSources.forEach(source => {
        try { source.stop(); } catch (e) {}
      });
      this.activeSources = [];
      const bargeInStopMs = Math.round(performance.now() - interruptStart);
      this.onTelemetry?.({ bargeInStopMs });
    }

    // Handle Function Calling (RAG Tool)
    if (message.toolCall?.functionCalls) {
      for (const call of message.toolCall.functionCalls) {
        if (call.name === 'lookupPaperDetails') {
          const args = (call.args || {}) as { query?: string; paper_id?: string };
          const searchQuery = args.query || '';
          this.toolCallStartTime = performance.now();
          this.onToolCall?.('lookupPaperDetails', searchQuery, 'searching');

          this.queryPaperRAG(searchQuery, args.paper_id).then(searchResult => {
            const lastToolLatencyMs = Math.round(performance.now() - this.toolCallStartTime);
            this.onToolCall?.('lookupPaperDetails', searchQuery, 'completed');
            this.onTelemetry?.({ lastToolLatencyMs });

            if (this.sessionPromise) {
              this.sessionPromise.then(session => {
                session.sendToolResponse({
                  functionResponses: [
                    {
                      id: call.id,
                      name: call.name,
                      response: {
                        output: searchResult,
                      },
                    },
                  ],
                });
              });
            }
          });
        }
      }
    }

    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio && this.audioContext) {
      this.totalAudioChunks++;

      // Compute TTFA (Time to First Audio packet)
      if (this.awaitingFirstAudio && this.lastUserSpeechTimestamp > 0) {
        const ttfaMs = Math.round(performance.now() - this.lastUserSpeechTimestamp);
        this.awaitingFirstAudio = false;
        this.onTelemetry?.({ ttfaMs, totalAudioChunksReceived: this.totalAudioChunks });
      }

      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const pcm16Data = new Int16Array(bytes.buffer);
      const float32Data = new Float32Array(pcm16Data.length);
      for (let i = 0; i < pcm16Data.length; i++) {
        float32Data[i] = pcm16Data[i] / 32768.0;
      }

      const audioBuffer = this.audioContext.createBuffer(1, float32Data.length, 24000);
      audioBuffer.copyToChannel(float32Data, 0);

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.analyser!);
      
      const currentTime = this.audioContext.currentTime;
      if (this.nextPlayTime < currentTime) {
        this.nextPlayTime = currentTime;
      }
      
      source.start(this.nextPlayTime);
      this.nextPlayTime += audioBuffer.duration;
      
      this.activeSources.push(source);
      source.onended = () => {
        this.activeSources = this.activeSources.filter(s => s !== source);
      };
    }
  }

  private startVisualizer() {
    if (!this.analyser || !this.onVolumeChange) return;
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    const update = () => {
      this.analyser!.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      this.onVolumeChange!(average / 255); // Normalize to 0-1
      this.animationFrameId = requestAnimationFrame(update);
    };
    update();
  }

  async stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
    if (this.sessionPromise) {
      this.sessionPromise.then(session => {
        try { session.close(); } catch(e) {}
      });
      this.sessionPromise = null;
    }
  }
}
