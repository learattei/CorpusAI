import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Loader2, AlertTriangle, BookOpen, Send, Trash2, Edit3, X, FileText, Mic, UploadCloud } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type Tab = 'draft' | 'knowledge';

interface Source {
  _id: string;
  name: string;
  sample: string;
  chunkCount: number;
  createdAt: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('draft');
  const [showAddModal, setShowAddModal] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(false);

  // Drafting State
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState('');
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [citedSources, setCitedSources] = useState<string[]>([]);

  // Add Source State
  const [sourceName, setSourceName] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestMode, setIngestMode] = useState<'text' | 'pdf'>('text');
  const [ingestError, setIngestError] = useState<string | null>(null);

  // Edit Source State
  const [editingSource, setEditingSource] = useState<Source | null>(null);

  useEffect(() => {
    if (activeTab === 'knowledge') {
      fetchSources();
    }
  }, [activeTab]);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch('/api/health');
        if (!response.ok) {
          const text = await response.text();
          console.error('Health check failed:', text);
        } else {
          console.log('Backend health check passed');
        }
      } catch (err) {
        console.error('Backend unreachable:', err);
      }
    };
    checkHealth();
  }, []);

  const fetchSources = async () => {
    setIsLoadingSources(true);
    setIngestError(null);
    try {
      const res = await fetch('/api/sources');
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to fetch sources (${res.status}): ${text.substring(0, 100)}`);
      }
      const data = await res.json();
      setSources(data);
    } catch (err: any) {
      console.error(err);
      setIngestError(err.message);
    } finally {
      setIsLoadingSources(false);
    }
  };

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceName) return;
    if (ingestMode === 'text' && !sourceText) return;
    if (ingestMode === 'pdf' && !selectedFile) return;

    setIsIngesting(true);
    setIngestError(null);
    try {
      let res;
      if (ingestMode === 'pdf' && selectedFile) {
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('sourceName', sourceName);
        res = await fetch('/api/ingest-pdf', {
          method: 'POST',
          body: formData,
        });
      } else {
        res = await fetch('/api/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: sourceText, sourceName }),
        });
      }

      if (res.ok) {
        setShowAddModal(false);
        setSourceName('');
        setSourceText('');
        setSelectedFile(null);
        if (activeTab === 'knowledge') fetchSources();
      } else {
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const errorData = await res.json();
          setIngestError(errorData.error || 'Ingestion failed');
        } else {
          const text = await res.text();
          setIngestError(`Server Error (${res.status}): ${text.substring(0, 100)}...`);
        }
      }
    } catch (err: any) {
      console.error(err);
      setIngestError(`Network or Unexpected Error: ${err.message}`);
    } finally {
      setIsIngesting(false);
    }
  };

  const handleDeleteSource = async (id: string) => {
    if (!confirm('Are you sure you want to delete this source? All associated analysis will be removed.')) return;
    try {
      const res = await fetch(`/api/sources/${id}`, { method: 'DELETE' });
      if (res.ok) fetchSources();
    } catch (err) {
      console.error(err);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSource || !editingSource._id) {
      setIngestError("Invalid source selection for editing.");
      return;
    }
    setIsIngesting(true);
    setIngestError(null);
    try {
      const res = await fetch(`/api/sources/${editingSource._id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sourceText, sourceName }),
      });
      if (res.ok) {
        setEditingSource(null);
        setSourceText('');
        setSourceName('');
        setShowAddModal(false);
        fetchSources();
      } else {
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const errorData = await res.json();
          setIngestError(errorData.error || 'Update failed');
        } else {
          const text = await res.text();
          setIngestError(`Server Error (${res.status}): ${text.substring(0, 100)}...`);
        }
      }
    } catch (err: any) {
      console.error(err);
      setIngestError(`Network or Unexpected Error: ${err.message}`);
    } finally {
      setIsIngesting(false);
    }
  };

  const startRecording = () => {
    alert("Voice recording features are currently disabled.");
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query) return;
    setIsSearching(true);
    setStatus('Initializing research...');
    setDraft('');
    setConflicts([]);
    setCitedSources([]);

    const eventSource = new EventSource(`/api/research?q=${encodeURIComponent(query)}`);
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.status) setStatus(data.status);
      if (data.done) {
        setDraft(data.draft);
        setConflicts(data.conflicts || []);
        setCitedSources(data.sources || []);
        setIsSearching(false);
        setStatus('');
        eventSource.close();
      }
      if (data.error) {
        setStatus(`Error: ${data.error}`);
        setIsSearching(false);
        eventSource.close();
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setIsSearching(false);
      setStatus('Connection lost');
    };
  };

  return (
    <div className="min-h-screen bg-white font-sans selection:bg-amber-100/50 flex flex-col">
      {/* Header */}
      <header className="border-b border-warm-grey/40 sticky top-0 bg-white/80 backdrop-blur-sm z-40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div>
              <h1 className="font-serif text-2xl tracking-tight text-neutral-900">CorpusAI</h1>
              <p className="text-[10px] uppercase tracking-widest text-neutral-400 font-bold">Research in. Writing out.</p>
            </div>
            <nav className="flex items-center gap-6 text-sm font-medium">
              <button 
                onClick={() => setActiveTab('draft')}
                className={`transition-colors ${activeTab === 'draft' ? 'text-neutral-900 border-b-2 border-neutral-900 pb-1' : 'text-neutral-400 hover:text-neutral-600'}`}
              >
                Drafting
              </button>
              <button 
                onClick={() => setActiveTab('knowledge')}
                className={`transition-colors ${activeTab === 'knowledge' ? 'text-neutral-900 border-b-2 border-neutral-900 pb-1' : 'text-neutral-400 hover:text-neutral-600'}`}
              >
                Knowledge Base
              </button>
            </nav>
          </div>
          <button 
            onClick={() => setShowAddModal(true)}
            className="w-10 h-10 rounded-full bg-neutral-900 text-white flex items-center justify-center hover:bg-neutral-800 transition-all shadow-sm active:scale-95"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-12">
        <AnimatePresence mode="wait">
          {activeTab === 'draft' ? (
            <motion.div 
              key="draft"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="grid grid-cols-1 md:grid-cols-12 gap-12"
            >
              <div className="md:col-span-12 lg:col-span-4 space-y-8">
                <section className="space-y-6 sticky top-28">
                  <h2 className="font-serif text-3xl text-neutral-900">New Synthesis</h2>
                  <form onSubmit={handleSearch} className="space-y-4">
                    <textarea
                      placeholder="What are you writing about?"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="w-full bg-warm-bg border border-warm-grey px-5 py-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-200 text-base transition-all h-48 leading-relaxed resize-none shadow-inner"
                    />
                    <button
                      type="submit"
                      disabled={isSearching}
                      className="w-full bg-neutral-900 text-white py-4 rounded-xl flex items-center justify-center gap-3 hover:bg-neutral-800 transition-all font-medium disabled:opacity-50"
                    >
                      {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                      Generate Draft
                    </button>
                    {status && (
                      <div className="text-xs text-neutral-400 flex items-center gap-2 px-2 mt-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        {status}
                      </div>
                    )}
                  </form>
                </section>
              </div>

              <div className="md:col-span-12 lg:col-span-8 space-y-8">
                <AnimatePresence>
                  {conflicts.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-amber-tint border-l-2 border-amber-border p-8 rounded-r-xl space-y-4 shadow-sm"
                    >
                      <div className="flex items-center gap-2 text-amber-900 font-serif text-lg italic">
                        <AlertTriangle className="w-5 h-5" />
                        Contradictions Identified
                      </div>
                      <ul className="space-y-3 text-sm text-neutral-700 list-disc ml-6 leading-relaxed">
                        {conflicts.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="bg-white border border-warm-grey/60 min-h-[700px] p-8 md:p-16 rounded-3xl relative overflow-hidden shadow-sm flex flex-col">
                  {!draft && !isSearching && (
                    <div className="m-auto flex flex-col items-center justify-center text-neutral-200 opacity-40 space-y-6">
                      <BookOpen className="w-20 h-20 stroke-[0.5px]" />
                      <p className="font-serif text-xl italic">Awaiting your query...</p>
                    </div>
                  )}
                  
                  {isSearching && !draft && (
                    <div className="space-y-8 animate-pulse pt-8 w-full">
                      <div className="h-10 w-2/3 bg-warm-bg rounded-lg" />
                      <div className="space-y-4">
                        <div className="h-4 w-full bg-warm-bg rounded" />
                        <div className="h-4 w-11/12 bg-warm-bg rounded" />
                        <div className="h-4 w-full bg-warm-bg rounded" />
                        <div className="h-4 w-4/5 bg-warm-bg rounded" />
                      </div>
                      <div className="space-y-4">
                        <div className="h-4 w-full bg-warm-bg rounded" />
                        <div className="h-4 w-5/6 bg-warm-bg rounded" />
                        <div className="h-4 w-full bg-warm-bg rounded" />
                      </div>
                    </div>
                  )}

                  {draft && (
                    <article className="prose prose-neutral max-w-none flex-1">
                      <div className="text-neutral-900 leading-[1.8] whitespace-pre-wrap font-sans text-lg tracking-normal">
                        {draft}
                      </div>
                      <footer className="mt-20 pt-10 border-t border-warm-grey/30">
                        <p className="mb-4 text-xs font-bold uppercase tracking-widest text-neutral-400">Verified Sources</p>
                        <div className="flex flex-wrap gap-3">
                          {citedSources.map((s, i) => (
                            <span key={i} className="px-3 py-1.5 bg-warm-bg border border-warm-grey rounded-full text-[11px] font-medium text-neutral-500">
                              {s}
                            </span>
                          ))}
                        </div>
                      </footer>
                    </article>
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="knowledge"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex items-end justify-between border-b border-warm-grey/40 pb-6">
                <div>
                  <h2 className="font-serif text-4xl text-neutral-900 mb-2">Knowledge Base</h2>
                  <p className="text-neutral-400 font-medium">Your private dataset of research materials.</p>
                </div>
                <div className="text-xs font-bold text-neutral-900 bg-warm-bg px-3 py-1.5 rounded-full border border-warm-grey">
                  {sources.length} SOURCES TOTAL
                </div>
              </div>

              {isLoadingSources ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-neutral-300" />
                </div>
              ) : sources.length === 0 ? (
                <div className="text-center py-32 space-y-6">
                  <FileText className="w-16 h-16 mx-auto text-neutral-100" />
                  <p className="text-neutral-400 font-serif italic text-lg">Your library is currently empty.</p>
                  <button 
                    onClick={() => setShowAddModal(true)}
                    className="text-sm font-bold text-neutral-900 underline underline-offset-4"
                  >
                    Add your first research source
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {sources.map((s) => (
                    <div key={s._id} className="group bg-warm-bg border border-warm-grey/60 p-6 rounded-2xl flex items-center justify-between gap-6 hover:border-neutral-300 transition-all hover:shadow-sm">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <h3 className="font-serif text-xl text-neutral-900 truncate">{s.name}</h3>
                          <span className="text-[10px] font-bold bg-white border border-warm-grey px-2 py-0.5 rounded-full text-neutral-400">
                            {s.chunkCount} CHUNKS
                          </span>
                        </div>
                        <p className="text-xs text-neutral-400 line-clamp-1 italic font-sans">"{s.sample}..."</p>
                      </div>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => {
                            setEditingSource(s);
                            setSourceName(s.name);
                            setSourceText(s.sample); // In reality we'd fetch partial text or keep it simple
                            setShowAddModal(true);
                          }}
                          className="w-10 h-10 rounded-full border border-warm-grey bg-white flex items-center justify-center hover:bg-neutral-50 transition-colors text-neutral-500"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDeleteSource(s._id)}
                          className="w-10 h-10 rounded-full border border-warm-grey bg-white flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-colors text-neutral-500"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 pb-24">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowAddModal(false);
                setEditingSource(null);
              }}
              className="absolute inset-0 bg-neutral-900/10 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-xl rounded-3xl shadow-2xl border border-warm-grey overflow-hidden"
            >
              <div className="px-8 py-6 border-b border-warm-grey flex items-center justify-between">
                <h3 className="font-serif text-2xl text-neutral-900">
                  {editingSource ? 'Edit Source' : 'Add Research'}
                </h3>
                <button onClick={() => setShowAddModal(false)} className="text-neutral-400 hover:text-neutral-600">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={editingSource ? handleEditSubmit : handleIngest} className="p-8 space-y-6">
                {!editingSource && (
                  <div className="flex gap-4 p-1 bg-warm-bg rounded-xl border border-warm-grey mb-4">
                    <button 
                      type="button" 
                      onClick={() => setIngestMode('text')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${ingestMode === 'text' ? 'bg-white shadow-sm text-neutral-900' : 'text-neutral-400'}`}
                    >
                      TEXT / RESEARCH
                    </button>
                    <button 
                      type="button"
                      onClick={() => setIngestMode('pdf')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${ingestMode === 'pdf' ? 'bg-white shadow-sm text-neutral-900' : 'text-neutral-400'}`}
                    >
                      PDF DOCUMENT
                    </button>
                  </div>
                )}

                <div className="space-y-4">
                  {ingestError && (
                    <div className="bg-red-50 text-red-600 p-3 rounded-lg text-xs font-medium border border-red-100 italic">
                      {ingestError}
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 ml-1">Source Identity</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Whitehead, Process and Reality (1929)"
                      value={sourceName}
                      onChange={(e) => setSourceName(e.target.value)}
                      className="w-full bg-warm-bg border border-warm-grey px-4 py-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-neutral-400 text-sm"
                    />
                  </div>

                  {ingestMode === 'text' || editingSource ? (
                    <div className="space-y-2 relative">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 ml-1">Content</label>
                      <textarea
                        required
                        placeholder="Paste research text..."
                        rows={10}
                        value={sourceText}
                        onChange={(e) => setSourceText(e.target.value)}
                        className="w-full bg-warm-bg border border-warm-grey px-4 py-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-neutral-400 text-sm resize-none"
                      />
                    </div>
                  ) : (
                    <div className="h-48 border-2 border-dashed border-warm-grey rounded-2xl flex flex-col items-center justify-center gap-4 bg-warm-bg group relative">
                      <input 
                        type="file" 
                        accept=".pdf"
                        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      />
                      <UploadCloud className="w-12 h-12 text-neutral-300 group-hover:text-neutral-400 transition-colors" />
                      <div className="text-center">
                        <p className="text-sm font-serif italic text-neutral-500 px-4 line-clamp-1">
                          {selectedFile ? selectedFile.name : 'Select research PDF'}
                        </p>
                        <p className="text-[10px] text-neutral-400 font-bold uppercase mt-1">Automatic Text Extraction</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddModal(false);
                      setEditingSource(null);
                      setIngestError(null);
                    }}
                    className="flex-1 px-6 py-4 border border-warm-grey rounded-xl text-sm font-bold text-neutral-500 hover:bg-neutral-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isIngesting}
                    className="flex-[2] bg-neutral-900 text-white py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-neutral-800 transition-all font-bold disabled:opacity-50"
                  >
                    {isIngesting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-4 h-4" />}
                    {editingSource ? 'Save Changes' : (ingestMode === 'pdf' ? 'Process & Ingest' : 'Add to Collection')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="max-w-5xl mx-auto w-full px-6 py-12 text-center text-[10px] text-neutral-300 font-bold tracking-widest uppercase">
        CorpusAI &bull; Research-Driven AI Engine &bull; {new Date().getFullYear()}
      </footer>
    </div>
  );
}
