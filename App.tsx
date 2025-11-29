
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DataConnection, MediaConnection, PeerInstance, NetworkMessage, LogEntry, ChatMessage, DeviceInfo, RemotePeer, ActivityMessage, DrawLine, QueueItem } from './types';

// --- Assets & Constants ---
const SOUND_RINGTONE = "/ringtone.mp3"; 
const SOUND_JOIN = "https://cdn.pixabay.com/download/audio/2022/03/24/audio_7811d73967.mp3";
const SOUND_LEAVE = "https://cdn.pixabay.com/download/audio/2021/08/04/audio_c6ccf3232f.mp3";
const SOUND_MESSAGE = "https://cdn.pixabay.com/download/audio/2021/08/04/audio_12b0c7443c.mp3";
const SOUND_UI_ON = "https://cdn.pixabay.com/download/audio/2022/03/24/audio_c8c8a73467.mp3"; // Click/On
const SOUND_UI_OFF = "https://cdn.pixabay.com/download/audio/2022/03/24/audio_1020476839.mp3"; // Click/Off
const SOUND_ENTER_ROOM = "https://cdn.pixabay.com/download/audio/2022/03/15/audio_762635987a.mp3"; // Space swoosh

const MAX_PEERS_LIMIT = 3; 
const WB_COLORS = [
    '#000000', '#57534e', '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', 
    '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e', '#881337'
];

// --- YouTube API Helper ---
const loadYouTubeAPI = (callback: () => void) => {
  if (window.YT && window.YT.Player) {
    callback();
    return;
  }
  const tag = document.createElement('script');
  tag.src = "https://www.youtube.com/iframe_api";
  const firstScriptTag = document.getElementsByTagName('script')[0];
  firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
  window.onYouTubeIframeAPIReady = callback;
};

const getYoutubeId = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
};

// Fetch real metadata without API Key using oEmbed
const fetchVideoMeta = async (videoId: string) => {
    try {
        const response = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
        const data = await response.json();
        return {
            title: data.title || "Vidéo YouTube",
            thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
        };
    } catch (e) {
        return { title: "Vidéo YouTube", thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` };
    }
};

export default function App() {
  // --- View State ---
  const [viewState, setViewState] = useState<'login' | 'lobby' | 'room'>('login');
  const [isTransitioning, setIsTransitioning] = useState(false);

  // --- Identity ---
  const [username, setUsername] = useState(''); 
  const [displayName, setDisplayName] = useState(''); 
  const [peerId, setPeerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  
  // --- Room Configuration ---
  const [remoteIdInput, setRemoteIdInput] = useState('');
  const [roomCapacity, setRoomCapacity] = useState(4); 
  const [peers, setPeers] = useState<Map<string, RemotePeer>>(new Map());
  const [incomingCall, setIncomingCall] = useState<{ call: MediaConnection, metadata?: any } | null>(null);
  const [isWaitingForHost, setIsWaitingForHost] = useState(false);

  // --- Local Media ---
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [processedStream, setProcessedStream] = useState<MediaStream | null>(null); 
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [myCurrentActivity, setMyCurrentActivity] = useState<'none' | 'youtube' | 'whiteboard'>('none');
  
  // --- Audio Settings ---
  const [inputDevices, setInputDevices] = useState<DeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<DeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>('');
  const [selectedCamId, setSelectedCamId] = useState<string>('');
  const [selectedSpeakerId, setSelectedSpeakerId] = useState<string>('');
  const [micGain, setMicGain] = useState(1); 
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showMobileChat, setShowMobileChat] = useState(false);

  // --- Context Menu (Volume) ---
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, peerId: string } | null>(null);

  // --- Refs ---
  const isMutedRef = useRef(isMuted);
  const isDeafenedRef = useRef(isDeafened);
  const isVideoEnabledRef = useRef(isVideoEnabled);
  const isScreenSharingRef = useRef(isScreenSharing);
  const displayNameRef = useRef(displayName);
  const myActivityRef = useRef(myCurrentActivity);
  const localAvatarRef = useRef<string | null>(null);
  const peersRef = useRef<Map<string, RemotePeer>>(new Map());
  const roomCapacityRef = useRef(roomCapacity);

  // Sync refs
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { isDeafenedRef.current = isDeafened; }, [isDeafened]);
  useEffect(() => { isVideoEnabledRef.current = isVideoEnabled; }, [isVideoEnabled]);
  useEffect(() => { isScreenSharingRef.current = isScreenSharing; }, [isScreenSharing]);
  useEffect(() => { displayNameRef.current = displayName; }, [displayName]);
  useEffect(() => { peersRef.current = peers; }, [peers]);
  useEffect(() => { roomCapacityRef.current = roomCapacity; }, [roomCapacity]);
  useEffect(() => { myActivityRef.current = myCurrentActivity; }, [myCurrentActivity]);

  // --- UI State ---
  const [pinnedView, setPinnedView] = useState<'local' | 'activity' | string | null>(null); 
  
  // --- Activity State (SHARED & LOCAL) ---
  const [activityView, setActivityView] = useState<{ type: 'youtube' | 'whiteboard' } | null>(null);
  const [showActivityModal, setShowActivityModal] = useState(false);
  
  // YouTube State
  const [youtubeInput, setYoutubeInput] = useState('');
  const [youtubeQueue, setYoutubeQueue] = useState<QueueItem[]>([]);
  const [currentVideo, setCurrentVideo] = useState<QueueItem | null>(null);
  
  // Whiteboard State
  const [wbColor, setWbColor] = useState('#000000');
  const [wbSize, setWbSize] = useState(3);
  const [wbIsEraser, setWbIsEraser] = useState(false);
  const [wbPageIndex, setWbPageIndex] = useState(0);
  const wbHistoryRef = useRef<Map<number, DrawLine[]>>(new Map());

  // YouTube Refs
  const playerRef = useRef<any>(null); 
  const isRemoteUpdateRef = useRef(false); 
  
  // Audio Analysis Refs
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);
  const [localAvatar, setLocalAvatar] = useState<string | null>(null);
  
  // --- Chat & Logs ---
  const [messageInput, setMessageInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // --- Core Refs ---
  const peerRef = useRef<PeerInstance | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const mediaUploadRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Audio Processing Refs
  const localAudioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const peerAnalysersRef = useRef<Map<string, AnalyserNode>>(new Map());

  // --- Effects ---
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, showMobileChat]);

  // Whiteboard Page Redraw Effect
  useEffect(() => {
      if (activityView?.type === 'whiteboard' && canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
              ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
              const history = wbHistoryRef.current.get(wbPageIndex) || [];
              history.forEach(line => drawOnCanvas(line, canvasRef.current!));
          }
      }
  }, [wbPageIndex, activityView]);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // --- AUDIO ENGINE ---

  const setupAudioGraph = (stream: MediaStream): MediaStream => {
      if (!stream.getAudioTracks().length) return stream;

      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!localAudioCtxRef.current) localAudioCtxRef.current = new AudioContext();
      const ctx = localAudioCtxRef.current;
      if(ctx.state === 'suspended') ctx.resume();

      const source = ctx.createMediaStreamSource(stream);
      const gainNode = ctx.createGain();
      gainNode.gain.value = micGain;
      gainNodeRef.current = gainNode;

      const dest = ctx.createMediaStreamDestination();

      source.connect(gainNode);
      gainNode.connect(dest);

      // Add local analyzer
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      gainNode.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const checkVolume = () => {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const average = sum / dataArray.length;
          setIsLocalSpeaking(average > 10);
          requestAnimationFrame(checkVolume);
      };
      checkVolume();

      const newStream = dest.stream;
      stream.getVideoTracks().forEach(track => newStream.addTrack(track));
      setProcessedStream(newStream);
      return newStream;
  };

  const loadDevices = async () => {
      try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          setInputDevices(devices.filter(d => d.kind === 'audioinput').map(d => ({ deviceId: d.deviceId, label: d.label || `Microphone` })));
          setOutputDevices(devices.filter(d => d.kind === 'audiooutput').map(d => ({ deviceId: d.deviceId, label: d.label || `Speaker` })));
      } catch (e) { console.error("Error loading devices", e); }
  };

  const changeAudioInput = async (deviceId: string) => {
      setSelectedMicId(deviceId);
      try {
          if(!localStream) return;
          const newStream = await navigator.mediaDevices.getUserMedia({ 
              audio: { deviceId: { exact: deviceId } },
              video: false
          });
          
          if (localStream.getVideoTracks().length > 0) {
              newStream.addTrack(localStream.getVideoTracks()[0]);
          }

          setLocalStream(newStream);
          const processed = setupAudioGraph(newStream);
          
          peersRef.current.forEach(peer => {
             if (peer.mediaCall && peer.mediaCall.peerConnection) {
                 const sender = peer.mediaCall.peerConnection.getSenders().find((s: any) => s.track && s.track.kind === 'audio');
                 if (sender) sender.replaceTrack(processed.getAudioTracks()[0]);
             }
          });
      } catch (e) { addLog("Erreur changement micro", "error"); }
  };

  useEffect(() => {
      if (gainNodeRef.current) gainNodeRef.current.gain.value = micGain;
  }, [micGain]);

  // --- ACTIONS ---
  const toggleMute = () => {
    const t = processedStream?.getAudioTracks()[0]; 
    if(t){
        t.enabled = !t.enabled; 
        const newState = !t.enabled;
        setIsMuted(newState); 
        playSound(newState ? SOUND_UI_OFF : SOUND_UI_ON);
        broadcastData({type:'status', muted:newState, deafened:isDeafened, videoEnabled:isVideoEnabled, isScreenSharing:isScreenSharing, currentActivity:myCurrentActivity});
    }
  };

  const toggleDeafen = () => {
      const newState = !isDeafened;
      setIsDeafened(newState);
      playSound(newState ? SOUND_UI_OFF : SOUND_UI_ON);
      broadcastData({type:'status', muted:isMuted, deafened:newState, videoEnabled:isVideoEnabled, isScreenSharing:isScreenSharing, currentActivity:myCurrentActivity});
  };

  const toggleVideo = async () => {
    if (!localStream) return;
    let videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) {
        try {
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            videoTrack = videoStream.getVideoTracks()[0];
            localStream.addTrack(videoTrack);
            if(processedStream) processedStream.addTrack(videoTrack);
            peersRef.current.forEach(peer => {
                 if (peer.mediaCall && peer.mediaCall.peerConnection) {
                     const sender = peer.mediaCall.peerConnection.getSenders().find((s: any) => s.track && s.track.kind === 'video');
                     if (sender) sender.replaceTrack(videoTrack);
                 }
             });
        } catch (e) { addLog("Caméra refusée ou indisponible", "error"); return; }
    }
    if(videoTrack){
        videoTrack.enabled = !videoTrack.enabled; 
        const newState = videoTrack.enabled;
        setIsVideoEnabled(newState);
        playSound(newState ? SOUND_UI_ON : SOUND_UI_OFF); 
        broadcastData({type:'status', videoEnabled:newState, muted:isMuted, deafened:isDeafened, isScreenSharing:isScreenSharing, currentActivity:myCurrentActivity});
    }
  };

  const toggleScreenShare = async () => {
      if (isScreenSharing) {
          try {
             const camStream = await navigator.mediaDevices.getUserMedia({ video: selectedCamId ? { deviceId: { exact: selectedCamId } } : true });
             const videoTrack = camStream.getVideoTracks()[0];
             if (!isVideoEnabled) videoTrack.enabled = false;
             if(localStream) {
                 localStream.getVideoTracks().forEach(t => localStream.removeTrack(t));
                 localStream.addTrack(videoTrack);
             }
             peersRef.current.forEach(peer => {
                 if (peer.mediaCall && peer.mediaCall.peerConnection) {
                     const sender = peer.mediaCall.peerConnection.getSenders().find((s: any) => s.track && s.track.kind === 'video');
                     if (sender) sender.replaceTrack(videoTrack);
                 }
             });
             setIsScreenSharing(false);
             playSound(SOUND_UI_OFF);
             broadcastData({type:'status', videoEnabled:isVideoEnabled, muted:isMuted, deafened:isDeafened, isScreenSharing:false, currentActivity:myCurrentActivity});
          } catch(e) { addLog("Erreur arrêt partage", "error"); }
      } else {
          try {
              const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
              const screenTrack = screenStream.getVideoTracks()[0];
              screenTrack.onended = () => { if (isScreenSharingRef.current) toggleScreenShare(); };
              peersRef.current.forEach(peer => {
                 if (peer.mediaCall && peer.mediaCall.peerConnection) {
                     const sender = peer.mediaCall.peerConnection.getSenders().find((s: any) => s.track && s.track.kind === 'video');
                     if (sender) sender.replaceTrack(screenTrack);
                 }
             });
             setIsScreenSharing(true);
             playSound(SOUND_UI_ON);
             broadcastData({type:'status', videoEnabled:true, muted:isMuted, deafened:isDeafened, isScreenSharing:true, currentActivity:myCurrentActivity});
          } catch(e) { addLog("Partage annulé", "info"); }
      }
  };

  // --- PEER MANAGEMENT ---

  const addPeer = (id: string, partialPeer: Partial<RemotePeer>) => {
      setPeers(prev => {
          const newMap = new Map<string, RemotePeer>(prev);
          const existing = newMap.get(id) || {
              id, displayName: 'Connexion...', status: { muted: false, deafened: false, videoEnabled: false, isScreenSharing: false },
              volume: 1, isSpeaking: false, currentActivity: 'none'
          } as RemotePeer;
          newMap.set(id, { ...existing, ...partialPeer });
          return newMap;
      });
  };

  const removePeer = (id: string) => {
      setPeers(prev => {
          const newMap = new Map<string, RemotePeer>(prev);
          const p = newMap.get(id);
          if (p) {
              if (p.mediaCall) p.mediaCall.close();
              if (p.dataConn) p.dataConn.close();
          }
          newMap.delete(id);
          return newMap;
      });
      if (peerAnalysersRef.current.has(id)) peerAnalysersRef.current.delete(id);
      setPinnedView(prev => (prev === id ? null : prev));
      playSound(SOUND_LEAVE);
      addLog("Un utilisateur a quitté le salon", "info");
      setIsWaitingForHost(false);
  };

  const broadcastData = (msg: NetworkMessage) => {
      peersRef.current.forEach(peer => {
          if (peer.dataConn && peer.dataConn.open) {
              peer.dataConn.send(msg);
          }
      });
  };

  // --- CONNECTION LOGIC ---

  const startRoomTransition = (capacity: number, mode?: 'cinema') => {
      setIsTransitioning(true);
      playSound(SOUND_ENTER_ROOM);
      setTimeout(() => {
          setRoomCapacity(capacity);
          setViewState('room');
          if(mode === 'cinema') {
              setTimeout(() => startYoutubeActivity(), 500);
          }
          setTimeout(() => setIsTransitioning(false), 500);
      }, 500);
  };

  const connectToPeer = (targetId: string) => {
      if (!peerRef.current || !localStream || peersRef.current.has(targetId) || targetId === peerId) return;
      setIsTransitioning(true);
      playSound(SOUND_ENTER_ROOM);
      
      setTimeout(() => {
          setViewState('room');
          setIsWaitingForHost(true);
          setTimeout(() => setIsTransitioning(false), 500);
          
          const streamToSend = processedStream || setupAudioGraph(localStream);
          const call = peerRef.current!.call(targetId, streamToSend, { metadata: { displayName: displayName, avatar: localAvatarRef.current } });
          const conn = peerRef.current!.connect(targetId, { metadata: { displayName: displayName, avatar: localAvatarRef.current } });
          addPeer(targetId, { displayName: 'Appel en cours...', mediaCall: call, dataConn: conn });
          setupCallEvents(call, targetId);
          setupDataEvents(conn, targetId);
      }, 500);
  };

  const setupCallEvents = (call: MediaConnection, remoteId: string) => {
      call.on('stream', (stream) => {
          addPeer(remoteId, { stream });
          setupRemoteAudioAnalyzer(remoteId, stream);
          setIsWaitingForHost(false); 
      });
      call.on('close', () => removePeer(remoteId));
      call.on('error', () => { removePeer(remoteId); setIsWaitingForHost(false); });
  };

  const setupDataEvents = (conn: DataConnection, remoteId: string) => {
      conn.on('open', () => {
          conn.send({ 
              type: 'status', 
              muted: isMutedRef.current, 
              deafened: isDeafenedRef.current,
              videoEnabled: isVideoEnabledRef.current,
              isScreenSharing: isScreenSharingRef.current,
              currentActivity: myActivityRef.current
          });
          conn.send({ type: 'profile-update', avatar: localAvatarRef.current, displayName: displayNameRef.current });
          playSound(SOUND_JOIN);
      });
      conn.on('data', (data: NetworkMessage) => {
          handleNetworkMessage(remoteId, data);
      });
      conn.on('close', () => removePeer(remoteId));
      conn.on('error', () => { removePeer(remoteId); });
  };

  const handleNetworkMessage = (senderId: string, data: NetworkMessage) => {
      switch (data.type) {
          case 'status':
              addPeer(senderId, { status: { muted: data.muted, deafened: data.deafened, videoEnabled: data.videoEnabled, isScreenSharing: data.isScreenSharing }, currentActivity: data.currentActivity || 'none' });
              break;
          case 'profile-update':
              addPeer(senderId, { displayName: data.displayName || 'Utilisateur', avatar: data.avatar });
              break;
          case 'chat':
              playSound(SOUND_MESSAGE);
              setChatHistory(prev => [...prev, { id: Date.now().toString(), sender: senderId, senderName: data.senderName, text: data.text, timestamp: Date.now() }]);
              break;
          case 'file-share':
              playSound(SOUND_MESSAGE);
              setChatHistory(prev => [...prev, { id: Date.now().toString(), sender: senderId, senderName: data.senderName, image: data.file, timestamp: Date.now() }]);
              break;
          case 'peer-list':
              data.peers.forEach(pid => {
                  if (pid !== peerId && !peersRef.current.has(pid)) connectToPeer(pid);
              });
              break;
          case 'activity':
              handleActivityMessage(senderId, data);
              break;
      }
  };

  // --- ACTIVITY HANDLERS ---
  const handleActivityMessage = (senderId: string, data: ActivityMessage) => {
    if (data.activityType === 'youtube' && activityView?.type === 'youtube') {
         if (data.action === 'sync-state' && playerRef.current) {
             isRemoteUpdateRef.current = true;
             const { playerState, currentTime } = data.data!;
             const myTime = playerRef.current.getCurrentTime();
             if (Math.abs(myTime - (currentTime || 0)) > 1.5) playerRef.current.seekTo(currentTime, true);
             if (playerState === 1 && playerRef.current.getPlayerState() !== 1) playerRef.current.playVideo();
             else if (playerState === 2) playerRef.current.pauseVideo();
             setTimeout(() => { isRemoteUpdateRef.current = false; }, 800);
         } else if (data.action === 'add-queue') {
             if(data.data?.queueItem) setYoutubeQueue(prev => [...prev, data.data!.queueItem!]);
         } else if (data.action === 'remove-queue') {
             if(data.data?.videoId) setYoutubeQueue(prev => prev.filter(i => i.id !== data.data!.videoId));
         } else if (data.action === 'play-queue') {
             if(data.data?.queueItem) {
                 setCurrentVideo(data.data.queueItem);
                 if(playerRef.current) playerRef.current.loadVideoById(data.data.queueItem.videoId);
             }
         } else if (data.action === 'update-queue') {
             if (data.data?.queue) setYoutubeQueue(data.data.queue);
         }
    } 
    else if (data.activityType === 'whiteboard') {
        if (activityView?.type !== 'whiteboard') return; 
        
        if (data.action === 'draw' && data.data?.drawData) {
            const page = data.data.pageIndex || 0;
            // Store in history
            if(!wbHistoryRef.current.has(page)) wbHistoryRef.current.set(page, []);
            wbHistoryRef.current.get(page)?.push(data.data.drawData);
            
            // Only draw if we are on the SAME page
            if (page === wbPageIndex && canvasRef.current) {
                drawOnCanvas(data.data.drawData, canvasRef.current);
            }
        } else if (data.action === 'clear') {
             if(canvasRef.current && wbPageIndex === wbPageIndex) {
                 const ctx = canvasRef.current.getContext('2d');
                 ctx?.clearRect(0,0, canvasRef.current.width, canvasRef.current.height);
             }
             wbHistoryRef.current.set(wbPageIndex, []);
        } else if (data.action === 'set-page' && typeof data.data?.pageIndex === 'number') {
             setWbPageIndex(data.data.pageIndex);
        } else if (data.action === 'sync-request') {
             const allHistory: any[] = [];
             wbHistoryRef.current.forEach((lines, page) => {
                 lines.forEach(line => {
                     allHistory.push({ action: 'draw', data: { drawData: line, pageIndex: page }});
                 });
             });
             const peer = peersRef.current.get(senderId);
             if (peer && peer.dataConn) {
                 allHistory.forEach(msg => {
                     peer.dataConn!.send({ type: 'activity', activityType: 'whiteboard', ...msg });
                 });
             }
        }
    }
  };

  // --- WHITEBOARD LOGIC ---
  const drawOnCanvas = (data: DrawLine, canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const x = data.x * w;
      const y = data.y * h;
      const px = data.prevX * w;
      const py = data.prevY * h;
      ctx.lineWidth = data.size;
      ctx.lineCap = 'round';
      ctx.strokeStyle = data.isEraser ? '#FFFFFF' : data.color;
      ctx.globalCompositeOperation = data.isEraser ? 'destination-out' : 'source-over';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
  };

  const startWhiteboard = () => {
    setActivityView({ type: 'whiteboard' });
    setPinnedView('activity');
    setMyCurrentActivity('whiteboard');
    broadcastData({ type: 'status', muted: isMuted, deafened: isDeafened, videoEnabled: isVideoEnabled, isScreenSharing: isScreenSharing, currentActivity: 'whiteboard' });
    if(!wbHistoryRef.current.has(0)) wbHistoryRef.current.set(0, []);
  };

  const downloadWhiteboard = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Create temp canvas to flatten with white background
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tCtx = tempCanvas.getContext('2d');
    if (!tCtx) return;
    
    // Fill white
    tCtx.fillStyle = '#FFFFFF';
    tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    // Draw original
    tCtx.drawImage(canvas, 0, 0);
    
    const link = document.createElement('a');
    link.download = `dessin-nexus-${wbPageIndex+1}.png`;
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
  };

  // --- YOUTUBE LOGIC ---
  const startYoutubeActivity = () => {
      setActivityView({ type: 'youtube' });
      setPinnedView('activity');
      setMyCurrentActivity('youtube');
      broadcastData({ type: 'status', muted: isMuted, deafened: isDeafened, videoEnabled: isVideoEnabled, isScreenSharing: isScreenSharing, currentActivity: 'youtube' });
  };

  const addToQueue = async () => {
      const id = getYoutubeId(youtubeInput);
      if (!id) return;
      
      const meta = await fetchVideoMeta(id);
      const newItem: QueueItem = {
          id: Date.now().toString(),
          videoId: id,
          title: meta.title,
          thumbnail: meta.thumbnail,
          addedBy: peerId || 'Moi',
          addedByName: displayName
      };

      setYoutubeQueue(prev => {
          const newQueue = [...prev, newItem];
          broadcastData({ type: 'activity', activityType: 'youtube', action: 'add-queue', data: { queueItem: newItem } });
          return newQueue;
      });
      setYoutubeInput('');

      // Auto play if first
      if (!currentVideo && youtubeQueue.length === 0) {
          playVideo(newItem);
      }
  };

  const playVideo = (item: QueueItem) => {
      setCurrentVideo(item);
      broadcastData({ type: 'activity', activityType: 'youtube', action: 'play-queue', data: { queueItem: item } });
      
      if(playerRef.current) { 
          playerRef.current.loadVideoById(item.videoId);
      } else {
          loadYouTubeAPI(() => {
              playerRef.current = new window.YT.Player('youtube-player', {
                  height: '100%', width: '100%', videoId: item.videoId,
                  playerVars: { 'playsinline': 1, 'controls': 1, 'enablejsapi': 1, 'origin': window.location.origin, 'rel': 0, 'modestbranding': 1 },
                  events: {
                      'onStateChange': (e:any) => {
                          if (isRemoteUpdateRef.current) return;
                          if ([1,2,3].includes(e.data)) {
                             broadcastData({ type: 'activity', action: 'sync-state', activityType: 'youtube', data: { playerState: e.data, currentTime: playerRef.current.getCurrentTime() } });
                          }
                          // Auto next
                          if (e.data === 0) {
                             // This part is tricky in P2P without a master. Let's let the user click next for now to avoid conflicts.
                          }
                      },
                  }
              });
          });
      }
  };

  const removeFromQueue = (itemId: string) => {
      setYoutubeQueue(prev => {
          const newQueue = prev.filter(i => i.id !== itemId);
          broadcastData({ type: 'activity', activityType: 'youtube', action: 'remove-queue', data: { videoId: itemId } });
          return newQueue;
      });
  };

  const moveQueueItem = (index: number, direction: 'up' | 'down') => {
      setYoutubeQueue(prev => {
          const newQueue = [...prev];
          if (direction === 'up' && index > 0) {
              [newQueue[index], newQueue[index - 1]] = [newQueue[index - 1], newQueue[index]];
          } else if (direction === 'down' && index < newQueue.length - 1) {
              [newQueue[index], newQueue[index + 1]] = [newQueue[index + 1], newQueue[index]];
          }
          broadcastData({ type: 'activity', activityType: 'youtube', action: 'update-queue', data: { queue: newQueue } });
          return newQueue;
      });
  };

  // --- AUDIO ANALYSIS (REMOTE) ---
  const setupRemoteAudioAnalyzer = (peerId: string, stream: MediaStream) => {
      const ctx = localAudioCtxRef.current; 
      if (!ctx) return;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128; 
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser); 
      peerAnalysersRef.current.set(peerId, analyser);
  };

  useEffect(() => {
      const loop = () => {
          if (peerAnalysersRef.current.size > 0) {
              const dataArray = new Uint8Array(128);
              setPeers(prev => {
                  let changed = false;
                  const newMap = new Map<string, RemotePeer>(prev);
                  newMap.forEach((peer, id) => {
                      const analyser = peerAnalysersRef.current.get(id);
                      if (analyser) {
                          analyser.getByteFrequencyData(dataArray);
                          let sum = 0;
                          for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
                          const avg = sum / dataArray.length;
                          if (peer.isSpeaking !== (avg > 5)) {
                              newMap.set(id, { ...peer, isSpeaking: avg > 5 });
                              changed = true;
                          }
                      }
                  });
                  return changed ? newMap : prev;
              });
          }
          requestAnimationFrame(loop);
      };
      const frame = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(frame);
  }, []);

  // --- HANDLERS ---
  const handleIncomingConnection = (conn: DataConnection) => {
      if (peersRef.current.size >= (roomCapacityRef.current - 1)) { conn.close(); return; }
      setupDataEvents(conn, conn.peer);
      const meta = conn.metadata || {};
      addPeer(conn.peer, { displayName: meta.displayName || 'Ami', avatar: meta.avatar, dataConn: conn });
      const currentPeerIds = Array.from(peersRef.current.keys());
      if (currentPeerIds.length > 0) {
          setTimeout(() => conn.send({ type: 'peer-list', peers: currentPeerIds }), 500);
      }
  };

  const handleIncomingCall = (call: MediaConnection) => {
      if (peersRef.current.size >= (roomCapacityRef.current - 1)) { call.close(); return; }
      setIncomingCall({ call, metadata: call.metadata });
      playSound(SOUND_RINGTONE);
  };

  const acceptCall = () => {
    if (!incomingCall || !localStream) return;
    const call = incomingCall.call;
    const meta = incomingCall.metadata || {};
    const streamToSend = processedStream || setupAudioGraph(localStream);
    call.answer(streamToSend);
    setupCallEvents(call, call.peer);
    addPeer(call.peer, { displayName: meta.displayName || 'Ami', avatar: meta.avatar, mediaCall: call });
    setIncomingCall(null);
  };

  const rejectCall = () => {
      if (incomingCall) {
          incomingCall.call.close();
          setIncomingCall(null);
      }
  };

  const leaveRoom = () => {
      setIsTransitioning(true);
      peersRef.current.forEach(peer => {
          if (peer.mediaCall) peer.mediaCall.close();
          if (peer.dataConn) peer.dataConn.close();
      });
      setTimeout(() => {
          setPeers(new Map());
          peerAnalysersRef.current.clear();
          setActivityView(null); setPinnedView(null);
          setViewState('lobby');
          setIsWaitingForHost(false);
          setIsTransitioning(false);
      }, 300);
      addLog("Déconnecté.", "info");
      playSound(SOUND_LEAVE);
  };

  // --- UI HELPERS ---
  const addLog = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    const id = Date.now();
    setLogs(prev => [...prev, { id, timestamp: new Date().toLocaleTimeString(), message, type }]);
    setTimeout(() => setLogs(prev => prev.filter(log => log.id !== id)), 4000);
  };
  const getInitials = (name: string) => name ? name.charAt(0).toUpperCase() : '?';
  const playSound = (src: string) => { const a = new Audio(src); a.volume = 0.5; a.play().catch(()=>{}); };

  // --- RENDER VIDEO ---
  const renderVideoUnit = (peer: RemotePeer | 'local') => {
      const isLocal = peer === 'local';
      if (!isLocal && (!peer || !peer.id)) return null;
      
      const id = isLocal ? peerId : peer.id;
      const display = isLocal ? displayName : peer.displayName;
      const avatar = isLocal ? localAvatar : peer.avatar;
      const stream = isLocal ? localStream : peer.stream;
      const status = isLocal ? { muted: isMuted, deafened: isDeafened, videoEnabled: isVideoEnabled, isScreenSharing: isScreenSharing } : peer.status;
      const speaking = isLocal ? isLocalSpeaking : peer.isSpeaking;
      const activity = isLocal ? myCurrentActivity : peer.currentActivity;

      return (
          <div className={`relative bg-[#1e1e1e] rounded-3xl overflow-hidden flex items-center justify-center group w-full h-full shadow-lg transition-all duration-500 ease-out-expo border border-white/5
               ${speaking ? 'border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.2)]' : ''}`}
               onDoubleClick={() => {
                   if(id) setPinnedView(pinnedView === id ? null : id);
               }}
               onContextMenu={!isLocal ? (e) => { e.preventDefault(); setContextMenu({x: e.clientX, y: e.clientY, peerId: peer.id}) } : undefined}
          >
              {(!status.videoEnabled && !status.isScreenSharing) && (
                  <div className={`w-28 h-28 rounded-full flex items-center justify-center overflow-hidden z-20 ${speaking ? 'ring-4 ring-cyan-500' : ''} transition-all duration-300 transform group-hover:scale-110`}>
                      {avatar ? <img src={avatar} className="w-full h-full object-cover"/> : 
                      <div className="w-full h-full bg-gradient-to-tr from-gray-700 to-gray-600 flex items-center justify-center text-4xl font-bold text-white">{getInitials(display)}</div>}
                  </div>
              )}
              
              <video 
                 ref={(el) => { 
                     if(el && stream) { 
                         el.srcObject = stream; 
                         el.muted = isLocal || isDeafened; 
                         if(!isLocal) {
                            el.volume = isDeafened ? 0 : peer.volume; 
                            if ('setSinkId' in el && selectedSpeakerId) (el as any).setSinkId(selectedSpeakerId);
                         }
                         el.play().catch(()=>{});
                     }
                 }}
                 autoPlay playsInline className={`absolute inset-0 w-full h-full bg-[#111] ${status.videoEnabled || status.isScreenSharing ? 'block' : 'hidden'} ${status.isScreenSharing ? 'object-contain' : (isLocal ? 'object-cover scale-x-[-1]' : 'object-cover')}`}
              />
              <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full text-white text-xs font-bold border border-white/5 flex items-center z-30 select-none">
                  {display}
                  {status.muted && <i className="fas fa-microphone-slash text-red-500 ml-2"></i>}
                  {status.deafened && <i className="fas fa-headphones-alt text-red-500 ml-2"></i>}
              </div>
              
              {!isLocal && activity !== 'none' && (
                  <div className="absolute top-4 right-4 flex flex-col items-end space-y-2 z-30">
                      <div className="bg-black/60 backdrop-blur px-3 py-1.5 rounded-full border border-white/10 text-xs font-bold text-white flex items-center">
                          <i className={`fas ${activity === 'youtube' ? 'fa-play text-red-500' : 'fa-pen text-cyan-500'} mr-2`}></i>
                          {activity === 'youtube' ? 'Regarde YouTube' : 'Dessine'}
                      </div>
                      {activityView?.type !== activity && (
                          <button onClick={() => { 
                               if (activity === 'whiteboard') {
                                   startWhiteboard();
                                   broadcastData({ type: 'activity', activityType: 'whiteboard', action: 'sync-request' });
                               } else if (activity === 'youtube') {
                                   startYoutubeActivity();
                               }
                           }} 
                           className="bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-1 rounded-full text-xs font-bold transition-transform hover:scale-105">
                           Rejoindre
                          </button>
                      )}
                  </div>
              )}
          </div>
      );
  };

  // --- RENDER MAIN ---
  
  // TRANSITION OVERLAY
  const transitionOverlay = (
      <div className={`fixed inset-0 bg-black z-[100] transition-opacity duration-500 pointer-events-none ${isTransitioning ? 'opacity-100' : 'opacity-0'}`}></div>
  );

  if (viewState === 'login') {
      return (
          <div className="h-screen flex items-center justify-center bg-[#09090b] font-sans text-white">
              {transitionOverlay}
              <div className="w-full max-w-sm bg-[#18181b] p-8 rounded-3xl border border-white/5 shadow-2xl animate-in fade-in zoom-in duration-700">
                  <div className="flex justify-center mb-8">
                      <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-black text-3xl shadow-white/20 shadow-lg">
                          <i className="fas fa-shapes"></i>
                      </div>
                  </div>
                  <h1 className="text-3xl font-bold text-center mb-2">Nexus</h1>
                  <p className="text-gray-500 text-center mb-8 text-sm">Communication simplifiée.</p>
                  <form onSubmit={(e) => {
                      e.preventDefault();
                      if (!username.trim()) return;
                      setIsLoading(true);
                      const myId = `${username.replace(/[^a-zA-Z0-9_-]/g, '')}-${Math.floor(Math.random() * 9000) + 1000}`;
                      setPeerId(myId); setDisplayName(username);
                      loadDevices().then(async () => {
                         try {
                             const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                             setLocalStream(stream);
                             setupAudioGraph(stream);
                             const peer = new window.Peer(myId);
                             peerRef.current = peer;
                             peer.on('open', () => { setIsLoading(false); setViewState('lobby'); });
                             peer.on('connection', handleIncomingConnection);
                             peer.on('call', handleIncomingCall);
                             peer.on('error', (e) => { addLog("Erreur connexion", "error"); setIsLoading(false); });
                         } catch(e) { setLoginError("Accès Micro requis"); setIsLoading(false); }
                      });
                  }}>
                      <input type="text" value={username} onChange={e=>setUsername(e.target.value)} className="w-full bg-[#27272a] border border-transparent focus:border-white/20 rounded-xl p-3 text-white placeholder-gray-500 focus:outline-none transition-all mb-4 text-center font-medium" placeholder="Pseudo" />
                      <button disabled={isLoading} className="w-full bg-white text-black py-3 rounded-xl font-bold hover:bg-gray-200 transition-all">
                        {isLoading ? "..." : "Commencer"}
                      </button>
                  </form>
                  {loginError && <p className="text-red-500 text-center mt-4 text-xs font-bold">{loginError}</p>}
              </div>
          </div>
      );
  }

  // LOBBY SCREEN
  if (viewState === 'lobby') {
      return (
          <div className="h-screen bg-[#09090b] flex overflow-hidden font-sans text-white selection:bg-white/20">
               {transitionOverlay}
               <div className="w-80 bg-[#121212] border-r border-white/5 p-6 flex flex-col z-20">
                   <div className="flex items-center space-x-4 mb-8">
                       <div className="w-14 h-14 rounded-full bg-[#27272a] p-0.5 cursor-pointer hover:ring-2 ring-white/20 transition-all" onClick={()=>fileInputRef.current?.click()}>
                           <div className="w-full h-full rounded-full overflow-hidden relative group">
                               {localAvatar ? <img src={localAvatar} className="w-full h-full object-cover"/> : <div className="w-full h-full flex items-center justify-center font-bold text-lg bg-[#3f3f46] text-white">{getInitials(displayName)}</div>}
                               <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><i className="fas fa-camera text-xs"></i></div>
                           </div>
                       </div>
                       <div>
                           <h2 className="font-bold text-sm">{displayName}</h2>
                           <div className="text-[10px] text-gray-500 font-mono bg-[#27272a] px-2 py-0.5 rounded mt-1 cursor-pointer flex items-center group" onClick={()=>{navigator.clipboard.writeText(peerId||''); addLog('Copié !', 'success')}}>
                               {peerId} <i className="fas fa-copy ml-1 opacity-0 group-hover:opacity-100"></i>
                           </div>
                       </div>
                   </div>
                   
                   <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-3">Connexion Rapide</h3>
                   <form onSubmit={(e)=>{ e.preventDefault(); if(remoteIdInput.trim() !== peerId) { connectToPeer(remoteIdInput.trim());} }} className="space-y-3">
                       <input type="text" value={remoteIdInput} onChange={e=>setRemoteIdInput(e.target.value)} placeholder="ID du salon..." className="w-full bg-[#27272a] rounded-lg p-2.5 text-xs focus:ring-1 ring-white/20 focus:outline-none transition-all" />
                       <button className="w-full bg-white text-black py-2.5 rounded-lg font-bold text-xs hover:bg-gray-200 transition-colors">
                           Rejoindre
                       </button>
                   </form>
                   <input type="file" ref={fileInputRef} onChange={e=>{ const f = e.target.files?.[0]; if(f){const r = new FileReader(); r.onloadend=()=>{localAvatarRef.current=r.result as string; setLocalAvatar(r.result as string);}; r.readAsDataURL(f);} }} className="hidden"/>
               </div>

               <div className="flex-1 p-8 md:p-12 overflow-y-auto bg-[#09090b]">
                   <div className="max-w-5xl mx-auto">
                       <header className="mb-12">
                           <h1 className="text-3xl font-bold mb-1">Espaces</h1>
                           <p className="text-gray-500 text-sm">Créez un salon instantané.</p>
                       </header>

                       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
                           {[
                               { t: "Duo", c: 2, icon: "fa-user", bg: "bg-[#18181b]" },
                               { t: "Squad", c: 3, icon: "fa-users", bg: "bg-[#18181b]" },
                               { t: "Full", c: 4, icon: "fa-globe", bg: "bg-[#18181b]" },
                               { t: "Ciné", c: 4, icon: "fa-play", mode: 'cinema', bg: "bg-[#27272a]" }
                           ].map((item, i) => (
                               <div key={i} onClick={()=>{ startRoomTransition(item.c, item.mode as any); }} 
                                    className={`${item.bg} hover:bg-[#3f3f46] border border-white/5 p-6 rounded-2xl cursor-pointer transition-all duration-300 hover:-translate-y-1 h-40 flex flex-col justify-between group shadow-lg`}>
                                   <div className="flex justify-between items-start">
                                       <div className="text-2xl text-white group-hover:text-white/80 transition-colors"><i className={`fas ${item.icon}`}></i></div>
                                       <span className="text-[10px] bg-black/20 px-2 py-0.5 rounded text-gray-400">{item.c} max</span>
                                   </div>
                                   <div>
                                       <h3 className="font-bold">{item.t}</h3>
                                   </div>
                               </div>
                           ))}
                       </div>

                       {/* NOUVEAUTÉS SECTION */}
                       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                           <div className="md:col-span-2 bg-gradient-to-br from-indigo-900/50 to-purple-900/50 rounded-3xl p-8 border border-white/5 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/20 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
                                <div className="relative z-10">
                                    <div className="inline-block bg-white/10 backdrop-blur px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide mb-4 text-purple-200">
                                        Nouveauté
                                    </div>
                                    <h3 className="text-2xl font-bold mb-2">Tableau Blanc 2.0</h3>
                                    <p className="text-gray-300 text-sm mb-6 max-w-md">
                                        Exprimez votre créativité sans limites. Dessinez à plusieurs en temps réel et exportez désormais vos créations sur fond blanc parfait.
                                    </p>
                                    <button onClick={()=>{ startRoomTransition(3); setTimeout(()=>startWhiteboard(), 600); }} className="bg-white text-black px-6 py-2 rounded-xl font-bold text-sm hover:bg-gray-100 transition-colors flex items-center">
                                        Essayer maintenant <i className="fas fa-arrow-right ml-2 text-xs"></i>
                                    </button>
                                </div>
                                <i className="fas fa-paint-brush absolute bottom-4 right-8 text-9xl text-white/5 group-hover:text-white/10 transition-colors rotate-12"></i>
                           </div>

                           <div className="bg-[#18181b] rounded-3xl p-6 border border-white/5 flex flex-col justify-between">
                               <div>
                                   <h3 className="font-bold text-lg mb-1">Widget</h3>
                                   <p className="text-gray-500 text-xs">État des services</p>
                               </div>
                               <div className="space-y-3 mt-4">
                                   <div className="flex items-center justify-between text-xs">
                                       <span className="text-gray-400 flex items-center"><i className="fas fa-circle text-green-500 text-[8px] mr-2"></i> P2P Mesh</span>
                                       <span className="font-mono text-green-400">Actif</span>
                                   </div>
                                   <div className="flex items-center justify-between text-xs">
                                       <span className="text-gray-400 flex items-center"><i className="fas fa-circle text-green-500 text-[8px] mr-2"></i> Audio HQ</span>
                                       <span className="font-mono text-green-400">Prêt</span>
                                   </div>
                                   <div className="w-full bg-white/5 h-1.5 rounded-full mt-2 overflow-hidden">
                                       <div className="bg-green-500 h-full w-2/3 animate-pulse"></div>
                                   </div>
                               </div>
                           </div>
                       </div>
                   </div>
               </div>
          </div>
      );
  }

  // ROOM SCREEN
  const activePeers = Array.from(peers.values()) as RemotePeer[];
  
  if (isWaitingForHost) {
      return (
          <div className="h-screen bg-[#09090b] flex flex-col items-center justify-center text-white">
               {transitionOverlay}
               <div className="w-12 h-12 border-2 border-white/20 border-t-white rounded-full animate-spin mb-6"></div>
               <h2 className="text-lg font-bold mb-1">Connexion...</h2>
               <p className="text-gray-500 text-sm mb-6">Attente de l'hôte.</p>
               <button onClick={()=>{ leaveRoom(); }} className="text-red-500 hover:text-red-400 text-sm font-bold transition-colors">Annuler</button>
          </div>
      );
  }
  
  return (
    <div className="flex h-screen bg-[#09090b] overflow-hidden text-white font-sans" onContextMenu={e => e.preventDefault()}>
       {transitionOverlay}
       {contextMenu && (
           <div className="fixed z-[100] bg-[#18181b] border border-white/10 rounded-xl p-3 shadow-xl w-48" style={{top: contextMenu.y, left: contextMenu.x}}>
               <div className="text-[10px] font-bold text-gray-500 uppercase mb-2 px-1">Volume Local</div>
               <input 
                  type="range" min="0" max="1" step="0.1" 
                  defaultValue={peers.get(contextMenu.peerId)?.volume || 1}
                  onChange={(e) => {
                      const vol = parseFloat(e.target.value);
                      addPeer(contextMenu.peerId, { volume: vol });
                  }}
                  className="w-full accent-white h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
               />
           </div>
       )}

        {/* Settings Modal */}
        {showSettingsModal && (
            <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={()=>setShowSettingsModal(false)}>
                <div className="bg-[#18181b] p-6 rounded-2xl w-full max-w-md border border-white/10 shadow-2xl" onClick={e=>e.stopPropagation()}>
                    <h3 className="text-xl font-bold mb-4">Paramètres</h3>
                    <div className="space-y-4">
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Microphone</label>
                            <select value={selectedMicId} onChange={e=>changeAudioInput(e.target.value)} className="w-full bg-[#27272a] text-white rounded-lg p-2 text-sm outline-none">
                                <option value="">Défaut</option>
                                {inputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Volume Gain</label>
                            <input type="range" min="0" max="2" step="0.1" value={micGain} onChange={e=>setMicGain(parseFloat(e.target.value))} className="w-full accent-white"/>
                        </div>
                        <div className="pt-2 border-t border-white/5">
                            <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Pseudo</label>
                            <div className="flex space-x-2">
                                <input type="text" value={displayName} onChange={e=>setDisplayName(e.target.value)} className="flex-1 bg-[#27272a] rounded-lg p-2 text-sm" />
                                <button onClick={()=>{broadcastData({type:'profile-update', displayName:displayName, avatar:localAvatarRef.current}); setShowSettingsModal(false);}} className="bg-white text-black px-4 rounded-lg font-bold text-xs">OK</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )}

       {/* Activity Selection Modal */}
       {showActivityModal && (
           <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={()=>setShowActivityModal(false)}>
               <div className="bg-[#18181b] p-6 rounded-2xl w-full max-w-sm border border-white/10" onClick={e=>e.stopPropagation()}>
                   <h3 className="text-lg font-bold mb-4 text-center">Activités</h3>
                   <div className="grid grid-cols-2 gap-3">
                       <button onClick={()=>{ startYoutubeActivity(); setShowActivityModal(false); }} className="bg-[#27272a] hover:bg-[#3f3f46] p-4 rounded-xl flex flex-col items-center transition-colors">
                           <i className="fab fa-youtube text-2xl text-red-500 mb-2"></i>
                           <span className="font-bold text-sm">YouTube</span>
                       </button>
                       <button onClick={()=>{ startWhiteboard(); setShowActivityModal(false); }} className="bg-[#27272a] hover:bg-[#3f3f46] p-4 rounded-xl flex flex-col items-center transition-colors">
                           <i className="fas fa-pen-nib text-2xl text-blue-500 mb-2"></i>
                           <span className="font-bold text-sm">Dessin</span>
                       </button>
                   </div>
               </div>
           </div>
       )}

       {/* Main View */}
       <div className="flex-1 flex flex-col relative bg-[#09090b]">
          
          <div className="h-16 flex items-center justify-between px-6 z-20 pointer-events-none">
               <div className="pointer-events-auto bg-[#18181b] px-3 py-1.5 rounded-full flex items-center space-x-2 hover:bg-[#27272a] transition-colors cursor-pointer border border-white/5" onClick={()=>navigator.clipboard.writeText(peerId||'')}>
                   <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                   <span className="font-mono text-xs font-bold text-gray-300">{peerId}</span>
               </div>
               <div className="pointer-events-auto flex space-x-2">
                   <button onClick={()=>setShowSettingsModal(true)} className="w-8 h-8 bg-[#18181b] rounded-full flex items-center justify-center border border-white/5 hover:bg-white hover:text-black transition-colors text-xs"><i className="fas fa-cog"></i></button>
               </div>
          </div>

          <div className="flex-1 px-6 pb-6 flex items-center justify-center relative">
              
              {/* Activity View (Pinned) */}
              {activityView && pinnedView === 'activity' && (
                  <div className="absolute inset-4 z-10 bg-[#121212] rounded-2xl border border-white/5 overflow-hidden shadow-2xl flex flex-col animate-in zoom-in duration-300">
                      <div className="h-10 bg-[#18181b] flex items-center justify-between px-4 border-b border-white/5">
                          <span className="font-bold text-xs text-gray-400">
                              {activityView.type === 'youtube' ? 'YouTube' : 'Whiteboard'}
                          </span>
                          <button onClick={()=>{setActivityView(null); setPinnedView(null); setMyCurrentActivity('none'); broadcastData({type:'status', muted:isMuted, deafened:isDeafened, videoEnabled:isVideoEnabled, isScreenSharing:isScreenSharing, currentActivity:'none'})}} className="text-gray-500 hover:text-red-500 transition-colors"><i className="fas fa-times"></i></button>
                      </div>
                      
                      <div className="flex-1 flex overflow-hidden">
                          {/* YOUTUBE UI */}
                          {activityView.type === 'youtube' && (
                              <div className="flex w-full h-full">
                                  {/* Player Section */}
                                  <div className="flex-1 flex flex-col bg-black">
                                       {currentVideo ? (
                                           <div id="youtube-player" className="w-full h-full"></div>
                                       ) : (
                                           <div className="flex-1 flex flex-col items-center justify-center text-gray-600">
                                               <i className="fab fa-youtube text-6xl mb-4 opacity-20"></i>
                                               <p>Aucune vidéo sélectionnée</p>
                                           </div>
                                       )}
                                  </div>
                                  
                                  {/* Sidebar Queue & Search */}
                                  <div className="w-80 bg-[#18181b] border-l border-white/5 flex flex-col">
                                      {/* Search Bar */}
                                      <div className="p-4 border-b border-white/5">
                                          <div className="flex space-x-2">
                                              <input 
                                                type="text" 
                                                value={youtubeInput} 
                                                onChange={e=>setYoutubeInput(e.target.value)} 
                                                placeholder="Lien YouTube..." 
                                                className="flex-1 bg-[#09090b] border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-red-500 transition-colors"
                                                onKeyDown={e => {if(e.key === 'Enter') addToQueue()}}
                                              />
                                              <button onClick={addToQueue} className="bg-red-600 hover:bg-red-700 text-white p-2 rounded-lg transition-colors">
                                                  <i className="fas fa-plus text-xs"></i>
                                              </button>
                                          </div>
                                      </div>

                                      {/* Queue List */}
                                      <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                                          {youtubeQueue.length === 0 && <div className="text-center text-gray-600 text-xs mt-10">File d'attente vide</div>}
                                          {youtubeQueue.map((item, idx) => (
                                              <div key={item.id} className={`group flex items-start space-x-3 p-2 rounded-lg hover:bg-white/5 transition-colors ${currentVideo?.id === item.id ? 'bg-white/5 ring-1 ring-red-500/50' : ''}`}>
                                                  <div className="relative w-20 h-12 bg-black rounded overflow-hidden shrink-0 cursor-pointer" onClick={()=>playVideo(item)}>
                                                      <img src={item.thumbnail} className="w-full h-full object-cover opacity-80 hover:opacity-100 transition-opacity"/>
                                                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                          <i className={`fas ${currentVideo?.id === item.id ? 'fa-chart-bar' : 'fa-play'} text-white shadow-black drop-shadow-md text-xs`}></i>
                                                      </div>
                                                  </div>
                                                  <div className="flex-1 min-w-0">
                                                      <h4 className="text-xs font-bold truncate text-gray-200 cursor-pointer hover:underline" onClick={()=>playVideo(item)}>{item.title}</h4>
                                                      <p className="text-[10px] text-gray-500">Ajouté par {item.addedByName}</p>
                                                      
                                                      {/* Controls */}
                                                      <div className="flex items-center space-x-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                          <button onClick={()=>moveQueueItem(idx, 'up')} disabled={idx===0} className="text-gray-500 hover:text-white disabled:opacity-30"><i className="fas fa-chevron-up text-[10px]"></i></button>
                                                          <button onClick={()=>moveQueueItem(idx, 'down')} disabled={idx===youtubeQueue.length-1} className="text-gray-500 hover:text-white disabled:opacity-30"><i className="fas fa-chevron-down text-[10px]"></i></button>
                                                          <div className="grow"></div>
                                                          <button onClick={()=>removeFromQueue(item.id)} className="text-gray-500 hover:text-red-500"><i className="fas fa-trash text-[10px]"></i></button>
                                                      </div>
                                                  </div>
                                              </div>
                                          ))}
                                      </div>
                                  </div>
                              </div>
                          )}
                          
                          {/* WHITEBOARD UI */}
                          {activityView.type === 'whiteboard' && (
                              <div className="w-full h-full bg-white flex flex-col">
                                  {/* Toolbar */}
                                  <div className="h-16 border-b border-gray-200 flex items-center justify-between px-4 bg-gray-50 text-gray-800 shrink-0">
                                      <div className="flex items-center space-x-3">
                                          <div className="grid grid-cols-7 gap-1">
                                              {WB_COLORS.map(c => (
                                                  <button key={c} onClick={()=> {setWbColor(c); setWbIsEraser(false)}} className={`w-4 h-4 rounded-full hover:scale-110 transition-transform ${wbColor === c && !wbIsEraser ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`} style={{backgroundColor: c}}></button>
                                              ))}
                                          </div>
                                          <div className="w-px h-8 bg-gray-300 mx-2"></div>
                                          <button onClick={()=>setWbIsEraser(!wbIsEraser)} className={`p-2 rounded hover:bg-gray-200 ${wbIsEraser ? 'bg-gray-200 text-blue-500' : 'text-gray-600'}`}><i className="fas fa-eraser"></i></button>
                                          <input type="range" min="1" max="20" value={wbSize} onChange={(e)=>setWbSize(parseInt(e.target.value))} className="w-20" />
                                      </div>
                                      <div className="flex items-center space-x-3">
                                          <div className="flex items-center space-x-1 bg-white border border-gray-300 rounded-lg px-1">
                                              <button onClick={()=>{
                                                  const newPage = Math.max(0, wbPageIndex - 1);
                                                  setWbPageIndex(newPage);
                                                  broadcastData({type:'activity', activityType:'whiteboard', action:'set-page', data:{pageIndex: newPage}});
                                              }} className="p-2 hover:text-blue-500"><i className="fas fa-chevron-left text-xs"></i></button>
                                              <span className="text-xs font-mono w-6 text-center">{wbPageIndex + 1}</span>
                                              <button onClick={()=>{
                                                  const newPage = wbPageIndex + 1;
                                                  setWbPageIndex(newPage);
                                                  broadcastData({type:'activity', activityType:'whiteboard', action:'set-page', data:{pageIndex: newPage}});
                                              }} className="p-2 hover:text-blue-500"><i className="fas fa-chevron-right text-xs"></i></button>
                                          </div>
                                          <button onClick={downloadWhiteboard} className="text-gray-600 hover:text-black p-2"><i className="fas fa-download"></i></button>
                                          <button onClick={() => {
                                              const ctx = canvasRef.current?.getContext('2d');
                                              ctx?.clearRect(0,0, canvasRef.current!.width, canvasRef.current!.height);
                                              wbHistoryRef.current.set(wbPageIndex, []);
                                              broadcastData({type:'activity', activityType:'whiteboard', action:'clear'});
                                          }} className="text-red-400 hover:text-red-600 p-2"><i className="fas fa-trash"></i></button>
                                      </div>
                                  </div>
                                  {/* Canvas */}
                                  <div className="flex-1 overflow-hidden relative">
                                    <canvas 
                                        ref={el => {
                                            if (el) {
                                                canvasRef.current = el;
                                                if (el.width !== el.offsetWidth) {
                                                    el.width = el.offsetWidth;
                                                    el.height = el.offsetHeight;
                                                    const history = wbHistoryRef.current.get(wbPageIndex) || [];
                                                    const ctx = el.getContext('2d');
                                                    if(ctx){
                                                        ctx.clearRect(0,0, el.width, el.height); 
                                                        history.forEach(line => drawOnCanvas(line, el));
                                                    }
                                                }
                                            }
                                        }}
                                        className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
                                        onMouseDown={(e) => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const x = (e.clientX - rect.left) / rect.width;
                                            const y = (e.clientY - rect.top) / rect.height;
                                            (e.currentTarget as any).isDrawing = true;
                                            (e.currentTarget as any).lastPos = { x, y };
                                        }}
                                        onMouseMove={(e) => {
                                            const el = e.currentTarget as any;
                                            if (!el.isDrawing) return;
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const x = (e.clientX - rect.left) / rect.width;
                                            const y = (e.clientY - rect.top) / rect.height;
                                            const drawData: DrawLine = { prevX: el.lastPos.x, prevY: el.lastPos.y, x, y, color: wbColor, size: wbSize, isEraser: wbIsEraser };
                                            drawOnCanvas(drawData, e.currentTarget);
                                            if(!wbHistoryRef.current.has(wbPageIndex)) wbHistoryRef.current.set(wbPageIndex, []);
                                            wbHistoryRef.current.get(wbPageIndex)?.push(drawData);
                                            broadcastData({ type: 'activity', activityType: 'whiteboard', action: 'draw', data: { drawData, pageIndex: wbPageIndex } });
                                            el.lastPos = { x, y };
                                        }}
                                        onMouseUp={(e) => { (e.currentTarget as any).isDrawing = false; }}
                                        onMouseLeave={(e) => { (e.currentTarget as any).isDrawing = false; }}
                                    />
                                  </div>
                              </div>
                          )}
                      </div>
                  </div>
              )}

              {/* Grid */}
              <div className={`grid gap-4 w-full h-full max-w-6xl transition-all duration-500 ease-out-expo ${pinnedView === 'activity' ? 'opacity-0 pointer-events-none scale-95' : ''} ${activePeers.length === 0 ? 'grid-cols-1' : activePeers.length === 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-2'}`}>
                  {renderVideoUnit('local')}
                  {activePeers.map(peer => <div key={peer.id} className="w-full h-full animate-in zoom-in duration-500">{renderVideoUnit(peer)}</div>)}
                  {activePeers.length === 0 && (
                      <div className="border-2 border-dashed border-white/5 rounded-3xl flex flex-col items-center justify-center text-gray-600">
                          <p className="font-medium text-sm">En attente...</p>
                      </div>
                  )}
              </div>
          </div>

          {/* Bottom Bar */}
          <div className="h-20 flex items-center justify-center space-x-3 pb-6 pointer-events-none">
               <div className="pointer-events-auto bg-[#18181b] border border-white/5 rounded-2xl p-1.5 flex items-center space-x-2 shadow-2xl">
                   <button onClick={toggleMute} className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg transition-all duration-200 active:scale-95 ${!isMuted ? 'text-gray-300 hover:bg-white/5' : 'bg-red-500 text-white shadow-red-500/20 shadow-lg'}`}><i className={`fas ${!isMuted?'fa-microphone':'fa-microphone-slash'}`}></i></button>
                   <button onClick={toggleDeafen} className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg transition-all duration-200 active:scale-95 ${!isDeafened ? 'text-gray-300 hover:bg-white/5' : 'bg-red-500 text-white shadow-red-500/20 shadow-lg'}`}><i className={`fas ${!isDeafened?'fa-headphones':'fa-headphones-slash'}`}></i></button>
                   <button onClick={toggleVideo} className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg transition-all duration-200 active:scale-95 ${isVideoEnabled ? 'text-gray-300 hover:bg-white/5' : 'bg-red-500 text-white shadow-red-500/20 shadow-lg'}`}><i className={`fas ${isVideoEnabled?'fa-video':'fa-video-slash'}`}></i></button>
                   <button onClick={toggleScreenShare} className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg transition-all duration-200 active:scale-95 ${isScreenSharing ? 'bg-green-500 text-white' : 'text-gray-300 hover:bg-white/5'}`}><i className="fas fa-desktop"></i></button>
                   <div className="w-px h-6 bg-white/10 mx-1"></div>
                   <button onClick={()=>setShowActivityModal(true)} className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center text-lg hover:scale-105 transition-transform shadow-lg shadow-blue-500/20 active:scale-95"><i className="fas fa-rocket"></i></button>
                   <button onClick={leaveRoom} className="w-16 h-12 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center text-lg transition-all active:scale-95"><i className="fas fa-phone-slash"></i></button>
               </div>
          </div>

       </div>

       {/* Chat Sidebar */}
       <div className={`fixed inset-y-0 right-0 w-80 bg-[#09090b] border-l border-white/5 transform transition-transform duration-300 z-40 flex flex-col ${showMobileChat ? 'translate-x-0' : 'translate-x-full md:translate-x-0 md:static'}`}>
           <div className="h-16 flex items-center px-4 border-b border-white/5 justify-between">
               <span className="font-bold text-xs text-gray-500 uppercase">Chat</span>
               <button className="md:hidden text-gray-500" onClick={()=>setShowMobileChat(false)}><i className="fas fa-times"></i></button>
           </div>
           <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
               {chatHistory.map(msg => (
                   <div key={msg.id} className="animate-in slide-in-from-right-2 duration-300">
                       <div className="flex items-baseline justify-between mb-1 px-1">
                           <span className="font-bold text-xs text-gray-300">{msg.senderName}</span>
                           <span className="text-[10px] text-gray-600">{new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                       </div>
                       <div className="bg-[#18181b] rounded-2xl rounded-tl-none p-3 text-sm text-gray-300 border border-white/5">
                           {msg.text}
                           {msg.image && <img src={msg.image} className="mt-2 rounded-lg" />}
                       </div>
                   </div>
               ))}
               <div ref={chatBottomRef}></div>
           </div>
           <div className="p-3 bg-[#09090b]">
               <div className="bg-[#18181b] rounded-full flex items-center p-1 border border-white/5">
                   <button onClick={()=>mediaUploadRef.current?.click()} className="w-8 h-8 rounded-full bg-white/5 text-gray-400 hover:text-white flex items-center justify-center transition-colors"><i className="fas fa-plus text-xs"></i></button>
                   <input type="text" value={messageInput} onChange={e=>setMessageInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&messageInput.trim()){ broadcastData({type:'chat',text:messageInput,sender:peerId||'',senderName:displayName}); setChatHistory(prev=>[...prev,{id:Date.now().toString(),sender:peerId||'',senderName:displayName,text:messageInput,timestamp:Date.now()}]); setMessageInput(''); }}} className="bg-transparent flex-1 focus:outline-none text-xs px-3 text-white" placeholder="Message..." />
                   <input type="file" ref={mediaUploadRef} className="hidden" onChange={(e)=>{const f=e.target.files?.[0]; if(f){const r=new FileReader(); r.onloadend=()=>{broadcastData({type:'file-share',file:r.result as string,fileName:f.name,fileType:f.type,sender:peerId||'',senderName:displayName}); setChatHistory(prev=>[...prev,{id:Date.now().toString(),sender:peerId||'',senderName:displayName,image:r.result as string,timestamp:Date.now()}]);}; r.readAsDataURL(f);}}} />
               </div>
           </div>
       </div>

       {/* Incoming Call Overlay */}
       {incomingCall && (
           <div className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center">
               <div className="text-center animate-bounce-slow">
                   <div className="w-24 h-24 rounded-full bg-[#18181b] border border-white/10 flex items-center justify-center text-3xl font-bold mb-4 shadow-2xl mx-auto">
                       {getInitials(incomingCall.call.peer)}
                   </div>
                   <h2 className="text-xl font-bold mb-1">{incomingCall.metadata?.displayName || 'Inconnu'}</h2>
                   <p className="text-gray-500 text-sm mb-8">Appel entrant...</p>
                   <div className="flex space-x-4 justify-center">
                       <button onClick={rejectCall} className="w-14 h-14 rounded-full bg-red-500 text-white flex items-center justify-center text-xl transition-transform hover:scale-110"><i className="fas fa-times"></i></button>
                       <button onClick={acceptCall} className="w-14 h-14 rounded-full bg-green-500 text-white flex items-center justify-center text-xl transition-transform hover:scale-110"><i className="fas fa-check"></i></button>
                   </div>
               </div>
           </div>
       )}
    </div>
  );
}
