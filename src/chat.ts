import { GoogleGenAI, Type } from '@google/genai';

export async function sendChatMessage(
  papers: any[], 
  history: any[], 
  newMessage: string | { inlineData: { data: string, mimeType: string } }
) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const paperIds = papers.map(p => p.id);
  const papersOverview = papers.map(p => `Title: ${p.title} (ID: ${p.id})\nAbstract: ${p.abstract}`).join('\n\n');

  // Query RAG search for relevant full-paper chunks if message is text
  let ragContext = '';
  if (typeof newMessage === 'string' && newMessage.trim()) {
    try {
      const res = await fetch('/api/arxiv/rag-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: newMessage, paper_ids: paperIds, top_k: 4 }),
      });
      const data = await res.json();
      if (data.ok && data.results && data.results.length > 0) {
        ragContext = '\n\nRelevant Full-Paper Sections & Excerpts:\n' + 
          data.results.map((r: any, idx: number) => `[Excerpt ${idx + 1} - ${r.title} | Section: ${r.section}]\n${r.content}`).join('\n\n');
      }
    } catch (e) {
      console.warn('RAG lookup for chat query failed:', e);
    }
  }

  const systemInstruction = `You are an expert research assistant. The user wants to discuss the following selected arXiv papers. You have access to both their abstracts and retrieved sections from the full papers. Use this complete context to answer questions with deep mathematical and technical accuracy, citing specific sections, equations, or ablation findings when relevant.\n\nContext Papers Overview:\n${papersOverview}${ragContext}`;

  const contents = history.map((h: any) => {
    const parts = [];
    if (h.text && h.text !== '🎤 [Audio Message]') {
      parts.push({ text: h.text });
    }
    if (h.audioData) {
      parts.push({ inlineData: { data: h.audioData, mimeType: h.mimeType } });
    }
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
    model: 'gemini-3.8-flash',
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
    model: "gemini-3.8-flash-lite-tts",
    contents: [
      {
        role: "user",
        parts: [{ text }],
      }
    ],
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

export async function parsePaperUrl(url: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: `Extract the title and a concise abstract/summary from this URL: ${url}`,
    config: {
      tools: [{ urlContext: {} }],
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          abstract: { type: Type.STRING }
        },
        required: ['title', 'abstract']
      }
    }
  });

  try {
    return JSON.parse(response.text || '{}');
  } catch (e) {
    console.error('Failed to parse Gemini response', response.text);
    return { title: '', abstract: '' };
  }
}
