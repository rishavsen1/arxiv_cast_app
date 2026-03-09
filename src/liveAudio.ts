import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

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

  constructor(
    private papersContext: string, 
    private onStatusChange: (status: string) => void,
    private onVolumeChange?: (volume: number) => void
  ) {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  async start() {
    this.onStatusChange('Connecting...');
    this.audioContext = new AudioContext({ sampleRate: 16000 });
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.connect(this.audioContext.destination);
    this.nextPlayTime = this.audioContext.currentTime;
    this.startVisualizer();

    this.sessionPromise = this.ai.live.connect({
      model: "gemini-2.5-flash-native-audio-preview-09-2025",
      callbacks: {
        onopen: async () => {
          this.onStatusChange('Connected. Speak now!');
          await this.startMicrophone();
          // Send an initial message to prompt the model to speak
          if (this.sessionPromise) {
            this.sessionPromise.then(session => {
              session.sendClientContent({
                turns: [{
                  role: 'user',
                  parts: [{ text: 'Hello! Please introduce yourself and briefly summarize the papers we are discussing today in 1-2 sentences, then ask me what I would like to know.' }]
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
        systemInstruction: `You are an expert research assistant. The user wants to discuss the following selected arXiv papers. Use this context to answer their questions accurately. Keep your answers concise and conversational.\n\nContext Papers:\n${this.papersContext}`,
      },
    });
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
        for (let i = 0; i < float32Data.length; i++) {
          let s = Math.max(-1, Math.min(1, float32Data[i]));
          pcm16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
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
              media: { data: base64, mimeType: 'audio/pcm;rate=16000' }
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
    if (message.serverContent?.interrupted) {
      this.nextPlayTime = this.audioContext?.currentTime || 0;
      this.activeSources.forEach(source => {
        try { source.stop(); } catch (e) {}
      });
      this.activeSources = [];
    }

    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio && this.audioContext) {
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
