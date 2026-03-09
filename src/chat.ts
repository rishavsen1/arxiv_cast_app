import { GoogleGenAI } from '@google/genai';

export async function sendChatMessage(papers: any[], history: any[], newMessage: string | { inlineData: { data: string, mimeType: string } }) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const papersContext = papers.map(p => `Title: ${p.title}\nAbstract: ${p.abstract}`).join('\n\n');

  const systemInstruction = `You are an expert research assistant. The user wants to discuss the following selected arXiv papers. Use this context to answer their questions accurately.\n\nContext Papers:\n${papersContext}`;

  const contents = history.map((h: any) => {
    const parts = [];
    if (h.text && h.text !== '🎤 [Audio Message]') {
      parts.push({ text: h.text });
    }
    if (h.audioData) {
      parts.push({ inlineData: { data: h.audioData, mimeType: h.mimeType } });
    }
    // Fallback if parts is empty
    if (parts.length === 0) parts.push({ text: h.text || '' });
    
    return {
      role: h.role,
      parts: parts
    };
  });

  const newParts = [];
  if (typeof newMessage === 'string') {
    newParts.push({ text: newMessage });
  } else {
    newParts.push(newMessage);
  }

  contents.push({
    role: 'user',
    parts: newParts
  });

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: contents,
    config: {
      systemInstruction,
    }
  });

  return response.text;
}

export async function generateSpeech(text: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Puck' },
        },
      },
    },
  });
  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
}
