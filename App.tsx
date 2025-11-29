
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DataConnection, MediaConnection, PeerInstance, NetworkMessage, LogEntry, ChatMessage, DeviceInfo, RemotePeer, ActivityMessage, DrawLine } from './types';

// --- Assets & Constants ---
const SOUND_RINGTONE = "/ringtone.mp3"; 
const SOUND_JOIN = "https://cdn.pixabay.com/download/audio/2022/03/24/audio_7811d73967.mp3";
const SOUND_LEAVE = "https://cdn.pixabay.com/download/audio/2021/08/04/audio_c6ccf3232f.mp3";
const SOUND_MESSAGE = "https://cdn.pixabay.com/download/audio/2021/08/04/audio_12b0c7443c.mp3";
const SOUND_UI_ON = "https://cdn.pixabay.com/download/audio/2022/03/24/audio_c8c8a73467.mp3"; // Click/On
const SOUND_UI_OFF = "https://cdn.pixabay.com/download/audio/2022/03/24/audio_1020476839.mp3"; // Click/Off
const SOUND_ENTER_ROOM = "https://cdn.pixabay.com/download/audio/2022/03/15/audio_762635987a.mp3"; // Space swoosh

const MAX_PEERS_LIMIT = 3; // Absolute hard limit (Host + 3 guests = 4 total)

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

export default function App() {
  // --- View State ---
  const [viewState, setViewState] = useState<'login' | 'lobby' | 'room'>('login');

  // --- Identity ---
  const [username, setUsername] = useState(''); 
  const [displayName, setDisplayName] = useState(''); 
  const [peerId, setPeerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  
  // --- Room Configuration ---
  const [remoteIdInput, setRemoteIdInput] = useState('');
  const [roomCapacity, setRoomCapacity] = useState(4); // Default max
  const [peers, setPeers] = useState<Map<string, RemotePeer>>(new Map());
  const [incomingCall, setIncomingCall] = useState<{ call: MediaConnection, metadata?: any } | null>(null);

  // --- Local Media ---
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [processedStream, setProcessedStream] = useState<MediaStream | null>(null); // Stream sent to peer (with gain)
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

  // --- Refs for State Access in Callbacks ---
  const isMutedRef = useRef(isMuted);
  const isDeafenedRef = useRef(isDeafened);
  const isVideoEnabledRef = useRef(isVideoEnabled);
  const isScreenSharingRef = useRef(isScreenSharing);
  const displayNameRef = useRef(displayName);
  const myActivityRef = useRef(myCurrentActivity);
  const localAvatarRef = useRef<string | null>(null);
  const peersRef = useRef<Map<string, RemotePeer>>(new Map()); // Mirror state for callbacks
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
  const [pinnedView, setPinnedView] = useState<'local' | 'activity' | string | null>(null); // 'local', 'activity', or peerId
  
  // --- Activity State (SHARED & LOCAL) ---
  const [activityView, setActivityView] = useState<{ type: 'youtube' | 'whiteboard', videoId?: string } | null>(null);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [youtubeInput, setYoutubeInput] = useState('');
  
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
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const mediaUploadRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Audio Processing Refs
  const localAudioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const peerAnalysersRef = useRef<Map<string, AnalyserNode>>(new Map());

  // --- Effects ---
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, showMobileChat]);

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
      audioDestinationRef.current = dest;

      source.connect(gainNode);
      gainNode.connect(dest);

      // Add local analyzer
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      gainNode.connect(analyser);

      // Animation Loop for Local Volume
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const checkVolume = () => {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const average = sum / dataArray.length;
          setIsLocalSpeaking(average > 10);
          animationFrameRef.current = requestAnimationFrame(checkVolume);
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
          const newStream = await navigator.mediaDevices.getUserMedia({ 
              audio: { deviceId: { exact: deviceId } },
              video: isVideoEnabled 
          });
          if (localStream && localStream.getVideoTracks().length > 0) newStream.addTrack(localStream.getVideoTracks()[0]);
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

  // --- ACTIONS (MUTE/DEAFEN/SCREEN) ---
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

  const toggleVideo = () => {
    const t = localStream?.getVideoTracks()[0]; 
    if(t){
        t.enabled = !t.enabled; 
        const newState = !t.enabled;
        setIsVideoEnabled(newState);
        playSound(newState ? SOUND_UI_ON : SOUND_UI_OFF); 
        broadcastData({type:'status', videoEnabled:newState, muted:isMuted, deafened:isDeafened, isScreenSharing:isScreenSharing, currentActivity:myCurrentActivity});
    }
  };

  const toggleScreenShare = async () => {
      if (isScreenSharing) {
          // Stop sharing
          try {
             // Get webcam back
             const camStream = await navigator.mediaDevices.getUserMedia({ video: selectedCamId ? { deviceId: { exact: selectedCamId } } : true });
             const videoTrack = camStream.getVideoTracks()[0];
             
             // Disable if it was disabled before
             if (!isVideoEnabled) videoTrack.enabled = false;
             
             // Replace tracks
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
          // Start sharing
          try {
              const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
              const screenTrack = screenStream.getVideoTracks()[0];
              
              screenTrack.onended = () => {
                  if (isScreenSharingRef.current) toggleScreenShare(); // Handle UI stop button
              };

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
  };

  const broadcastData = (msg: NetworkMessage) => {
      peersRef.current.forEach(peer => {
          if (peer.dataConn && peer.dataConn.open) {
              peer.dataConn.send(msg);
          }
      });
  };

  // --- CONNECTION LOGIC ---

  const connectToPeer = (targetId: string) => {
      if (!peerRef.current || !localStream || peersRef.current.has(targetId) || targetId === peerId) return;
      if (peersRef.current.size >= MAX_PEERS_LIMIT) { addLog("Salon plein (Max 4)", "error"); return; }

      const streamToSend = processedStream || setupAudioGraph(localStream);
      const call = peerRef.current.call(targetId, streamToSend, { metadata: { displayName: displayName, avatar: localAvatarRef.current } });
      const conn = peerRef.current.connect(targetId, { metadata: { displayName: displayName, avatar: localAvatarRef.current } });

      addPeer(targetId, { displayName: 'Connexion...', mediaCall: call, dataConn: conn });
      setupCallEvents(call, targetId);
      setupDataEvents(conn, targetId);
  };

  const setupCallEvents = (call: MediaConnection, remoteId: string) => {
      call.on('stream', (stream) => {
          addPeer(remoteId, { stream });
          setupRemoteAudioAnalyzer(remoteId, stream);
      });
      call.on('close', () => removePeer(remoteId));
      call.on('error', () => removePeer(remoteId));
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
          addLog(`${remoteId} a rejoint`, "success");
      });

      conn.on('data', (data: NetworkMessage) => {
          handleNetworkMessage(remoteId, data);
      });
      conn.on('close', () => removePeer(remoteId));
      conn.on('error', () => removePeer(remoteId));
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

  // --- WHITEBOARD LOGIC ---
  const drawOnCanvas = (data: DrawLine, canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const rect = canvas.getBoundingClientRect();
      const w = canvas.width;
      const h = canvas.height;

      // Coordinates are normalized (0-1), scale to canvas size
      const x = data.x * w;
      const y = data.y * h;
      const px = data.prevX * w;
      const py = data.prevY * h;

      ctx.lineWidth = data.size;
      ctx.lineCap = 'round';
      ctx.strokeStyle = data.isEraser ? '#FFFFFF' : data.color;
      if (data.isEraser) {
          ctx.globalCompositeOperation = 'destination-out'; // True eraser
      } else {
          ctx.globalCompositeOperation = 'source-over';
      }

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
    
    // Clear history or load page 0
    if(!wbHistoryRef.current.has(0)) wbHistoryRef.current.set(0, []);
  };

  const handleActivityMessage = (senderId: string, data: ActivityMessage) => {
    if (data.activityType === 'youtube' && data.action === 'sync-state' && activityView?.type === 'youtube' && playerRef.current) {
         // Sync logic (simplified)
         isRemoteUpdateRef.current = true;
         const { playerState, currentTime } = data.data!;
         const myTime = playerRef.current.getCurrentTime();
         if (Math.abs(myTime - (currentTime || 0)) > 1.5) playerRef.current.seekTo(currentTime, true);
         if (playerState === 1 && playerRef.current.getPlayerState() !== 1) playerRef.current.playVideo();
         else if (playerState === 2) playerRef.current.pauseVideo();
         setTimeout(() => { isRemoteUpdateRef.current = false; }, 800);
    } 
    else if (data.activityType === 'whiteboard') {
        if (activityView?.type !== 'whiteboard') return; // Ignore if I'm not in whiteboard
        
        if (data.action === 'draw' && data.data?.drawData && canvasRef.current) {
            // Save to history
            const page = data.data.pageIndex || 0;
            if(!wbHistoryRef.current.has(page)) wbHistoryRef.current.set(page, []);
            wbHistoryRef.current.get(page)?.push(data.data.drawData);

            if (page === wbPageIndex) {
                drawOnCanvas(data.data.drawData, canvasRef.current);
            }
        } else if (data.action === 'clear') {
             if(canvasRef.current) {
                 const ctx = canvasRef.current.getContext('2d');
                 ctx?.clearRect(0,0, canvasRef.current.width, canvasRef.current.height);
                 wbHistoryRef.current.set(wbPageIndex, []);
             }
        } else if (data.action === 'set-page' && typeof data.data?.pageIndex === 'number') {
             setWbPageIndex(data.data.pageIndex);
        }
    }
  };

  // --- YOUTUBE LOGIC ---
  const startYoutubeVideo = (id: string) => {
      setActivityView({ type: 'youtube', videoId: id });
      setPinnedView('activity');
      setMyCurrentActivity('youtube');
      broadcastData({ type: 'status', muted: isMuted, deafened: isDeafened, videoEnabled: isVideoEnabled, isScreenSharing: isScreenSharing, currentActivity: 'youtube' });

      if(playerRef.current) { try { playerRef.current.destroy(); } catch(e){} }
      setTimeout(() => {
          loadYouTubeAPI(() => {
              playerRef.current = new window.YT.Player('youtube-player', {
                  height: '100%', width: '100%', videoId: id,
                  playerVars: { 'playsinline': 1, 'controls': 1, 'enablejsapi': 1, 'origin': window.location.origin, 'rel': 0, 'modestbranding': 1 },
                  events: {
                      'onStateChange': (e:any) => {
                          if (isRemoteUpdateRef.current) return;
                          if ([1,2,3].includes(e.data)) {
                             broadcastData({ type: 'activity', action: 'sync-state', activityType: 'youtube', data: { playerState: e.data, currentTime: playerRef.current.getCurrentTime() } });
                          }
                      },
                  }
              });
          });
      }, 100);
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

  // Audio Activity Loop
  useEffect(() => {
      const loop = () => {
          if (peerAnalysersRef.current.size > 0) {
              const dataArray = new Uint8Array(128);
              setPeers(prev => {
                  let changed = false;
                  // Fix: Explicitly type the new Map to avoid 'unknown' inference
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
    call.answer(processedStream || setupAudioGraph(localStream));
    setupCallEvents(call, call.peer);
    addPeer(call.peer, { displayName: meta.displayName || 'Ami', avatar: meta.avatar, mediaCall: call });
    setIncomingCall(null);
  };

  const leaveRoom = () => {
      peersRef.current.forEach(peer => {
          if (peer.mediaCall) peer.mediaCall.close();
          if (peer.dataConn) peer.dataConn.close();
      });
      setPeers(new Map());
      peerAnalysersRef.current.clear();
      setActivityView(null); setPinnedView(null);
      setViewState('lobby');
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
          <div className={`relative bg-black/40 backdrop-blur-md rounded-3xl overflow-hidden flex items-center justify-center border border-white/5 group w-full h-full shadow-2xl transition-all duration-300
               ${speaking ? 'border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.3)]' : ''}`}
               onDoubleClick={() => setPinnedView(pinnedView === id ? null : id || 'local')}
               onContextMenu={!isLocal ? (e) => { e.preventDefault(); setContextMenu({x: e.clientX, y: e.clientY, peerId: peer.id}) } : undefined}
          >
              {/* Show Avatar if video disabled OR user is screen sharing (if we want to hide their face) - usually we want to see screen if screen sharing */}
              {(!status.videoEnabled && !status.isScreenSharing) && (
                  <div className={`w-28 h-28 rounded-full flex items-center justify-center overflow-hidden z-20 ${speaking ? 'ring-4 ring-cyan-500 shadow-[0_0_30px_#06b6d4]' : ''} transition-all duration-300 transform group-hover:scale-110`}>
                      {avatar ? <img src={avatar} className="w-full h-full object-cover"/> : 
                      <div className="w-full h-full bg-gradient-to-tr from-violet-600 to-cyan-500 flex items-center justify-center text-4xl font-bold text-white">{getInitials(display)}</div>}
                  </div>
              )}
              
              <video 
                 ref={(el) => { 
                     if(el && stream) { 
                         el.srcObject = stream; 
                         // Logic for deafening: If I am deafened, I mute everyone else LOCALLY.
                         // Logic for muting: If THEY are muted, the stream audio track is disabled anyway, but good to ensure.
                         el.muted = isLocal || isDeafened; 
                         if(!isLocal) {
                            el.volume = isDeafened ? 0 : peer.volume; // Apply Local Volume Control & Deafen
                            if ('setSinkId' in el && selectedSpeakerId) (el as any).setSinkId(selectedSpeakerId);
                         }
                         el.play().catch(()=>{});
                     }
                 }}
                 autoPlay playsInline className={`absolute inset-0 w-full h-full bg-[#050505] ${status.videoEnabled || status.isScreenSharing ? 'block' : 'hidden'} ${status.isScreenSharing ? 'object-contain' : (isLocal ? 'object-cover scale-x-[-1]' : 'object-cover')}`}
              />
              <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-xl px-4 py-2 rounded-full text-white text-xs font-bold border border-white/10 flex items-center z-30 select-none">
                  {display}
                  {status.muted && <i className="fas fa-microphone-slash text-red-500 ml-2"></i>}
                  {status.deafened && <i className="fas fa-headphones-alt text-red-500 ml-2"></i>}
              </div>
              
              {/* Activity Indicator (If not local and doing something) */}
              {!isLocal && activity !== 'none' && (
                  <div className="absolute top-4 right-4 flex flex-col items-end space-y-2 z-30">
                      <div className="bg-black/60 backdrop-blur px-3 py-1.5 rounded-full border border-white/10 text-xs font-bold text-white flex items-center animate-in fade-in slide-in-from-right-4">
                          <i className={`fas ${activity === 'youtube' ? 'fa-play text-red-500' : 'fa-pen text-cyan-500'} mr-2`}></i>
                          {activity === 'youtube' ? 'Regarde YouTube' : 'Dessine'}
                      </div>
                      {/* Join Button if I'm not doing the same thing */}
                      {activityView?.type !== activity && (
                          <button onClick={() => { 
                               if (activity === 'whiteboard') startWhiteboard();
                           }} 
                           className="bg-cyan-500 hover:bg-cyan-400 text-black px-3 py-1.5 rounded-full text-xs font-bold shadow-lg shadow-cyan-500/20 transition-transform hover:scale-105">
                           Rejoindre
                          </button>
                      )}
                  </div>
              )}
          </div>
      );
  };

  // --- WHITEBOARD CANVAS COMPONENT LOGIC (Inside Render) ---
  const renderWhiteboard = () => {
      return (
          <div className="w-full h-full bg-white relative flex flex-col animate-in fade-in">
              <div className="h-14 bg-gray-100 border-b flex items-center px-4 justify-between shrink-0">
                  <div className="flex space-x-2 items-center">
                      <div className="flex bg-white rounded-lg p-1 border shadow-sm">
                          {['#000000', '#EF4444', '#22C55E', '#3B82F6', '#EAB308', '#A855F7'].map(c => (
                              <button key={c} onClick={()=> {setWbColor(c); setWbIsEraser(false)}} className={`w-6 h-6 rounded mx-0.5 ${wbColor === c && !wbIsEraser ? 'ring-2 ring-offset-1 ring-black' : ''} transition-all hover:scale-110`} style={{backgroundColor: c}}></button>
                          ))}
                      </div>
                      <div className="h-8 w-px bg-gray-300 mx-2"></div>
                      <button onClick={()=>setWbIsEraser(!wbIsEraser)} className={`p-2 rounded hover:bg-gray-200 ${wbIsEraser ? 'bg-gray-300' : ''} transition-colors`}><i className="fas fa-eraser text-gray-700"></i></button>
                      <input type="range" min="1" max="20" value={wbSize} onChange={(e)=>setWbSize(parseInt(e.target.value))} className="w-24" />
                  </div>
                  <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-2 bg-white px-2 py-1 rounded border">
                          <button onClick={()=>{
                              const newPage = Math.max(0, wbPageIndex - 1);
                              setWbPageIndex(newPage);
                              broadcastData({type:'activity', activityType:'whiteboard', action:'set-page', data:{pageIndex: newPage}});
                          }} className="w-6 h-6 hover:bg-gray-100 rounded transition-colors"><i className="fas fa-chevron-left text-xs"></i></button>
                          <span className="text-sm font-mono w-4 text-center">{wbPageIndex + 1}</span>
                          <button onClick={()=>{
                              const newPage = wbPageIndex + 1;
                              setWbPageIndex(newPage);
                              broadcastData({type:'activity', activityType:'whiteboard', action:'set-page', data:{pageIndex: newPage}});
                          }} className="w-6 h-6 hover:bg-gray-100 rounded transition-colors"><i className="fas fa-chevron-right text-xs"></i></button>
                      </div>
                      <button onClick={()=>{
                           const link = document.createElement('a');
                           link.download = `dessin-page-${wbPageIndex+1}.png`;
                           link.href = canvasRef.current?.toDataURL() || '';
                           link.click();
                      }} className="text-gray-600 hover:text-black transition-colors"><i className="fas fa-download"></i></button>
                      <button onClick={() => {
                          const ctx = canvasRef.current?.getContext('2d');
                          ctx?.clearRect(0,0, canvasRef.current!.width, canvasRef.current!.height);
                          wbHistoryRef.current.set(wbPageIndex, []);
                          broadcastData({type:'activity', activityType:'whiteboard', action:'clear'});
                      }} className="text-red-500 hover:bg-red-50 p-2 rounded transition-colors"><i className="fas fa-trash"></i></button>
                  </div>
              </div>
              <canvas 
                  ref={el => {
                      if (el) {
                          canvasRef.current = el;
                          if (el.width !== el.offsetWidth) {
                              el.width = el.offsetWidth;
                              el.height = el.offsetHeight;
                              const history = wbHistoryRef.current.get(wbPageIndex) || [];
                              const ctx = el.getContext('2d');
                              ctx?.clearRect(0,0, el.width, el.height); 
                              history.forEach(line => drawOnCanvas(line, el));
                          }
                      }
                  }}
                  className="flex-1 cursor-crosshair touch-none"
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
                      
                      const drawData: DrawLine = {
                          prevX: el.lastPos.x, prevY: el.lastPos.y,
                          x, y, color: wbColor, size: wbSize, isEraser: wbIsEraser
                      };
                      
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
      );
  };

  // --- RENDER MAIN ---
  
  // LOGIN SCREEN
  if (viewState === 'login') {
      return (
          <div className="h-screen flex items-center justify-center bg-[#050505] relative overflow-hidden font-sans text-white">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-violet-900/20 via-black to-black animate-pulse-slow"></div>
              <div className="w-full max-w-md bg-white/5 backdrop-blur-3xl p-10 rounded-3xl border border-white/10 shadow-2xl relative z-10 animate-in fade-in zoom-in duration-500">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-cyan-400 to-violet-600 flex items-center justify-center mx-auto mb-8 shadow-lg shadow-cyan-500/20 transform hover:rotate-6 transition-transform">
                      <i className="fas fa-bolt text-4xl text-white"></i>
                  </div>
                  <h1 className="text-4xl font-black text-center mb-2 tracking-tight">Nexus</h1>
                  <p className="text-gray-400 text-center mb-8">Espace collaboratif temps réel P2P.</p>
                  <form onSubmit={(e) => {
                      e.preventDefault();
                      if (!username.trim()) return;
                      setIsLoading(true);
                      const myId = `${username.replace(/[^a-zA-Z0-9_-]/g, '')}-${Math.floor(Math.random() * 9000) + 1000}`;
                      setPeerId(myId); setDisplayName(username);
                      
                      loadDevices().then(async () => {
                         try {
                             const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                             setLocalStream(stream);
                             setupAudioGraph(stream);
                             // Mute video track initially if user wants (optional), here we keep it but disable track to start "audio only" maybe? 
                             // Let's keep camera ACTIVE but track ENABLED=FALSE to simulate "camera off" visual.
                             stream.getVideoTracks().forEach(t => t.enabled = false);
                             
                             const peer = new window.Peer(myId);
                             peerRef.current = peer;
                             peer.on('open', () => { setIsLoading(false); setViewState('lobby'); });
                             peer.on('connection', handleIncomingConnection);
                             peer.on('call', handleIncomingCall);
                             peer.on('error', (e) => { addLog("Erreur connexion", "error"); setIsLoading(false); });
                         } catch(e) { setLoginError("Accès Micro/Caméra requis"); setIsLoading(false); }
                      });
                  }}>
                      <input type="text" value={username} onChange={e=>setUsername(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-white placeholder-gray-500 focus:border-cyan-500 focus:outline-none transition-colors mb-4 text-center font-bold" placeholder="Votre Pseudo" />
                      <button disabled={isLoading} className="w-full bg-white text-black py-4 rounded-xl font-black hover:bg-cyan-50 transition-all hover:scale-[1.02] shadow-lg shadow-white/10 active:scale-95">
                        {isLoading ? "Connexion..." : "ENTRER"}
                      </button>
                  </form>
                  {loginError && <p className="text-red-500 text-center mt-4 text-sm font-bold animate-pulse">{loginError}</p>}
              </div>
          </div>
      );
  }

  // LOBBY SCREEN
  if (viewState === 'lobby') {
      return (
          <div className="h-screen bg-[#050505] flex overflow-hidden font-sans text-white selection:bg-cyan-500/30">
               {/* Simplified Lobby Sidebar */}
               <div className="w-80 bg-[#0a0a0a] border-r border-white/5 p-6 flex flex-col z-20">
                   <div className="flex items-center space-x-4 mb-10">
                       <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-600 to-cyan-500 p-0.5 cursor-pointer hover:scale-105 transition-transform" onClick={()=>fileInputRef.current?.click()}>
                           <div className="w-full h-full rounded-full bg-black overflow-hidden group relative">
                               {localAvatar ? <img src={localAvatar} className="w-full h-full object-cover"/> : <div className="w-full h-full flex items-center justify-center font-bold text-xl">{getInitials(displayName)}</div>}
                               <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><i className="fas fa-camera"></i></div>
                           </div>
                       </div>
                       <div>
                           <h2 className="font-bold text-lg">{displayName}</h2>
                           <div className="text-xs text-gray-500 font-mono bg-white/5 px-2 py-1 rounded mt-1 cursor-pointer hover:bg-white/10 transition-colors" onClick={()=>navigator.clipboard.writeText(peerId||'')}>{peerId}</div>
                       </div>
                   </div>
                   
                   <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">Rejoindre</h3>
                   <form onSubmit={(e)=>{ e.preventDefault(); if(remoteIdInput.trim() !== peerId) {setViewState('room'); playSound(SOUND_ENTER_ROOM); connectToPeer(remoteIdInput.trim());} }} className="space-y-4">
                       <input type="text" value={remoteIdInput} onChange={e=>setRemoteIdInput(e.target.value)} placeholder="ID du salon..." className="w-full bg-white/5 border border-white/5 rounded-xl p-3 focus:border-cyan-500 focus:outline-none text-sm transition-colors" />
                       <button className="w-full bg-white/10 hover:bg-white/20 py-3 rounded-xl font-bold text-sm transition-all active:scale-95">Rejoindre</button>
                   </form>
                   
                   <div className="mt-auto">
                        <input type="file" ref={fileInputRef} onChange={e=>{ const f = e.target.files?.[0]; if(f){const r = new FileReader(); r.onloadend=()=>{localAvatarRef.current=r.result as string; setLocalAvatar(r.result as string);}; r.readAsDataURL(f);} }} className="hidden"/>
                   </div>
               </div>

               {/* Lobby Dashboard */}
               <div className="flex-1 p-10 overflow-y-auto relative">
                   <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-cyan-500/10 rounded-full blur-[150px] pointer-events-none animate-pulse-slow"></div>
                   <h1 className="text-5xl font-black mb-2 animate-in slide-in-from-left-4 duration-500">Bienvenue</h1>
                   <p className="text-gray-400 mb-12 text-lg animate-in slide-in-from-left-4 duration-700 delay-100">Choisissez un type de salon pour commencer.</p>

                   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 relative z-10">
                       {[
                           { t: "Duo", c: 2, i: "fa-user-friends", g: "from-cyan-500 to-blue-600" },
                           { t: "Squad", c: 3, i: "fa-users", g: "from-violet-500 to-purple-600" },
                           { t: "Full", c: 4, i: "fa-globe", g: "from-pink-500 to-rose-600" },
                           { t: "Ciné", c: 4, i: "fa-film", g: "from-amber-500 to-orange-600", mode: 'cinema' }
                       ].map((item, i) => (
                           <div key={i} onClick={()=>{ setRoomCapacity(item.c); setViewState('room'); playSound(SOUND_ENTER_ROOM); if(item.mode==='cinema'){ setTimeout(()=>{startYoutubeVideo('');},500); } }} 
                                className="group bg-white/5 hover:bg-white/10 border border-white/5 p-8 rounded-3xl cursor-pointer transition-all duration-300 hover:-translate-y-2 relative overflow-hidden animate-in zoom-in" style={{animationDelay: `${i*100}ms`}}>
                               <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${item.g} flex items-center justify-center text-2xl mb-6 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                                   <i className={`fas ${item.i}`}></i>
                               </div>
                               <h3 className="font-bold text-2xl">{item.t}</h3>
                               <p className="text-sm text-gray-400 mt-2">Capacité: {item.c} personnes</p>
                           </div>
                       ))}
                   </div>
               </div>
          </div>
      );
  }

  // ROOM SCREEN
  const activePeers = Array.from(peers.values()) as RemotePeer[];
  
  return (
    <div className="flex h-screen bg-[#050505] overflow-hidden text-white font-sans selection:bg-cyan-500/30" onContextMenu={e => e.preventDefault()}>
       
       {/* Context Menu for Volume */}
       {contextMenu && (
           <div className="fixed z-[100] bg-[#1a1a1a] border border-white/10 rounded-xl p-3 shadow-2xl w-48 backdrop-blur-xl animate-in fade-in zoom-in duration-100" style={{top: contextMenu.y, left: contextMenu.x}}>
               <div className="text-xs font-bold text-gray-500 uppercase mb-2 px-1">Volume Local</div>
               <input 
                  type="range" min="0" max="1" step="0.1" 
                  defaultValue={peers.get(contextMenu.peerId)?.volume || 1}
                  onChange={(e) => {
                      const vol = parseFloat(e.target.value);
                      addPeer(contextMenu.peerId, { volume: vol });
                  }}
                  className="w-full accent-cyan-500 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
               />
               <div className="mt-2 pt-2 border-t border-white/5 text-xs text-gray-400 px-1">Ceci n'affecte que vous.</div>
           </div>
       )}

        {/* Settings Modal */}
        {showSettingsModal && (
            <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in" onClick={()=>setShowSettingsModal(false)}>
                <div className="bg-[#111] p-8 rounded-3xl w-full max-w-lg border border-white/10 shadow-2xl" onClick={e=>e.stopPropagation()}>
                    <h3 className="text-2xl font-bold mb-6">Paramètres</h3>
                    <div className="space-y-6">
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase block mb-2">Microphone</label>
                            <select value={selectedMicId} onChange={e=>changeAudioInput(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm focus:border-cyan-500 outline-none">
                                <option value="">Défaut</option>
                                {inputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                            </select>
                        </div>
                        <div>
                             <label className="text-xs font-bold text-gray-500 uppercase block mb-2">Caméra</label>
                             <select value={selectedCamId} onChange={async (e) => {
                                 setSelectedCamId(e.target.value);
                                 // Simple logic to just restart stream with new video ID if needed (full impl needs restart stream logic similar to audio)
                             }} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm focus:border-cyan-500 outline-none">
                                <option value="">Défaut</option>
                                {/* Need to populate video devices similar to audio logic, omitted for brevity but logic is same */}
                             </select>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase block mb-2">Sortie Audio</label>
                            <select value={selectedSpeakerId} onChange={e=>setSelectedSpeakerId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm focus:border-cyan-500 outline-none">
                                <option value="">Défaut</option>
                                {outputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase block mb-2">Volume Micro (Gain)</label>
                            <input type="range" min="0" max="2" step="0.1" value={micGain} onChange={e=>setMicGain(parseFloat(e.target.value))} className="w-full accent-cyan-500"/>
                        </div>
                        <div className="pt-4 border-t border-white/10">
                            <label className="text-xs font-bold text-gray-500 uppercase block mb-2">Pseudo</label>
                            <div className="flex space-x-2">
                                <input type="text" value={displayName} onChange={e=>setDisplayName(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-xl p-3 text-sm" />
                                <button onClick={()=>{broadcastData({type:'profile-update', displayName:displayName, avatar:localAvatarRef.current}); setShowSettingsModal(false);}} className="bg-white/10 hover:bg-white/20 px-4 rounded-xl font-bold text-sm">Sauver</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )}

       {/* Activity Modal */}
       {showActivityModal && (
           <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in" onClick={()=>setShowActivityModal(false)}>
               <div className="bg-[#111] p-8 rounded-3xl w-full max-w-lg border border-white/10" onClick={e=>e.stopPropagation()}>
                   <h3 className="text-2xl font-bold mb-6 text-center">Nouvelle Activité</h3>
                   <div className="grid grid-cols-2 gap-4">
                       <button onClick={()=>{ startYoutubeVideo(''); setShowActivityModal(false); }} className="bg-white/5 hover:bg-red-500/20 hover:border-red-500 border border-white/5 p-6 rounded-2xl flex flex-col items-center transition-all group">
                           <i className="fab fa-youtube text-4xl text-red-500 mb-3 group-hover:scale-110 transition-transform"></i>
                           <span className="font-bold">YouTube</span>
                       </button>
                       <button onClick={()=>{ startWhiteboard(); setShowActivityModal(false); }} className="bg-white/5 hover:bg-cyan-500/20 hover:border-cyan-500 border border-white/5 p-6 rounded-2xl flex flex-col items-center transition-all group">
                           <i className="fas fa-pen-nib text-4xl text-cyan-500 mb-3 group-hover:scale-110 transition-transform"></i>
                           <span className="font-bold">Dessin</span>
                       </button>
                   </div>
               </div>
           </div>
       )}

       {/* Main View */}
       <div className="flex-1 flex flex-col relative">
          
          {/* Header */}
          <div className="h-20 flex items-center justify-between px-8 absolute top-0 left-0 right-0 z-20 pointer-events-none">
               <div className="pointer-events-auto bg-black/40 backdrop-blur-xl border border-white/5 px-4 py-2 rounded-full flex items-center space-x-3 hover:bg-black/60 transition-colors cursor-pointer" onClick={()=>navigator.clipboard.writeText(peerId||'')}>
                   <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                   <span className="font-mono text-sm font-bold opacity-80">{peerId}</span>
                   <i className="fas fa-copy text-xs opacity-50"></i>
               </div>
               <div className="pointer-events-auto flex space-x-2">
                   <button onClick={()=>setShowMobileChat(!showMobileChat)} className="md:hidden w-10 h-10 bg-black/40 backdrop-blur-xl rounded-full flex items-center justify-center border border-white/5"><i className="fas fa-comment"></i></button>
                   <button onClick={()=>setShowSettingsModal(true)} className="w-10 h-10 bg-black/40 backdrop-blur-xl rounded-full flex items-center justify-center border border-white/5 hover:bg-white hover:text-black transition-colors"><i className="fas fa-cog"></i></button>
               </div>
          </div>

          {/* Canvas / Stage */}
          <div className="flex-1 p-6 flex items-center justify-center relative">
              
              {/* Activity View (Pinned) */}
              {activityView && pinnedView === 'activity' && (
                  <div className="absolute inset-4 z-10 bg-[#111] rounded-3xl border border-white/10 overflow-hidden shadow-2xl flex flex-col animate-in zoom-in duration-300">
                      <div className="h-12 bg-black flex items-center justify-between px-4 border-b border-white/5">
                          <span className="font-bold text-sm flex items-center"><i className="fas fa-shapes mr-2 text-cyan-500"></i> Activité en cours</span>
                          <button onClick={()=>{setActivityView(null); setPinnedView(null); setMyCurrentActivity('none'); broadcastData({type:'status', muted:isMuted, deafened:isDeafened, videoEnabled:isVideoEnabled, isScreenSharing:isScreenSharing, currentActivity:'none'})}} className="text-red-500 hover:bg-red-500/10 p-2 rounded-lg transition-colors"><i className="fas fa-times"></i> Quitter</button>
                      </div>
                      <div className="flex-1 relative">
                          {activityView.type === 'youtube' && (
                              activityView.videoId ? <div id="youtube-player" className="w-full h-full"></div> : 
                              <div className="w-full h-full flex flex-col items-center justify-center">
                                  <input type="text" value={youtubeInput} onChange={e=>setYoutubeInput(e.target.value)} placeholder="Coller un lien YouTube..." className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 w-80 text-center focus:outline-none focus:border-red-500 transition-colors mb-4"/>
                                  <button onClick={()=>{const id=getYoutubeId(youtubeInput); if(id) {startYoutubeVideo(id); broadcastData({type:'activity', action:'start', activityType:'youtube', data:{videoId:id}});}}} className="bg-red-600 hover:bg-red-700 text-white px-8 py-2 rounded-xl font-bold">Lancer</button>
                              </div>
                          )}
                          {activityView.type === 'whiteboard' && renderWhiteboard()}
                      </div>
                  </div>
              )}

              {/* Grid */}
              <div className={`grid gap-6 w-full h-full max-w-7xl transition-all duration-500 ease-out ${pinnedView === 'activity' ? 'opacity-0 pointer-events-none scale-90' : ''} ${activePeers.length === 0 ? 'grid-cols-1' : activePeers.length === 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-2'}`}>
                  {renderVideoUnit('local')}
                  {activePeers.map(peer => <div key={peer.id} className="w-full h-full animate-in zoom-in duration-500">{renderVideoUnit(peer)}</div>)}
                  {activePeers.length === 0 && (
                      <div className="border-2 border-dashed border-white/10 rounded-3xl flex flex-col items-center justify-center text-gray-500 animate-pulse-slow">
                          <p className="font-bold">En attente...</p>
                      </div>
                  )}
              </div>
          </div>

          {/* Bottom Bar */}
          <div className="h-24 flex items-center justify-center space-x-4 pb-6">
               <div className="bg-black/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-2 flex items-center space-x-2 shadow-2xl transition-transform hover:-translate-y-1">
                   <button onClick={toggleMute} className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl transition-all duration-200 active:scale-95 ${!isMuted ? 'bg-white text-black' : 'bg-red-500 text-white'}`}><i className={`fas ${!isMuted?'fa-microphone':'fa-microphone-slash'}`}></i></button>
                   <button onClick={toggleDeafen} className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl transition-all duration-200 active:scale-95 ${!isDeafened ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-red-500 text-white'}`}><i className={`fas ${!isDeafened?'fa-headphones':'fa-headphones-slash'}`}></i></button>
                   <button onClick={toggleVideo} className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl transition-all duration-200 active:scale-95 ${isVideoEnabled ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}><i className={`fas ${isVideoEnabled?'fa-video':'fa-video-slash'}`}></i></button>
                   <button onClick={toggleScreenShare} className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl transition-all duration-200 active:scale-95 ${isScreenSharing ? 'bg-green-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}><i className="fas fa-desktop"></i></button>
                   <div className="w-px h-8 bg-white/10 mx-2"></div>
                   <button onClick={()=>setShowActivityModal(true)} className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-white flex items-center justify-center text-xl hover:scale-105 transition-transform shadow-lg shadow-cyan-500/30 active:scale-95"><i className="fas fa-rocket"></i></button>
                   <button onClick={leaveRoom} className="w-20 h-14 rounded-2xl bg-red-500/20 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center text-xl transition-all active:scale-95"><i className="fas fa-phone-slash"></i></button>
               </div>
          </div>

       </div>

       {/* Chat Sidebar */}
       <div className={`fixed inset-y-0 right-0 w-80 bg-[#0a0a0a] border-l border-white/5 transform transition-transform duration-300 z-40 flex flex-col ${showMobileChat ? 'translate-x-0' : 'translate-x-full md:translate-x-0 md:static'}`}>
           <div className="h-16 flex items-center px-6 border-b border-white/5 font-bold tracking-widest text-xs text-gray-500 uppercase justify-between">
               <span>Chat du salon</span>
               <button className="md:hidden" onClick={()=>setShowMobileChat(false)}><i className="fas fa-times"></i></button>
           </div>
           <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4">
               {chatHistory.map(msg => (
                   <div key={msg.id} className="animate-in slide-in-from-right-2 duration-300">
                       <div className="flex items-baseline justify-between mb-1">
                           <span className="font-bold text-sm text-cyan-500">{msg.senderName}</span>
                           <span className="text-[10px] text-gray-600">{new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                       </div>
                       <div className="bg-white/5 rounded-xl rounded-tl-none p-3 text-sm text-gray-300 leading-relaxed border border-white/5">
                           {msg.text}
                           {msg.image && <img src={msg.image} className="mt-2 rounded-lg" />}
                       </div>
                   </div>
               ))}
               <div ref={chatBottomRef}></div>
           </div>
           <div className="p-4 bg-[#0a0a0a] border-t border-white/5">
               <div className="bg-white/5 rounded-xl flex items-center p-1 border border-white/5 focus-within:border-cyan-500 transition-colors">
                   <button onClick={()=>mediaUploadRef.current?.click()} className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-white transition-colors"><i className="fas fa-plus"></i></button>
                   <input type="text" value={messageInput} onChange={e=>setMessageInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&messageInput.trim()){ broadcastData({type:'chat',text:messageInput,sender:peerId||'',senderName:displayName}); setChatHistory(prev=>[...prev,{id:Date.now().toString(),sender:peerId||'',senderName:displayName,text:messageInput,timestamp:Date.now()}]); setMessageInput(''); }}} className="bg-transparent flex-1 focus:outline-none text-sm px-2 text-white" placeholder="Message..." />
                   <input type="file" ref={mediaUploadRef} className="hidden" onChange={(e)=>{const f=e.target.files?.[0]; if(f){const r=new FileReader(); r.onloadend=()=>{broadcastData({type:'file-share',file:r.result as string,fileName:f.name,fileType:f.type,sender:peerId||'',senderName:displayName}); setChatHistory(prev=>[...prev,{id:Date.now().toString(),sender:peerId||'',senderName:displayName,image:r.result as string,timestamp:Date.now()}]);}; r.readAsDataURL(f);}}} />
               </div>
           </div>
       </div>

       {/* Incoming Call Overlay */}
       {incomingCall && (
           <div className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-xl flex items-center justify-center animate-in fade-in">
               <div className="text-center animate-bounce-slow">
                   <div className="w-32 h-32 rounded-full bg-cyan-500 flex items-center justify-center text-4xl font-bold mb-6 shadow-[0_0_50px_rgba(6,182,212,0.5)] mx-auto">
                       {getInitials(incomingCall.call.peer)}
                   </div>
                   <h2 className="text-3xl font-bold mb-2">{incomingCall.metadata?.displayName || 'Inconnu'}</h2>
                   <p className="text-gray-400 mb-8">veut rejoindre le Nexus...</p>
                   <div className="flex space-x-6 justify-center">
                       <button onClick={()=>setIncomingCall(null)} className="w-16 h-16 rounded-full bg-red-500/20 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center text-2xl transition-all hover:scale-110"><i className="fas fa-times"></i></button>
                       <button onClick={acceptCall} className="w-16 h-16 rounded-full bg-green-500/20 text-green-500 hover:bg-green-500 hover:text-white flex items-center justify-center text-2xl transition-all hover:scale-110"><i className="fas fa-check"></i></button>
                   </div>
               </div>
           </div>
       )}
    </div>
  );
}
