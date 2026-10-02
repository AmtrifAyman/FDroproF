import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import Peer from 'simple-peer';
import { QRCodeSVG } from 'qrcode.react';

// 1. HNA 7ET LIEN DYAL RAILWAY (bla / f l-kher)
const socket = io('fdropro-production.up.railway.app'); 

const CHUNK_SIZE = 16 * 1024; // 16 KB

// 2. Hado homa li gha ykhliw l-app tkhdem f Wi-Fi l-madrasa
const iceServersConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ]
};

function App() {
  const [roomId, setRoomId] = useState('');
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [receivedItems, setReceivedItems] = useState([]);
  const [transferProgress, setTransferProgress] = useState(0);
  
  const peerRef = useRef(null); 
  const fileMetaRef = useRef(null);
  const fileChunksRef = useRef([]); 
  const receivedSizeRef = useRef(0);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');

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
            size: (fileMetaRef.current.fileSize / 1024).toFixed(1)
          };
          setReceivedItems(prev => [...prev, completedFile]);
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
          setReceivedItems(prev => [...prev, { kind: 'text', content: `L-Akhar: ${parsed.content}` }]);
        }
      } catch (e) {}
    };

    if (roomFromUrl) {
      setRoomId(roomFromUrl);
      socket.emit('join-room', roomFromUrl);
      
      // Zdna STUN Servers Hna
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
          // Zdna STUN Servers Hna 7ta howa
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
  }, []);

  const sendMessage = () => {
    if (peerRef.current && message) {
      peerRef.current.send(JSON.stringify({ type: 'text', content: message }));
      setReceivedItems(prev => [...prev, { kind: 'text', content: `Ana: ${message}` }]);
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
          if (offset < selectedFile.size) {
            setTimeout(readSlice, 4); 
          } else {
            setReceivedItems(prev => [...prev, { kind: 'text', content: `✅ Tsayft l-fichier: ${selectedFile.name}` }]);
            setSelectedFile(null); 
          }
        };
        reader.readAsArrayBuffer(slice);
      };
      readSlice(); 
    }
  };

  const link = `${window.location.origin}/?room=${roomId}`;

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc', padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto', background: '#1e293b', padding: '25px', borderRadius: '15px', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' }}>
        <h1 style={{ textAlign: 'center', color: '#38bdf8', marginBottom: '20px' }}>🚀 QR Share P2P</h1>
        {!connected ? (
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#94a3b8' }}>Kantsnaw connection... Room ID: <strong style={{ color: '#38bdf8' }}>{roomId}</strong></p>
            {!window.location.search.includes('room') && (
               <div style={{ marginTop: '20px', padding: '20px', background: '#334155', borderRadius: '10px', display: 'inline-block' }}>
                  <p style={{ marginBottom: '15px', fontSize: '14px' }}>Skani had QR Code b telephone awla fta7 l-lien:</p>
                  <div style={{ background: '#fff', padding: '10px', display: 'inline-block', borderRadius: '8px' }}>
                    <QRCodeSVG value={link} size={180} />
                  </div>
               </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ background: '#065f46', color: '#d1fae5', padding: '10px 15px', borderRadius: '8px', marginBottom: '20px', textAlign: 'center', fontWeight: 'bold' }}>
              ✅ Mconnecter Directement (P2P)!
            </div>
            
            {transferProgress > 0 && (
              <div style={{ marginBottom: '15px', background: '#334155', padding: '10px', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 5px 0', fontSize: '13px' }}>Katstqbel ficher... {transferProgress}%</p>
                <div style={{ width: '100%', background: '#475569', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ width: `${transferProgress}%`, background: '#38bdf8', height: '100%', transition: 'width 0.1s' }}></div>
                </div>
              </div>
            )}

            <div style={{ height: '250px', overflowY: 'auto', background: '#0f172a', padding: '15px', borderRadius: '8px', border: '1px solid #334155', marginBottom: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
               {receivedItems.length === 0 && <p style={{ color: '#64748b', textAlign: 'center', margin: 'auto' }}>Ba9i ma tsayft ta 7aja...</p>}
               {receivedItems.map((item, i) => (
                  <div key={i}>
                     {item.kind === 'text' ? (
                        <div style={{ background: '#334155', padding: '8px 12px', borderRadius: '6px', maxWidth: '80%', wordBreak: 'break-word' }}>
                          {item.content}
                        </div>
                     ) : (
                        <div style={{ background: '#064e3b', border: '1px solid #059669', padding: '10px 15px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                           <div>
                             <p style={{ margin: '0 0 3px 0', fontWeight: 'bold', color: '#34d399' }}>📄 {item.name}</p>
                             <span style={{ fontSize: '12px', color: '#94a3b8' }}>{item.size} KB</span>
                           </div>
                           <a href={item.url} download={item.name} style={{ background: '#10b981', color: '#fff', padding: '6px 12px', borderRadius: '5px', textDecoration: 'none', fontSize: '13px', fontWeight: 'bold' }}>
                              Télécharger 📥
                           </a>
                        </div>
                     )}
                  </div>
               ))}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
              <input type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Kteb message..." style={{ flex: 1, background: '#0f172a', border: '1px solid #475569', color: '#fff', padding: '10px', borderRadius: '6px', outline: 'none' }} />
              <button onClick={sendMessage} style={{ background: '#0284c7', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Sift</button>
            </div>

            <div style={{ borderTop: '1px solid #334155', paddingTop: '15px', display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input type="file" onChange={(e) => setSelectedFile(e.target.files[0])} style={{ color: '#94a3b8', fontSize: '13px', flex: 1 }} />
              <button onClick={sendFile} disabled={!selectedFile} style={{ background: selectedFile ? '#10b981' : '#475569', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '6px', cursor: selectedFile ? 'pointer' : 'not-allowed', fontWeight: 'bold' }}>Sift Fichier 📁</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;