import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Loader2, AlertTriangle, BookOpen, Send, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function App() {
  const [sourceName, setSourceName] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState('');
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [ingestionSuccess, setIngestionSuccess] = useState(false);

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceName || !sourceText) return;
    setIsIngesting(true);
    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sourceText, sourceName }),
      });
      if (res.ok) {
        setIngestionSuccess(true);
        setSourceName('');
        setSourceText('');
        setTimeout(() => setIngestionSuccess(false), 3000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsIngesting(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query) return;
    setIsSearching(true);
    setStatus('Initializing research...');
    setDraft('');
    setConflicts([]);
    setSources([]);

    const eventSource = new EventSource(`/api/research?q=${encodeURIComponent(query)}`);
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.status) {
        setStatus(data.status);
      }
      
      if (data.done) {
        setDraft(data.draft);
        setConflicts(data.conflicts || []);
        setSources(data.sources || []);
        setIsSearching(false);
        setStatus('');
        eventSource.close();
      }

      if (data.error) {
        console.error(data.error);
        setStatus(`Error: ${data.error}`);
        setIsSearching(false);
        eventSource.close();
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE Error:', err);
      eventSource.close();
      setIsSearching(false);
      setStatus('Connection lost');
    };
  };

  return (
    <div className="min-h-screen font-sans selection:bg-amber-100/50">
      <header className="max-w-4xl mx-auto px-6 pt-16 pb-8 border-b border-warm-grey/40">
        <h1 className="font-serif text-5xl tracking-tight text-neutral-900 mb-2">CorpusAI</h1>
        <p className="text-neutral-500 font-medium">Research-led grounded writing</p>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12 grid grid-cols-1 md:grid-cols-12 gap-12">
        {/* Left: Input/Ingestion */}
        <div className="md:col-span-5 space-y-12">
          <section className="space-y-6">
            <h2 className="font-serif text-2xl text-neutral-800">Add to Corpus</h2>
            <form onSubmit={handleIngest} className="space-y-4">
              <input
                type="text"
                placeholder="Source Name (e.g. Whitehead, 1929)"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                className="w-full bg-warm-bg border border-warm-grey px-4 py-3 rounded-md focus:outline-none focus:ring-1 focus:ring-neutral-400 text-sm transition-all"
              />
              <textarea
                placeholder="Paste research text here..."
                rows={8}
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                className="w-full bg-warm-bg border border-warm-grey px-4 py-3 rounded-md focus:outline-none focus:ring-1 focus:ring-neutral-400 text-sm transition-all resize-none"
              />
              <button
                type="submit"
                disabled={isIngesting}
                className="w-full bg-neutral-900 text-white py-3 rounded-md flex items-center justify-center gap-2 hover:bg-neutral-800 transition-colors disabled:opacity-50"
              >
                {isIngesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {ingestionSuccess ? 'Sources added' : 'Ingest to Collection'}
              </button>
            </form>
          </section>

          <section className="space-y-6">
            <h2 className="font-serif text-2xl text-neutral-800">Generate Draft</h2>
            <form onSubmit={handleSearch} className="space-y-4">
              <textarea
                placeholder="What are you writing about?"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-warm-bg border border-warm-grey px-4 py-3 rounded-md focus:outline-none focus:ring-1 focus:ring-neutral-400 text-sm transition-all h-32"
              />
              <button
                type="submit"
                disabled={isSearching}
                className="w-full bg-neutral-900 text-white py-3 rounded-md flex items-center justify-center gap-2 hover:bg-neutral-800 transition-colors disabled:opacity-50"
              >
                {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Begin Synthesis
              </button>
              {status && (
                <div id="status-display" className="text-xs text-neutral-400 flex items-center gap-2 px-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  {status}
                </div>
              )}
            </form>
          </section>
        </div>

        {/* Right: Output */}
        <div className="md:col-span-7 space-y-8">
          <AnimatePresence mode="wait">
            {conflicts.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="bg-amber-tint border-l-2 border-amber-border p-6 space-y-3"
              >
                <div className="flex items-center gap-2 text-amber-900 font-medium text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  Conflicts Identified
                </div>
                <ul className="space-y-2 text-sm text-neutral-600 list-disc ml-4">
                  {conflicts.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="bg-white border border-warm-grey min-h-[600px] p-8 md:p-12 relative overflow-hidden">
            {!draft && !isSearching && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-300 opacity-50 space-y-4">
                <BookOpen className="w-12 h-12 stroke-[1px]" />
                <p className="font-serif text-lg">Results will appear here</p>
              </div>
            )}
            
            {isSearching && !draft && (
              <div className="space-y-4 animate-pulse">
                <div className="h-6 w-3/4 bg-warm-bg rounded" />
                <div className="h-4 w-full bg-warm-bg rounded" />
                <div className="h-4 w-5/6 bg-warm-bg rounded" />
                <div className="h-4 w-full bg-warm-bg rounded" />
              </div>
            )}

            {draft && (
              <article className="prose prose-neutral max-w-none prose-headings:font-serif prose-headings:font-semibold">
                <div className="text-neutral-900 leading-relaxed whitespace-pre-wrap font-sans text-lg">
                  {draft}
                </div>
                {sources.length > 0 && (
                  <footer className="mt-12 pt-8 border-t border-warm-grey text-xs text-neutral-400">
                    <p className="mb-2 font-medium text-neutral-500">Documentary Basis:</p>
                    <div className="flex flex-wrap gap-2">
                      {sources.map((s, i) => (
                        <span key={i} className="px-2 py-1 bg-warm-bg border border-warm-grey rounded text-[10px] uppercase tracking-wider">
                          {s}
                        </span>
                      ))}
                    </div>
                  </footer>
                )}
              </article>
            )}
          </div>
        </div>
      </main>

      <footer className="max-w-4xl mx-auto px-6 py-12 text-center text-xs text-neutral-400 font-medium tracking-tight">
        CorpusAI &bull; Research-Driven AI Engine
      </footer>
    </div>
  );
}
