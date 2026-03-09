import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generatePodcastScript(papers: any[], style: string, length: string, customStyle?: string) {
  let wordCount = 500;
  if (length === 'Short') wordCount = 300;
  if (length === 'Long') wordCount = 800;

  const papersText = papers.map(p => `Category: ${p.category}\nTitle: ${p.title}\nAbstract: ${p.abstract}`).join('\n\n');

  const prompt = `
You are writing a script for a two-host audio podcast called "ArxivCast — Intelligence Briefing".
The hosts are Alex and Sam. They are discussing the latest arXiv papers.
Style: ${customStyle || style}
Target length: ~${wordCount} words.

Format the output EXACTLY like this, with no other text:
ALEX: [Alex's dialogue]
SAM: [Sam's dialogue]

Here are the papers to discuss:
${papersText}
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: prompt,
    config: {
      systemInstruction: "You are an expert podcast script writer. Write engaging, conversational dialogue.",
    }
  });

  return response.text || '';
}

export async function generatePodcastAudio(script: string) {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: script }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            { speaker: 'ALEX', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
            { speaker: 'SAM', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
          ]
        }
      }
    }
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  return base64Audio;
}
