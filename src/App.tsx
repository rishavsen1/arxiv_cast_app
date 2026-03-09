import React, { useState, useEffect, useRef } from 'react';
import { Search, Trash2, Play, FileAudio, RefreshCw, CheckSquare, Square, DownloadCloud, X, ChevronDown, ChevronUp, Menu, FileText, Database, MessageCircle, Send, Mic, PhoneCall, PhoneOff } from 'lucide-react';
import { LiveAudioSession } from './liveAudio';

type Paper = {
  id: string;
  category: string;
  title: string;
  url: string;
  date: string;
  abstract: string;
  other_categories: string;
};

type ModalConfig = {
  isOpen: boolean;
  title: string;
  message: string;
  type: 'alert' | 'confirm';
  onConfirm?: () => void;
};

type ChatMessage = {
  role: 'user' | 'model';
  text?: string;
  audioData?: string;
  mimeType?: string;
};

export default function App() {
  const [categoriesTree, setCategoriesTree] = useState<Record<string, string[]>>({});
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [selectedPapers, setSelectedPapers] = useState<Set<string>>(new Set());
  const [date, setDate] = useState<string>('');
  const [useDate, setUseDate] = useState(false);
  const [papersPerTag, setPapersPerTag] = useState(5);
  const [loading, setLoading] = useState(false);
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [synopsisHtml, setSynopsisHtml] = useState('<p>No synopsis available.</p>');
  const [archives, setArchives] = useState<string[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [podcastStyle, setPodcastStyle] = useState('DeepDive');
  const [podcastLength, setPodcastLength] = useState('Medium');
  const [isPodcastStudioOpen, setIsPodcastStudioOpen] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(true);
  const [isVaultOpen, setIsVaultOpen] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [liveStatus, setLiveStatus] = useState('');
  const [liveVolume, setLiveVolume] = useState(0);
  const [isLiveVoiceOpen, setIsLiveVoiceOpen] = useState(false);
  const liveSessionRef = useRef<LiveAudioSession | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);

  const [modal, setModal] = useState<ModalConfig>({ isOpen: false, title: '', message: '', type: 'alert' });

  const showAlert = (title: string, message: string) => {
    setModal({ isOpen: true, title, message, type: 'alert' });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setModal({ isOpen: true, title, message, type: 'confirm', onConfirm });
  };

  const closeModal = () => {
    setModal(prev => ({ ...prev, isOpen: false }));
  };

  useEffect(() => {
    fetch('/api/arxiv/categories')
      .then(res => res.json())
      .then(data => setCategoriesTree(data.tree));
    
    // Clear the table by default
    fetch('/api/arxiv/clear', { method: 'POST' }).then(() => {
      setPapers([]);
      setSelectedPapers(new Set());
    });

    loadSynopsis();
    loadArchives();
  }, []);

  const loadMatrix = async () => {
    const params = new URLSearchParams();
    if (selectedCategories.length > 0) params.append('categories', selectedCategories.join(','));
    if (useDate && date) params.append('date', date);
    else params.append('date', 'latest');
    params.append('papers_per_tag', papersPerTag.toString());

    const res = await fetch(`/api/arxiv/matrix-html?${params.toString()}`);
    const data = await res.json();
    setPapers(data.papers || []);
    // Select all by default
    setSelectedPapers(new Set((data.papers || []).map((p: Paper) => p.id)));
  };

  const loadSynopsis = async () => {
    const res = await fetch('/api/arxiv/synopsis-html');
    const html = await res.text();
    setSynopsisHtml(html);
  };

  const loadArchives = async () => {
    const res = await fetch('/api/archive');
    const data = await res.json();
    setArchives(data);
  };

  const handleCategoryToggle = (cat: string) => {
    setSelectedCategories(prev => 
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const handleSearchPopulate = async () => {
    if (selectedCategories.length === 0) {
      showAlert('Selection Required', 'Please select at least one category.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/arxiv/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categories: selectedCategories,
          papers_per_tag: papersPerTag,
          date: useDate ? date : undefined
        })
      });
      const data = await res.json();
      if (data.ok) {
        await loadMatrix();
      } else {
        showAlert('Error', 'Error: ' + data.error);
      }
    } catch (e) {
      console.error(e);
      showAlert('Error', 'Failed to fetch papers.');
    } finally {
      setLoading(false);
    }
  };

  const handleClearTable = async () => {
    setLoading(true);
    try {
      await fetch('/api/arxiv/clear', { method: 'POST' });
      setPapers([]);
      setSelectedPapers(new Set());
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePodcast = async () => {
    setPodcastLoading(true);
    try {
      const paperIds = Array.from(selectedPapers);
      const res = await fetch('/api/arxiv/papers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: useDate ? date : undefined,
          paper_ids: paperIds.length > 0 ? paperIds : undefined
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      const papersToDiscuss = data.papers;

      if (papersToDiscuss.length === 0) {
        showAlert('No Papers', 'No papers selected');
        setPodcastLoading(false);
        return;
      }

      const { generatePodcastScript, generatePodcastAudio } = await import('./podcast');
      const script = await generatePodcastScript(papersToDiscuss, podcastStyle, podcastLength);
      const base64Audio = await generatePodcastAudio(script);

      if (!base64Audio) throw new Error('Failed to generate audio');

      const saveRes = await fetch('/api/arxiv/podcast/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script, audio_base64: base64Audio })
      });
      const saveData = await saveRes.json();

      if (saveData.ok) {
        setAudioUrl(saveData.result.audio_file);
        await loadSynopsis();
        await loadArchives();
        if (audioRef.current) {
          audioRef.current.load();
          audioRef.current.play();
        }
      } else {
        showAlert('Error', 'Error saving podcast: ' + saveData.error);
      }
    } catch (e) {
      console.error(e);
      showAlert('Error', 'Failed to generate podcast.');
    } finally {
      setPodcastLoading(false);
    }
  };

  const togglePaperSelection = (id: string) => {
    const newSet = new Set(selectedPapers);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedPapers(newSet);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64data = (reader.result as string).split(',')[1];
          await handleSendAudioMessage(base64data, mediaRecorder.mimeType);
        };
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      showAlert('Microphone Error', 'Could not access the microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const toggleLiveMode = async () => {
    if (isLiveMode) {
      if (liveSessionRef.current) {
        await liveSessionRef.current.stop();
        liveSessionRef.current = null;
      }
      setIsLiveMode(false);
      setLiveStatus('');
    } else {
      const selectedPapersData = papers.filter(p => selectedPapers.has(p.id));
      if (selectedPapersData.length === 0) {
        showAlert('No Papers', 'Please select papers to discuss first.');
        return;
      }
      
      const papersContext = selectedPapersData.map(p => `Title: ${p.title}\nAbstract: ${p.abstract}`).join('\n\n');
      const session = new LiveAudioSession(
        papersContext, 
        (status) => {
          setLiveStatus(status);
          if (status === 'Disconnected' || status === 'Error occurred') {
            setIsLiveMode(false);
            liveSessionRef.current = null;
            setLiveVolume(0);
          }
        },
        (volume) => {
          setLiveVolume(volume);
        }
      );
      
      liveSessionRef.current = session;
      setIsLiveMode(true);
      await session.start();
    }
  };

  const handleSendAudioMessage = async (base64Audio: string, mimeType: string) => {
    const selectedPapersData = papers.filter(p => selectedPapers.has(p.id));
    if (selectedPapersData.length === 0) {
      showAlert('No Papers', 'Please select papers to discuss first.');
      return;
    }

    const newUserMsg: ChatMessage = { role: 'user', text: '🎤 [Audio Message]', audioData: base64Audio, mimeType };
    setChatMessages(prev => [...prev, newUserMsg]);
    setIsChatLoading(true);

    try {
      const { sendChatMessage, generateSpeech } = await import('./chat');
      const responseText = await sendChatMessage(selectedPapersData, chatMessages, { inlineData: { data: base64Audio, mimeType } });
      
      setChatMessages(prev => [...prev, { role: 'model', text: responseText }]);

      const speechBase64 = await generateSpeech(responseText);
      if (speechBase64) {
        const audioUrl = `data:audio/mp3;base64,${speechBase64}`;
        const audio = new Audio(audioUrl);
        audio.play();
      }
    } catch (e: any) {
      console.error(e);
      showAlert('Chat Error', e.message || 'Failed to process audio message.');
      setChatMessages(prev => [...prev, { role: 'model', text: 'Sorry, I encountered an error.' }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    
    const userMsg = chatInput;
    setChatInput('');
    const newUserMsg: ChatMessage = { role: 'user', text: userMsg };
    setChatMessages(prev => [...prev, newUserMsg]);
    setIsChatLoading(true);

    try {
      const selectedPapersData = papers.filter(p => selectedPapers.has(p.id));
      if (selectedPapersData.length === 0) {
        throw new Error("No papers selected to discuss.");
      }
      const { sendChatMessage } = await import('./chat');
      const responseText = await sendChatMessage(selectedPapersData, chatMessages, userMsg);
      setChatMessages(prev => [...prev, { role: 'model', text: responseText }]);
    } catch (e: any) {
      console.error(e);
      showAlert('Chat Error', e.message || 'Failed to send message.');
      setChatMessages(prev => [...prev, { role: 'model', text: 'Sorry, I encountered an error.' }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f9f8f6] text-[#2c2c2a] flex flex-col font-sans relative">
      {/* Modal Overlay */}
      {modal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-[#d5d3cb] rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-[#e5e3db]">
              <h3 className="text-lg font-semibold text-[#2c2c2a] font-serif">{modal.title}</h3>
              <button onClick={closeModal} className="text-[#5c5c5a] hover:text-black transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 text-[#4a4a48]">
              {modal.message}
            </div>
            <div className="p-4 border-t border-[#e5e3db] flex justify-end gap-3 bg-white/50">
              {modal.type === 'confirm' && (
                <button 
                  onClick={closeModal}
                  className="px-4 py-2 rounded text-sm font-medium text-[#4a4a48] hover:text-black hover:bg-[#f0eee6] transition-colors"
                >
                  Cancel
                </button>
              )}
              <button 
                onClick={() => {
                  if (modal.type === 'confirm' && modal.onConfirm) {
                    modal.onConfirm();
                  }
                  closeModal();
                }}
                className="px-4 py-2 rounded text-sm font-medium bg-[#3a3a38] hover:bg-[#2c2c2a] text-white transition-colors"
              >
                {modal.type === 'confirm' ? 'Confirm' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="bg-white border-b border-[#e5e3db] p-4 flex justify-between items-center z-10">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
            className="text-[#5c5c5a] hover:text-black transition-colors p-1 rounded hover:bg-[#f0eee6]"
          >
            <Menu className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold text-[#3a3a38] flex items-center gap-2 font-serif">
            <FileAudio className="w-6 h-6" />
            ArxivCast — Intelligence Briefing
          </h1>
        </div>
        <a href="#" className="text-sm text-[#5c5c5a] hover:text-[#5a5a58] transition-colors">Return to Dashboard</a>
      </header>

      <div className="flex flex-1 overflow-hidden flex-col lg:flex-row">
        {/* Sidebar */}
        {isSidebarOpen && (
          <aside className="w-full lg:w-96 bg-white border-r border-[#e5e3db] flex flex-col shrink-0 overflow-y-auto">
            {/* Audio Controls */}
            <div className="border-b border-[#e5e3db] shrink-0">
              <button 
                onClick={() => setIsPodcastStudioOpen(!isPodcastStudioOpen)}
                className="w-full p-4 flex justify-between items-center hover:bg-[#f0eee6]/50 transition-colors"
              >
                <h2 className="text-lg font-semibold text-[#2c2c2a] flex items-center gap-2 font-serif">
                  <Play className="w-5 h-5 text-amber-700" />
                  Podcast Studio
                </h2>
                {isPodcastStudioOpen ? <ChevronUp className="w-5 h-5 text-[#5c5c5a]" /> : <ChevronDown className="w-5 h-5 text-[#5c5c5a]" />}
              </button>
            
            {isPodcastStudioOpen && (
              <div className="p-4 pt-0 space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-[#5c5c5a] uppercase">Style</label>
                    <select 
                      value={podcastStyle}
                      onChange={e => setPodcastStyle(e.target.value)}
                      className="w-full bg-[#f0eee6] border border-[#d5d3cb] rounded p-2 text-sm"
                    >
                      <option>Easy</option>
                      <option>DeepDive</option>
                      <option>Critique</option>
                      <option>Debate</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-[#5c5c5a] uppercase">Length</label>
                    <select 
                      value={podcastLength}
                      onChange={e => setPodcastLength(e.target.value)}
                      className="w-full bg-[#f0eee6] border border-[#d5d3cb] rounded p-2 text-sm"
                    >
                      <option>Short</option>
                      <option>Medium</option>
                      <option>Long</option>
                    </select>
                  </div>
                </div>

                <div className="bg-[#f9f8f6]/50 rounded-lg p-3 border border-[#e5e3db]/50">
                  <h4 className="text-xs font-semibold text-[#4a4a48] uppercase mb-2">Voice Models</h4>
                  <div className="space-y-2 text-xs text-[#5c5c5a]">
                    <div className="flex justify-between items-center">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-500"></span> Alex</span>
                      <span className="font-mono bg-[#f0eee6] px-1.5 py-0.5 rounded text-[10px]">Puck (gemini-2.5-flash-preview-tts)</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"></span> Sam</span>
                      <span className="font-mono bg-[#f0eee6] px-1.5 py-0.5 rounded text-[10px]">Kore (gemini-2.5-flash-preview-tts)</span>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={handleGeneratePodcast}
                  disabled={podcastLoading || selectedPapers.size === 0}
                  className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-4 py-3 rounded font-medium transition-colors disabled:opacity-50"
                >
                  {podcastLoading ? (
                    <><RefreshCw className="w-5 h-5 animate-spin" /> Generating Audio...</>
                  ) : (
                    <><FileAudio className="w-5 h-5" /> Generate Podcast</>
                  )}
                </button>
                <div className="text-xs text-center text-[#7a7a78]">
                  Using {selectedPapers.size} selected papers
                </div>

                {audioUrl && (
                  <div className="mt-4 p-3 bg-[#f9f8f6] rounded-lg border border-[#e5e3db]">
                    <audio ref={audioRef} controls className="w-full h-10" src={audioUrl} />
                  </div>
                )}
              </div>
            )}
          </div>

            {/* Transcript */}
            <div className="border-b border-[#e5e3db] flex flex-col min-h-0 shrink-0">
              <button 
                onClick={() => setIsTranscriptOpen(!isTranscriptOpen)}
                className="w-full p-4 flex justify-between items-center hover:bg-[#f0eee6]/50 transition-colors bg-white/80 sticky top-0"
              >
                <h3 className="text-sm font-semibold text-[#4a4a48] uppercase tracking-wider flex items-center gap-2 font-serif">
                  <FileText className="w-4 h-4 text-[#5c5c5a]" />
                  Transcript
                </h3>
                {isTranscriptOpen ? <ChevronUp className="w-5 h-5 text-[#5c5c5a]" /> : <ChevronDown className="w-5 h-5 text-[#5c5c5a]" />}
              </button>
              {isTranscriptOpen && (
                <div className="overflow-auto p-4 text-sm text-[#4a4a48] space-y-4 prose prose-invert prose-p:leading-relaxed max-h-96" dangerouslySetInnerHTML={{ __html: synopsisHtml }} />
              )}
            </div>

            {/* AI Discussion */}
            <div className="border-b border-[#e5e3db] flex flex-col min-h-0 shrink-0">
              <div className="w-full p-4 flex justify-between items-center bg-white/80 sticky top-0">
                <button 
                  onClick={() => setIsChatOpen(!isChatOpen)}
                  className="flex-1 flex items-center gap-2 hover:text-black transition-colors text-left"
                >
                  <MessageCircle className="w-4 h-4 text-[#3a3a38]" />
                  <h3 className="text-sm font-semibold text-[#4a4a48] uppercase tracking-wider font-serif">Discuss Papers</h3>
                </button>
                <div className="flex items-center gap-2">
                  {chatMessages.length > 0 && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setChatMessages([]);
                      }}
                      className="text-xs text-[#5c5c5a] hover:text-black px-2 py-1 bg-[#f0eee6] rounded"
                    >
                      Reset
                    </button>
                  )}
                  <button onClick={() => setIsChatOpen(!isChatOpen)}>
                    {isChatOpen ? <ChevronUp className="w-5 h-5 text-[#5c5c5a]" /> : <ChevronDown className="w-5 h-5 text-[#5c5c5a]" />}
                  </button>
                </div>
              </div>
              {isChatOpen && (
                <div className="flex flex-col h-96 bg-[#f9f8f6]">
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {chatMessages.length === 0 ? (
                      <div className="text-[#7a7a78] text-sm text-center mt-10">
                        Ask a question about the {selectedPapers.size} selected papers.
                      </div>
                    ) : (
                      chatMessages.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[85%] rounded-lg p-3 text-sm ${msg.role === 'user' ? 'bg-[#3a3a38] text-white' : 'bg-[#f0eee6] text-[#2c2c2a]'}`}>
                            {msg.text}
                          </div>
                        </div>
                      ))
                    )}
                    {isChatLoading && (
                      <div className="flex justify-start">
                        <div className="max-w-[85%] rounded-lg p-3 text-sm bg-[#f0eee6] text-[#5c5c5a] flex items-center gap-2">
                          <RefreshCw className="w-4 h-4 animate-spin" /> Thinking...
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="p-3 border-t border-[#e5e3db] bg-white flex gap-2 items-center">
                    <button
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`p-2 rounded transition-colors ${isRecording ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse' : 'bg-[#f0eee6] hover:bg-[#e5e3db] text-[#4a4a48]'}`}
                      title={isRecording ? "Stop Recording" : "Start Voice Message"}
                    >
                      {isRecording ? <Square className="w-4 h-4" fill="currentColor" /> : <Mic className="w-4 h-4" />}
                    </button>
                    <input 
                      type="text" 
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                      placeholder="Ask about the papers..."
                      className="flex-1 bg-[#f0eee6] border border-[#d5d3cb] rounded px-3 py-2 text-sm text-[#2c2c2a] focus:outline-none focus:border-[#5a5a58]"
                    />
                    <button 
                      onClick={handleSendMessage}
                      disabled={isChatLoading || !chatInput.trim() || selectedPapers.size === 0}
                      className="bg-[#3a3a38] hover:bg-[#2c2c2a] text-white p-2 rounded transition-colors disabled:opacity-50"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Live Voice Assistant */}
            <div className="border-b border-[#e5e3db] flex flex-col min-h-0 shrink-0">
              <button 
                onClick={() => setIsLiveVoiceOpen(!isLiveVoiceOpen)}
                className="w-full p-4 flex justify-between items-center hover:bg-[#f0eee6]/50 transition-colors bg-white/80 sticky top-0"
              >
                <h3 className="text-sm font-semibold text-[#4a4a48] uppercase tracking-wider flex items-center gap-2 font-serif">
                  <PhoneCall className="w-4 h-4 text-emerald-400" />
                  Live Voice Assistant
                </h3>
                {isLiveVoiceOpen ? <ChevronUp className="w-5 h-5 text-[#5c5c5a]" /> : <ChevronDown className="w-5 h-5 text-[#5c5c5a]" />}
              </button>
              {isLiveVoiceOpen && (
                <div className="p-6 flex flex-col items-center justify-center space-y-6 bg-[#f9f8f6]">
                  <div className="relative w-32 h-32 flex items-center justify-center">
                    {/* Visualizer Rings */}
                    {isLiveMode && (
                      <>
                        <div 
                          className="absolute inset-0 rounded-full bg-emerald-500/20 transition-transform duration-75"
                          style={{ transform: `scale(${1 + liveVolume * 1.5})` }}
                        />
                        <div 
                          className="absolute inset-2 rounded-full bg-emerald-500/30 transition-transform duration-75"
                          style={{ transform: `scale(${1 + liveVolume * 0.8})` }}
                        />
                      </>
                    )}
                    
                    <button
                      onClick={toggleLiveMode}
                      className={`relative z-10 w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-lg ${
                        isLiveMode 
                          ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/50' 
                          : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/50'
                      }`}
                    >
                      {isLiveMode ? <PhoneOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
                    </button>
                  </div>
                  
                  <div className="text-center space-y-2">
                    <h4 className="text-lg font-medium text-[#2c2c2a]">
                      {isLiveMode ? 'Listening...' : 'Start Conversation'}
                    </h4>
                    <p className="text-sm text-[#5c5c5a]">
                      {isLiveMode 
                        ? liveStatus 
                        : 'Click the button to start a real-time voice discussion about your selected papers.'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Vault */}
            <div className="flex flex-col bg-[#f9f8f6] shrink-0">
              <button 
                onClick={() => setIsVaultOpen(!isVaultOpen)}
                className="w-full p-3 border-b border-[#e5e3db] flex justify-between items-center hover:bg-[#f0eee6]/50 transition-colors bg-white/80 sticky top-0"
              >
                <h3 className="text-sm font-semibold text-[#4a4a48] uppercase tracking-wider flex items-center gap-2 font-serif">
                  <Database className="w-4 h-4 text-[#5c5c5a]" />
                  GDrive Vault
                </h3>
                {isVaultOpen ? <ChevronUp className="w-5 h-5 text-[#5c5c5a]" /> : <ChevronDown className="w-5 h-5 text-[#5c5c5a]" />}
              </button>
              {isVaultOpen && (
                <div className="overflow-auto p-2 space-y-1 max-h-64">
                  {archives.length === 0 ? (
                    <div className="text-xs text-[#7a7a78] p-2 text-center">No archives found.</div>
                  ) : (
                    archives.map(file => (
                      <button 
                        key={file}
                        onClick={() => {
                          setAudioUrl(`/audio/${file}`);
                          if (audioRef.current) {
                            setTimeout(() => audioRef.current?.play(), 100);
                          }
                        }}
                        className="w-full text-left px-3 py-2 text-xs text-[#5c5c5a] hover:text-[#5a5a58] hover:bg-white rounded flex items-center gap-2 group transition-colors"
                      >
                        <Play className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        {file}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
        {/* Main Area */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Filters */}
          <div className="bg-white/50 p-4 border-b border-[#e5e3db] shrink-0">
            <div className="flex flex-wrap gap-6 items-start">
              <div className="space-y-2 flex-1">
                <h3 className="text-sm font-semibold text-[#5c5c5a] uppercase tracking-wider font-serif">Categories</h3>
                <div className="flex flex-wrap gap-4 max-w-4xl max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                  {Object.entries(categoriesTree).map(([topic, subjects]) => (
                    <div key={topic} className="space-y-1">
                      <div className="text-xs font-bold text-[#7a7a78] uppercase">{topic}</div>
                      <div className="flex flex-wrap gap-2">
                        {subjects.map(sub => {
                          const cat = topic === sub ? topic : `${topic}.${sub}`;
                          const isSelected = selectedCategories.includes(cat);
                          return (
                            <label key={cat} className="flex items-center gap-1 text-sm cursor-pointer hover:text-[#5a5a58]">
                              <input 
                                type="checkbox" 
                                className="rounded border-[#d5d3cb] bg-[#f0eee6] text-[#7a7a78] focus:ring-[#5a5a58] focus:ring-offset-white"
                                checked={isSelected}
                                onChange={() => handleCategoryToggle(cat)}
                              />
                              {sub}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4 flex-1 min-w-[200px]">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-[#5c5c5a] uppercase tracking-wider font-serif">Filters</h3>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input 
                        type="checkbox" 
                        checked={useDate} 
                        onChange={e => setUseDate(e.target.checked)}
                        className="rounded border-[#d5d3cb] bg-[#f0eee6] text-[#7a7a78] focus:ring-[#5a5a58] focus:ring-offset-white"
                      />
                      Specific Date
                    </label>
                    <input 
                      type="date" 
                      disabled={!useDate}
                      value={date}
                      onChange={e => setDate(e.target.value)}
                      max={new Date().toISOString().split('T')[0]}
                      className="bg-[#f0eee6] border border-[#d5d3cb] rounded px-2 py-1 text-sm disabled:opacity-50"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-[#4a4a48]">Papers per tag:</label>
                    <input 
                      type="number" 
                      value={papersPerTag}
                      onChange={e => setPapersPerTag(parseInt(e.target.value) || 1)}
                      className="bg-[#f0eee6] border border-[#d5d3cb] rounded px-2 py-1 text-sm w-20"
                      min="1" max="50"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button 
                    onClick={handleSearchPopulate}
                    disabled={loading}
                    className="flex items-center gap-2 bg-[#3a3a38] hover:bg-[#2c2c2a] text-white px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <DownloadCloud className="w-4 h-4" />}
                    Search & Populate
                  </button>
                  <button 
                    onClick={handleClearTable}
                    disabled={loading}
                    className="flex items-center gap-2 bg-[#f0eee6] hover:bg-red-50 text-[#4a4a48] hover:text-red-600 px-4 py-2 rounded text-sm font-medium transition-colors border border-[#d5d3cb] hover:border-red-300 disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    Clear table
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Matrix Container */}
          <div className="flex-1 overflow-auto p-4">
            {papers.length === 0 ? (
              <div className="h-full flex items-center justify-center text-[#7a7a78]">
                No papers loaded. Select categories and click "Search & Populate".
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#e5e3db] text-[#5c5c5a] text-sm">
                    <th className="p-2 w-10">Use</th>
                    <th className="p-2 w-24">Domain</th>
                    <th className="p-2 w-32">Other tags</th>
                    <th className="p-2 w-1/3">Title / Source</th>
                    <th className="p-2">Abstract</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-[#e5e3db]">
                  {papers.map(paper => (
                    <tr key={`${paper.id}-${paper.category}`} className="hover:bg-[#f5f4ef] transition-colors">
                      <td className="p-2 align-top">
                        <button onClick={() => togglePaperSelection(paper.id)} className="text-[#7a7a78] hover:text-[#3a3a38]">
                          {selectedPapers.has(paper.id) ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                        </button>
                      </td>
                      <td className="p-2 align-top">
                        <span className="inline-block px-2 py-1 bg-indigo-50 text-[#5a5a58] rounded text-xs font-mono border border-indigo-200">
                          {paper.category}
                        </span>
                      </td>
                      <td className="p-2 align-top">
                        <div className="flex flex-wrap gap-1">
                          {paper.other_categories ? paper.other_categories.split(',').map(c => (
                            <span key={c} className="inline-block px-1.5 py-0.5 bg-[#f0eee6] text-[#5c5c5a] rounded text-[10px] font-mono">
                              {c}
                            </span>
                          )) : <span className="text-gray-400">-</span>}
                        </div>
                      </td>
                      <td className="p-2 align-top">
                        <a href={paper.url} target="_blank" rel="noreferrer" className="font-medium text-[#2c2c2a] hover:text-[#3a3a38] hover:underline line-clamp-2">
                          {paper.title}
                        </a>
                        <div className="text-xs text-[#7a7a78] mt-1">{paper.date}</div>
                      </td>
                      <td className="p-2 align-top text-[#5c5c5a]">
                        <div className="line-clamp-3 hover:line-clamp-none transition-all">{paper.abstract}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>

      </div>
    </div>
  );
}
