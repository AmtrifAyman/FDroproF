import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import Peer from 'simple-peer';
import { QRCodeSVG } from 'qrcode.react';

// Lien dyal Railway (Bdlo b dyalek ila tbdel)
const socket = io('https://LIEN-DYAL-RAILWAY-HNA.up.railway.app'); 

const CHUNK_SIZE = 16 * 1024; // 16 KB

const iceServersConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ]
};

export default function App() {
  const [currentView, setCurrentView] = useState('landing');
  const [darkMode, setDarkMode] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [receivedItems, setReceivedItems] = useState([]);
  const [transferProgress, setTransferProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  
  const peerRef = useRef(null); 
  const fileMetaRef = useRef(null);
  const fileChunksRef = useRef([]); 
  const receivedSizeRef = useRef(0);

  // Dark Mode Logic
  useEffect(() => {
    const isDark = localStorage.getItem('color-theme') === 'dark' || 
      (!('color-theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setDarkMode(isDark);
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('color-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('color-theme', 'light');
    }
  }, [darkMode]);

  // WebRTC Logic
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');

    if (roomFromUrl && currentView === 'landing') {
        setCurrentView('room');
    }

    if (currentView !== 'room') return;

    const handleIncomingData = (data) => {
      if (fileMetaRef.current) {
        fileChunksRef.current.push(data);
        receivedSizeRef.current += (data.byteLength || data.length);
        const progress = Math.round((receivedSizeRef.current / fileMetaRef.current.fileSize) * 100);
        setTransferProgress(progress);

        if (receivedSizeRef.current >= fileMetaRef.current.fileSize) {
          const blob = new Blob(fileChunksRef.current, { type: fileMetaRef.current.fileType });
          const fileUrl = URL.createObjectURL(blob);
          const completedFile = {
            kind: 'file',
            name: fileMetaRef.current.fileName,
            url: fileUrl,
            size: (fileMetaRef.current.fileSize / 1024).toFixed(1),
            type: 'received'
          };
          setReceivedItems(prev => [completedFile, ...prev]);
          fileMetaRef.current = null;
          fileChunksRef.current = [];
          receivedSizeRef.current = 0;
          setTransferProgress(0);
        }
        return;
      }

      try {
        const textData = new TextDecoder().decode(data); 
        const parsed = JSON.parse(textData);
        if (parsed.type === 'file-meta') {
          fileMetaRef.current = parsed;
          fileChunksRef.current = [];
          receivedSizeRef.current = 0;
          setTransferProgress(0);
          return;
        }
        if (parsed.type === 'text') {
          setReceivedItems(prev => [{ kind: 'text', content: parsed.content, type: 'received' }, ...prev]);
        }
      } catch (e) {}
    };

    if (roomFromUrl) {
      setRoomId(roomFromUrl);
      socket.emit('join-room', roomFromUrl);
      const peer = new Peer({ initiator: true, trickle: false, config: iceServersConfig });
      peer.on('signal', (signal) => socket.emit('send-signal', { roomId: roomFromUrl, signal }));
      peer.on('connect', () => setConnected(true));
      peer.on('data', handleIncomingData);
      socket.on('receive-signal', (data) => peer.signal(data.signal));
      peerRef.current = peer;
    } else {
      const newRoomId = Math.random().toString(36).substring(2, 8);
      setRoomId(newRoomId);
      socket.emit('join-room', newRoomId);

      socket.on('receive-signal', (data) => {
        if (!peerRef.current) {
          const peer = new Peer({ initiator: false, trickle: false, config: iceServersConfig });
          peer.on('signal', (signal) => socket.emit('send-signal', { roomId: newRoomId, signal }));
          peer.on('connect', () => setConnected(true));
          peer.on('data', handleIncomingData);
          peerRef.current = peer;
        }
        peerRef.current.signal(data.signal);
      });
    }

    return () => socket.off('receive-signal');
  }, [currentView]);

  const sendMessage = () => {
    if (peerRef.current && message.trim()) {
      peerRef.current.send(JSON.stringify({ type: 'text', content: message }));
      setReceivedItems(prev => [{ kind: 'text', content: message, type: 'sent' }, ...prev]);
      setMessage('');
    }
  };

  const sendFile = () => {
    if (peerRef.current && selectedFile) {
      peerRef.current.send(JSON.stringify({
        type: 'file-meta',
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        fileType: selectedFile.type,
      }));

      let offset = 0;
      const readSlice = () => {
        const slice = selectedFile.slice(offset, offset + CHUNK_SIZE);
        const reader = new FileReader();
        reader.onload = (e) => {
          peerRef.current.send(e.target.result); 
          offset += e.target.result.byteLength;
          const progress = Math.round((offset / selectedFile.size) * 100);
          setTransferProgress(progress);

          if (offset < selectedFile.size) {
            setTimeout(readSlice, 4); 
          } else {
            setReceivedItems(prev => [{ 
                kind: 'file', 
                name: selectedFile.name, 
                size: (selectedFile.size / 1024).toFixed(1),
                type: 'sent' 
            }, ...prev]);
            setSelectedFile(null); 
            setTransferProgress(0);
          }
        };
        reader.readAsArrayBuffer(slice);
      };
      readSlice(); 
    }
  };

  // Drag and Drop
  const onDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const link = `${window.location.origin}/?room=${roomId}`;

  return (
    <div className="min-h-screen w-full bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-300">
      
      {/* Navigation (Transparent) */}
      <nav className="w-full px-6 py-6 lg:px-12 flex items-center justify-between z-50 bg-transparent">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setCurrentView('landing')}>
            <div className="bg-purple-600 p-2 rounded-xl text-white">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z"/>
                    <path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10"/>
                </svg>
            </div>
            <span className="font-extrabold text-2xl tracking-tight">FDrop</span>
        </div>
        
        <button onClick={() => setDarkMode(!darkMode)} className="p-2.5 rounded-xl bg-purple-50 hover:bg-purple-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-purple-600 dark:text-purple-400 transition-all focus:outline-none">
            {darkMode ? (
                <svg className="w-6 h-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
            ) : (
                <svg className="w-6 h-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
            )}
        </button>
      </nav>

      {/* Main Content */}
      <main className="flex-1 w-full flex flex-col justify-center items-center px-4 py-8 lg:py-0">
        
        {/* Landing View */}
        {currentView === 'landing' && (
            <section className="w-full flex flex-col items-center text-center max-w-2xl px-4 animate-[fadeIn_0.5s_ease-out]">
                <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
                    Share Files <br className="md:hidden" />
                    <span className="text-purple-600 dark:text-purple-500">Instantly.</span>
                </h1>
                
                <p className="text-lg md:text-xl text-slate-600 dark:text-slate-400 mb-12 max-w-xl leading-relaxed">
                    Connect your devices in seconds. No cables, no limits. Scan the QR code to create a secure peer-to-peer room.
                </p>
                
                <button onClick={() => setCurrentView('room')} className="px-10 py-4 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-2xl text-lg transition-all shadow-lg shadow-purple-600/30 hover:shadow-purple-600/50 flex items-center gap-3">
                    Start Connection
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                    </svg>
                </button>
            </section>
        )}

        {/* Room View */}
        {currentView === 'room' && (
            <section className="w-full max-w-5xl animate-[fadeIn_0.4s_ease-out]">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold">Transfer Room</h2>
                    <span className={`px-4 py-1.5 rounded-full text-sm font-bold flex items-center gap-2 ${connected ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'}`}>
                        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`}></span>
                        {connected ? 'Connected' : 'Waiting...'}
                    </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    
                    {/* Left Panel: QR Code / Status */}
                    <div className="lg:col-span-1 bg-purple-50/50 dark:bg-slate-900/50 border border-purple-100 dark:border-slate-800 rounded-3xl p-8 flex flex-col items-center text-center shadow-sm">
                        <div className="w-16 h-16 bg-purple-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-6 text-purple-600 dark:text-purple-400">
                           <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>
                        </div>
                        <h3 className="font-bold text-xl mb-3">{connected ? 'Devices Paired' : 'Pair Device'}</h3>
                        <p className="text-slate-500 dark:text-slate-400 mb-8 text-sm leading-relaxed">
                            {connected ? 'Secure P2P connection established. Ready to transfer.' : "Scan this QR code with your phone to join the secure room."}
                        </p>
                        
                        {!connected && !window.location.search.includes('room') && (
                            <div className="bg-white p-5 rounded-2xl shadow-sm border border-purple-100 dark:border-none mb-4">
                                <QRCodeSVG value={link} size={160} className="w-full h-auto" />
                            </div>
                        )}
                    </div>
                    
                    {/* Right Panel: Upload & Chat */}
                    <div className="lg:col-span-2 flex flex-col gap-6">
                        
                        {/* Drag & Drop Area */}
                        <div 
                            className={`border-2 border-dashed rounded-3xl p-10 flex flex-col items-center justify-center text-center transition-all duration-300 min-h-[280px] ${isDragging ? 'border-purple-600 bg-purple-50 dark:bg-purple-900/20 scale-[1.02]' : 'border-purple-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 hover:border-purple-400'}`}
                            onDragOver={onDragOver}
                            onDragLeave={onDragLeave}
                            onDrop={onDrop}
                        >
                            {!selectedFile ? (
                                <>
                                    <div className="p-5 bg-purple-50 dark:bg-slate-800 rounded-full mb-5 text-purple-600 dark:text-purple-400">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>
                                        </svg>
                                    </div>
                                    <h3 className="text-xl font-bold mb-2">Upload File</h3>
                                    <p className="text-slate-500 dark:text-slate-400 mb-8 text-sm">Drag and drop documents here, or click to browse</p>
                                    
                                    <input type="file" id="file-upload" className="hidden" onChange={(e) => setSelectedFile(e.target.files[0])} />
                                    <button onClick={() => document.getElementById('file-upload').click()} className="px-8 py-3.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors">
                                        Select File
                                    </button>
                                </>
                            ) : (
                                <div className="flex flex-col items-center gap-6 w-full max-w-md">
                                    <div className="w-full bg-purple-50 dark:bg-slate-800 p-4 rounded-xl flex items-center justify-between border border-purple-100 dark:border-slate-700">
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <span className="text-2xl">📄</span>
                                            <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">{selectedFile.name}</span>
                                        </div>
                                        <span className="text-xs font-bold text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-slate-700 px-2 py-1 rounded-md shrink-0">
                                            {(selectedFile.size / 1024).toFixed(1)} KB
                                        </span>
                                    </div>

                                    {transferProgress > 0 && (
                                        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
                                            <div className="bg-purple-600 h-full rounded-full transition-all duration-300" style={{ width: `${transferProgress}%` }}></div>
                                        </div>
                                    )}

                                    <div className="flex gap-4 w-full">
                                        <button onClick={() => setSelectedFile(null)} className="flex-1 py-3.5 border-2 border-slate-200 dark:border-slate-700 font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                                            Cancel
                                        </button>
                                        <button onClick={sendFile} disabled={!connected} className="flex-1 py-3.5 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-purple-600/20">
                                            {transferProgress > 0 ? `${transferProgress}%` : 'Send File'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Chat Box */}
                        <div className="flex gap-3 bg-purple-50/50 dark:bg-slate-900/50 p-3 rounded-2xl border border-purple-100 dark:border-slate-800 shadow-sm">
                            <input 
                                type="text" value={message} onChange={(e) => setMessage(e.target.value)} 
                                placeholder="Type a message..." 
                                className="flex-1 bg-transparent px-4 py-2 outline-none dark:text-white placeholder-slate-400"
                                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                            />
                            <button onClick={sendMessage} disabled={!message.trim() || !connected} className="px-6 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold disabled:opacity-50 transition-colors">
                                Send
                            </button>
                        </div>

                        {/* History */}
                        {receivedItems.length > 0 && (
                            <div className="bg-white dark:bg-slate-900/50 border border-purple-100 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
                                <h4 className="font-bold text-sm text-slate-400 uppercase tracking-widest mb-4">History</h4>
                                <ul className="space-y-3 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                                    {receivedItems.map((item, idx) => (
                                        <li key={idx} className="flex items-center justify-between p-4 bg-purple-50/50 dark:bg-slate-800/50 rounded-2xl border border-purple-100/50 dark:border-slate-700/50">
                                            <div className="flex items-center gap-4 overflow-hidden">
                                                <div className="p-2.5 bg-white dark:bg-slate-700 rounded-xl shadow-sm shrink-0 text-xl">
                                                    {item.kind === 'file' ? '📄' : '💬'}
                                                </div>
                                                <div className="truncate">
                                                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{item.kind === 'file' ? item.name : item.content}</p>
                                                    {item.kind === 'file' && <p className="text-xs text-slate-500 font-medium mt-0.5">{item.size} KB</p>}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <div className={`text-xs font-bold px-3 py-1.5 rounded-lg ${item.type === 'sent' ? 'text-purple-600 bg-purple-100 dark:bg-purple-900/30' : 'text-blue-600 bg-blue-100 dark:bg-blue-900/30'}`}>
                                                    {item.type === 'sent' ? 'Sent' : 'Received'}
                                                </div>
                                                {item.kind === 'file' && item.type === 'received' && (
                                                    <a href={item.url} download={item.name} className="text-xs font-bold bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2 rounded-lg hover:opacity-90 transition-opacity">
                                                        Save
                                                    </a>
                                                )}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            </section>
        )}

      </main>

      {/* Footer (Transparent) */}
      <footer className="w-full py-6 mt-auto bg-transparent">
        <div className="flex justify-center items-center">
            <p className="text-sm font-medium text-slate-400 dark:text-slate-500">
                &copy; 2026 FDrop Developed by : AMTRIF Ayman
            </p>
        </div>
      </footer>
    </div>
  );
}