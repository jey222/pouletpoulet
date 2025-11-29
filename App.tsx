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

const MAX_PEERS_LIMIT = 4; 
const WB_COLORS = [
    '#000000', '#57534e', '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', 
    '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e', '#881337'
];

// --- WebRTC Constraints for CPU/Bandwidth Optimization ---
const VIDEO_CONSTRAINTS_CAM = {
    width: { ideal: 1280, max: 1920 },
    height: { ideal: 720, max: 1080 },
    frameRate: { ideal: 30, max: 30 }
};

const VIDEO_CONSTRAINTS_SCREEN = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 }
};

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
  // Whiteboard Throttling
  const wbDrawingQueueRef = useRef<DrawLine[]>([]);
  const wbLastSentRef = useRef<number>(0);

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

  // Whiteboard Sync Interval (Throttling)
  useEffect(() => {
      const interval = setInterval(() => {
          if (wbDrawingQueueRef.current.length > 0) {
              const batch = [...wbDrawingQueueRef.current];
              wbDrawingQueueRef.current = []; // Clear queue
              
              // Broadcast the batch
              broadcastData({ 
                  type: 'activity', 
                  activityType: 'whiteboard', 
                  action: 'draw-batch', 
                  data: { drawBatch: batch, pageIndex: wbPageIndex } 
              });
          }
      }, 25); // 40fps sync rate

      return () => clearInterval(interval);
  }, [wbPageIndex]);

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
    
    // If no video track exists, create one with optimized constraints
    if (!videoTrack) {
        try {
            const constraints = selectedCamId ? 
                { ...VIDEO_CONSTRAINTS_CAM, deviceId: { exact: selectedCamId } } : 
                VIDEO_CONSTRAINTS_CAM;

            const videoStream = await navigator.mediaDevices.getUserMedia({ video: constraints });
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

  const restoreCamera = async () => {
      try {
          const constraints = selectedCamId ? 
              { ...VIDEO_CONSTRAINTS_CAM, deviceId: { exact: selectedCamId } } : 
              VIDEO_CONSTRAINTS_CAM;
              
          // Ensure we get a fresh video stream
          const camStream = await navigator.mediaDevices.getUserMedia({ video: constraints });
          const camTrack = camStream.getVideoTracks()[0];
          
          if(!isVideoEnabledRef.current) camTrack.enabled = false;

          // Replace in local stream
          if(localStream) {
              const oldTracks = localStream.getVideoTracks();
              oldTracks.forEach(t => { t.stop(); localStream.removeTrack(t); });
              localStream.addTrack(camTrack);
          }
          
          // Replace in processed stream (what goes out)
          if(processedStream) {
               const oldTracks = processedStream.getVideoTracks();
               oldTracks.forEach(t => { processedStream.removeTrack(t); });
               processedStream.addTrack(camTrack);
          }

          // Replace for peers
          peersRef.current.forEach(peer => {
             if (peer.mediaCall && peer.mediaCall.peerConnection) {
                 const sender = peer.mediaCall.peerConnection.getSenders().find((s: any) => s.track && s.track.kind === 'video');
                 if (sender) sender.replaceTrack(camTrack);
             }
          });

      } catch (e) {
          addLog("Impossible de restaurer la caméra", "error");
      }
  };

  const toggleScreenShare = async () => {
      if (isScreenSharing) {
          // STOP SHARING MANUALLY
          setIsScreenSharing(false);
          await restoreCamera();
          playSound(SOUND_UI_OFF);
          broadcastData({type:'status', videoEnabled:isVideoEnabled, muted:isMuted, deafened:isDeafened, isScreenSharing:false, currentActivity:myCurrentActivity});
      } else {
          // START SHARING
          try {
              const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: VIDEO_CONSTRAINTS_SCREEN, audio: false });
              const screenTrack = screenStream.getVideoTracks()[0];
              
              // Handle "Stop Sharing" from browser UI
              screenTrack.onended = () => { 
                  if (isScreenSharingRef.current) {
                      setIsScreenSharing(false);
                      restoreCamera();
                      broadcastData({type:'status', videoEnabled:isVideoEnabledRef.current, muted:isMutedRef.current, deafened:isDeafenedRef.current, isScreenSharing:false, currentActivity:myActivityRef.current});
                  }
              };

              // Replace for peers
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
          const meta = conn.metadata || {};
          addLog(`${meta.displayName || 'Un ami'} a rejoint le Cosmos`, 'success');
          
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
              // Toast Logic for Status Changes
              const prevPeer = peersRef.current.get(senderId);
              if (prevPeer) {
                  if (!prevPeer.status.isScreenSharing && data.isScreenSharing) {
                      addLog(`${prevPeer.displayName} partage son écran`, 'info');
                  }
                  if (!prevPeer.status.muted && data.muted) {
                      addLog(`${prevPeer.displayName} a coupé son micro`, 'info');
                  }
              }

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
        
        // Handle Single Line (Legacy/Sync)
        if (data.action === 'draw' && data.data?.drawData) {
            const page = data.data.pageIndex || 0;
            if(!wbHistoryRef.current.has(page)) wbHistoryRef.current.set(page, []);
            wbHistoryRef.current.get(page)?.push(data.data.drawData);
            if (page === wbPageIndex && canvasRef.current) {
                drawOnCanvas(data.data.drawData, canvasRef.current);
            }
        } 
        // Handle Batched Lines (Optimized)
        else if (data.action === 'draw-batch' && data.data?.drawBatch) {
             const page = data.data.pageIndex || 0;
             if(!wbHistoryRef.current.has(page)) wbHistoryRef.current.set(page, []);
             const history = wbHistoryRef.current.get(page);
             
             data.data.drawBatch.forEach(line => {
                 history?.push(line);
                 if (page === wbPageIndex && canvasRef.current) {
                     drawOnCanvas(line, canvasRef.current);
                 }
             });
        }
        else if (data.action === 'clear') {
             if(canvasRef.current && wbPageIndex === wbPageIndex) {
                 const ctx = canvasRef.current.getContext('2d');
                 ctx?.clearRect(0,0, canvasRef.current.width, canvasRef.current.height);
             }
             wbHistoryRef.current.set(wbPageIndex, []);
        } else if (data.action === 'set-page' && typeof data.data?.pageIndex === 'number') {
             setWbPageIndex(data.data.pageIndex);
        } else if (data.action === 'sync-request') {
             // Send full history to new peer
             const allHistory: any[] = [];
             wbHistoryRef.current.forEach((lines, page) => {
                 // We can optimize sync by sending batches too
                 if (lines.length > 0) {
                    allHistory.push({ action: 'draw-batch', data: { drawBatch: lines, pageIndex: page }});
                 }
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
      
      // Relative coordinates conversion
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
    link.download = `dessin-cosmos-${wbPageIndex+1}.png`;
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
    setTimeout(() => setLogs(prev => prev.filter(log => log.id !== id)), 3000); // 3 seconds timeout
  };
  const getInitials = (name: string) => name ? name.charAt(0).toUpperCase() : '?';
  const playSound = (src: string) => { const a = new Audio(src); a.volume = 0.5; a.play().catch(()=>{}); };

  const toggleFullscreen = (e: React.MouseEvent) => {
      e.stopPropagation();
      // Find the closest parent with class 'video-unit'
      const container = e.currentTarget.closest('.video-unit');
      if (container) {
          if (!document.fullscreenElement) {
              container.requestFullscreen().catch((err: any) => console.log(err));
          } else {
              document.exitFullscreen();
          }
      }
  };

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
          <div className={`video-unit relative bg-slate-800/80 backdrop-blur-md rounded-3xl overflow-hidden flex items-center justify-center group w-full h-full shadow-2xl transition-all duration-500 ease-out border border-white/5
               ${speaking ? 'border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.2)]' : ''}`}
               onDoubleClick={(e) => {
                    e.currentTarget.requestFullscreen().catch(err => console.log(err));
               }}
               onContextMenu={!isLocal ? (e) => { e.preventDefault(); setContextMenu({x: e.clientX, y: e.clientY, peerId: peer.id}) } : undefined}
          >
              {/* Fullscreen Button Overlay */}
              <div className="absolute top-4 left-4 z-40 opacity-0 group-hover:opacity-100 transition-opacity">
                   <button onClick={toggleFullscreen} className="bg-slate-900/50 hover:bg-slate-900/80 text-white rounded-full w-8 h-8 flex items-center justify-center transition-all backdrop-blur-sm border border-white/10">
                       <i className="fas fa-expand text-xs"></i>
                   </button>
              </div>

              {(!status.videoEnabled && !status.isScreenSharing) && (
                  <div className={`w-32 h-32 rounded-full flex items-center justify-center overflow-hidden z-20 ${speaking ? 'ring-4 ring-indigo-500/50' : ''} transition-all duration-300 transform group-hover:scale-110 shadow-lg`}>
                      {avatar ? <img src={avatar} className="w-full h-full object-cover"/> : 
                      <div className="w-full h-full bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center text-4xl font-bold text-white border border-white/10">{getInitials(display)}</div>}
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
                 autoPlay playsInline className={`absolute inset-0 w-full h-full bg-slate-900 ${status.videoEnabled || status.isScreenSharing ? 'block' : 'hidden'} ${status.isScreenSharing ? 'object-contain' : (isLocal ? 'object-cover scale-x-[-1]' : 'object-cover')}`}
              />
              <div className="absolute bottom-4 left-4 bg-slate-900/60 backdrop-blur-md px-3 py-1.5 rounded-full text-white text-xs font-semibold border border-white/10 flex items-center z-30 select-none shadow-lg">
                  {display}
                  {status.muted && <i className="fas fa-microphone-slash text-red-400 ml-2"></i>}
                  {status.deafened && <i className="fas fa-headphones-alt text-red-400 ml-2"></i>}
              </div>
              
              {!isLocal && activity !== 'none' && (
                  <div className="absolute top-4 right-4 flex flex-col items-end space-y-2 z-30">
                      <div className="bg-slate-900/60 backdrop-blur px-3 py-1.5 rounded-full border border-white/10 text-xs font-semibold text-white flex items-center shadow-lg">
                          <i className={`fas ${activity === 'youtube' ? 'fa-play text-red-500' : 'fa-pen text-indigo-500'} mr-2`}></i>
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
                           className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-full text-xs font-bold transition-all hover:scale-105 shadow-lg shadow-indigo-500/30">
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
      <div className={`fixed inset-0 bg-slate-950 z-[100] transition-opacity duration-700 pointer-events-none ${isTransitioning ? 'opacity-100' : 'opacity-0'}`}></div>
  );

  // TOAST CONTAINER
  const toastContainer = (
    <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-[110] flex flex-col items-center space-y-2 pointer-events-none">
        {logs.map(log => (
            <div key={log.id} className="bg-slate-900/80 backdrop-blur-xl border border-white/10 px-5 py-2.5 rounded-full shadow-2xl text-sm font-medium animate-in fade-in slide-in-from-top-4 text-white flex items-center">
                 {log.type === 'success' && <i className="fas fa-check-circle text-green-400 mr-2"></i>}
                 {log.type === 'info' && <i className="fas fa-info-circle text-blue-400 mr-2"></i>}
                 {log.type === 'error' && <i className="fas fa-exclamation-circle text-red-400 mr-2"></i>}
                 {log.message}
            </div>
        ))}
    </div>
  );

  if (viewState === 'login') {
      return (
          <div className="h-screen flex items-center justify-center bg-[#0f172a] font-sans text-slate-200 overflow-hidden relative">
              <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/20 rounded-full blur-[120px]"></div>
              <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-600/20 rounded-full blur-[120px]"></div>

              {transitionOverlay}
              <div className="w-full max-w-sm bg-white/5 backdrop-blur-2xl p-8 rounded-3xl border border-white/10 shadow-2xl animate-in fade-in zoom-in duration-700 relative z-10">
                  <div className="flex justify-center mb-8">
                      <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center text-white text-4xl shadow-lg shadow-indigo-500/30 transform rotate-3">
                          <i className="fas fa-atom"></i>
                      </div>
                  </div>
                  <h1 className="text-3xl font-bold text-center mb-2 tracking-tight">CosmosP2P</h1>
                  <p className="text-slate-400 text-center mb-8 text-sm">Le futur de la communication décentralisée.</p>
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
                      <input type="text" value={username} onChange={e=>setUsername(e.target.value)} className="w-full bg-slate-800/50 border border-white/10 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 rounded-xl p-3.5 text-white placeholder-slate-500 focus:outline-none transition-all mb-4 text-center font-medium" placeholder="Votre Pseudo" />
                      <button disabled={isLoading} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3.5 rounded-xl font-bold transition-all shadow-lg shadow-indigo-600/20 hover:scale-[1.02] active:scale-[0.98]">
                        {isLoading ? "Connexion..." : "Entrer dans le Cosmos"}
                      </button>
                  </form>
                  {loginError && <p className="text-red-400 text-center mt-4 text-xs font-semibold bg-red-500/10 py-2 rounded-lg">{loginError}</p>}
              </div>
          </div>
      );
  }

  // LOBBY SCREEN
  if (viewState === 'lobby') {
      return (
          <div className="h-screen bg-[#0f172a] flex overflow-hidden font-sans text-slate-200 selection:bg-indigo-500/30">
               {transitionOverlay}
               
               {/* SIDEBAR LOBBY */}
               <div className="w-80 bg-slate-900/50 backdrop-blur-xl border-r border-white/5 p-6 flex flex-col z-20">
                   <div className="flex items-center space-x-4 mb-10">
                       <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 p-0.5 cursor-pointer hover:ring-2 ring-indigo-500/50 transition-all shadow-lg" onClick={()=>fileInputRef.current?.click()}>
                           <div className="w-full h-full rounded-full overflow-hidden relative group">
                               {localAvatar ? <img src={localAvatar} className="w-full h-full object-cover"/> : <div className="w-full h-full flex items-center justify-center font-bold text-lg bg-slate-800 text-white">{getInitials(displayName)}</div>}
                               <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><i className="fas fa-camera text-xs"></i></div>
                           </div>
                       </div>
                       <div>
                           <h2 className="font-bold text-base text-white">{displayName}</h2>
                           <div className="text-[11px] text-slate-400 font-mono bg-slate-800/50 border border-white/5 px-2 py-0.5 rounded-md mt-1 cursor-pointer flex items-center group hover:bg-slate-800 transition-colors" onClick={()=>{navigator.clipboard.writeText(peerId||''); addLog('Copié !', 'success')}}>
                               {peerId} <i className="fas fa-copy ml-1 opacity-0 group-hover:opacity-100 text-indigo-400"></i>
                           </div>
                       </div>
                   </div>
                   
                   <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 pl-1">Connexion Directe</h3>
                   <form onSubmit={(e)=>{ e.preventDefault(); if(remoteIdInput.trim() !== peerId) { connectToPeer(remoteIdInput.trim());} }} className="space-y-3">
                       <input type="text" value={remoteIdInput} onChange={e=>setRemoteIdInput(e.target.value)} placeholder="ID du salon..." className="w-full bg-slate-800/50 border border-white/5 rounded-xl p-3 text-sm focus:border-indigo-500/50 focus:outline-none transition-all placeholder-slate-600" />
                       <button className="w-full bg-white text-slate-900 py-3 rounded-xl font-bold text-sm hover:bg-indigo-50 transition-all shadow-lg hover:scale-[1.02] active:scale-[0.98]">
                           Rejoindre
                       </button>
                   </form>
                   <input type="file" ref={fileInputRef} onChange={e=>{ const f = e.target.files?.[0]; if(f){const r = new FileReader(); r.onloadend=()=>{localAvatarRef.current=r.result as string; setLocalAvatar(r.result as string);}; r.readAsDataURL(f);} }} className="hidden"/>

                   <div className="mt-auto">
                       <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4">
                           <div className="flex items-center text-indigo-400 mb-2">
                               <i className="fas fa-broadcast-tower mr-2"></i>
                               <span className="text-xs font-bold uppercase">Status Réseau</span>
                           </div>
                           <div className="text-xs text-slate-400">Connecté au réseau P2P global. Prêt à échanger.</div>
                       </div>
                   </div>
               </div>

               <div className="flex-1 p-8 md:p-12 overflow-y-auto bg-[#0f172a] relative">
                   <div className="absolute top-0 left-0 w-full h-64 bg-gradient-to-b from-indigo-900/10 to-transparent pointer-events-none"></div>
                   <div className="max-w-6xl mx-auto relative z-10">
                       <header className="mb-12">
                           <h1 className="text-4xl font-bold mb-2 tracking-tight text-white">Espaces</h1>
                           <p className="text-slate-400">Créez un salon instantané et invitez vos pairs.</p>
                       </header>

                       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                           {[
                               { t: "Duo", c: 2, icon: "fa-user", color: "text-indigo-400", from: "from-slate-800", to: "to-slate-900" },
                               { t: "Squad", c: 3, icon: "fa-users", color: "text-purple-400", from: "from-slate-800", to: "to-slate-900" },
                               { t: "Full", c: 4, icon: "fa-globe", color: "text-cyan-400", from: "from-slate-800", to: "to-slate-900" },
                               { t: "Ciné", c: 4, icon: "fa-play", mode: 'cinema', color: "text-red-400", from: "from-slate-800", to: "to-slate-900" }
                           ].map((item, i) => (
                               <div key={i} onClick={()=>{ startRoomTransition(item.c, item.mode as any); }} 
                                    className={`bg-gradient-to-br ${item.from} ${item.to} hover:from-slate-700 hover:to-slate-800 border border-white/5 p-6 rounded-3xl cursor-pointer transition-all duration-300 hover:-translate-y-1 h-44 flex flex-col justify-between group shadow-xl hover:shadow-2xl hover:border-white/10`}>
                                   <div className="flex justify-between items-start">
                                       <div className={`w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-xl ${item.color} group-hover:scale-110 transition-transform`}>
                                            <i className={`fas ${item.icon}`}></i>
                                       </div>
                                       <span className="text-[10px] bg-black/20 px-2 py-1 rounded-full text-slate-400 border border-white/5">{item.c} max</span>
                                   </div>
                                   <div>
                                       <h3 className="font-bold text-lg text-white">{item.t}</h3>
                                       <p className="text-xs text-slate-500 mt-1">Lancer l'espace</p>
                                   </div>
                               </div>
                           ))}
                       </div>

                       {/* NOUVEAUTÉS SECTION */}
                       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                           <div className="md:col-span-2 bg-gradient-to-r from-indigo-900/40 to-purple-900/40 backdrop-blur-xl rounded-3xl p-10 border border-white/10 relative overflow-hidden group shadow-2xl">
                                <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/20 rounded-full blur-[100px] -mr-20 -mt-20 pointer-events-none"></div>
                                <div className="relative z-10">
                                    <div className="inline-block bg-indigo-500/20 border border-indigo-500/30 backdrop-blur px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide mb-4 text-indigo-200 shadow-lg">
                                        Mise à jour 2.0
                                    </div>
                                    <h3 className="text-3xl font-bold mb-3 text-white">Whiteboard Infini</h3>
                                    <p className="text-slate-300 text-sm mb-8 max-w-md leading-relaxed">
                                        Collaboration visuelle réinventée. Dessinez à plusieurs avec une latence nulle, exportez en haute définition et profitez d'une interface fluide.
                                    </p>
                                    <button onClick={()=>{ startRoomTransition(3); setTimeout(()=>startWhiteboard(), 600); }} className="bg-white text-slate-900 px-6 py-3 rounded-xl font-bold text-sm hover:bg-indigo-50 transition-all flex items-center shadow-lg hover:scale-105 active:scale-95">
                                        Essayer maintenant <i className="fas fa-arrow-right ml-2 text-xs"></i>
                                    </button>
                                </div>
                                <i className="fas fa-paint-brush absolute -bottom-4 right-8 text-[10rem] text-white/5 group-hover:text-white/10 transition-colors rotate-12 pointer-events-none"></i>
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
          <div className="h-screen bg-[#0f172a] flex flex-col items-center justify-center text-white relative overflow-hidden">
               <div className="absolute inset-0 bg-indigo-900/10 blur-[100px] pointer-events-none"></div>
               {transitionOverlay}
               <div className="w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-8"></div>
               <h2 className="text-2xl font-bold mb-2 tracking-tight">Connexion au Salon...</h2>
               <p className="text-slate-400 text-sm mb-8">En attente de l'autorisation de l'hôte.</p>
               <button onClick={()=>{ leaveRoom(); }} className="px-6 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all text-sm font-semibold">Annuler</button>
          </div>
      );
  }
  
  return (
    <div className="flex h-screen bg-[#0f172a] overflow-hidden text-slate-200 font-sans" onContextMenu={e => e.preventDefault()}>
       {transitionOverlay}
       {toastContainer}
       
       {contextMenu && (
           <div className="fixed z-[100] bg-slate-800/90 backdrop-blur-xl border border-white/10 rounded-xl p-4 shadow-2xl w-56" style={{top: contextMenu.y, left: contextMenu.x}}>
               <div className="text-[10px] font-bold text-slate-500 uppercase mb-3 px-1">Volume Utilisateur</div>
               <input 
                  type="range" min="0" max="1" step="0.1" 
                  defaultValue={peers.get(contextMenu.peerId)?.volume || 1}
                  onChange={(e) => {
                      const vol = parseFloat(e.target.value);
                      addPeer(contextMenu.peerId, { volume: vol });
                  }}
                  className="w-full accent-indigo-500 h-1.5 bg-slate-600 rounded-lg appearance-none cursor-pointer"
               />
           </div>
       )}

        {/* Settings Modal */}
        {showSettingsModal && (
            <div className="absolute inset-0 z-[80] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm" onClick={()=>setShowSettingsModal(false)}>
                <div className="bg-slate-900/90 backdrop-blur-xl p-8 rounded-3xl w-full max-w-md border border-white/10 shadow-2xl transform transition-all scale-100" onClick={e=>e.stopPropagation()}>
                    <h3 className="text-2xl font-bold mb-6 text-white">Paramètres</h3>
                    <div className="space-y-6">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase block mb-2">Microphone</label>
                            <div className="relative">
                                <select value={selectedMicId} onChange={e=>changeAudioInput(e.target.value)} className="w-full bg-slate-800 text-white rounded-xl p-3 text-sm outline-none border border-white/5 focus:border-indigo-500/50 appearance-none">
                                    <option value="">Par défaut</option>
                                    {inputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                                </select>
                                <i className="fas fa-chevron-down absolute right-3 top-3.5 text-xs text-slate-500 pointer-events-none"></i>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase block mb-2">Volume Gain</label>
                            <input type="range" min="0" max="2" step="0.1" value={micGain} onChange={e=>setMicGain(parseFloat(e.target.value))} className="w-full accent-indigo-500 h-1.5 bg-slate-700 rounded-lg appearance-none"/>
                        </div>
                        <div className="pt-6 border-t border-white/5">
                            <label className="text-xs font-bold text-slate-500 uppercase block mb-2">Pseudo</label>
                            <div className="flex space-x-3">
                                <input type="text" value={displayName} onChange={e=>setDisplayName(e.target.value)} className="flex-1 bg-slate-800 rounded-xl p-3 text-sm border border-white/5 focus:border-indigo-500/50 focus:outline-none" />
                                <button onClick={()=>{broadcastData({type:'profile-update', displayName:displayName, avatar:localAvatarRef.current}); setShowSettingsModal(false);}} className="bg-white text-slate-900 px-5 rounded-xl font-bold text-sm hover:bg-indigo-50 transition-colors">OK</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )}

       {/* Activity Selection Modal */}
       {showActivityModal && (
           <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm" onClick={()=>setShowActivityModal(false)}>
               <div className="bg-slate-900/90 backdrop-blur-xl p-8 rounded-3xl w-full max-w-sm border border-white/10 shadow-2xl" onClick={e=>e.stopPropagation()}>
                   <h3 className="text-xl font-bold mb-6 text-center text-white">Choisir une activité</h3>
                   <div className="grid grid-cols-2 gap-4">
                       <button onClick={()=>{ startYoutubeActivity(); setShowActivityModal(false); }} className="bg-slate-800/50 hover:bg-slate-800 p-6 rounded-2xl flex flex-col items-center transition-all border border-white/5 hover:border-red-500/30 group">
                           <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                                <i className="fab fa-youtube text-2xl text-red-500"></i>
                           </div>
                           <span className="font-bold text-sm text-white">YouTube</span>
                       </button>
                       <button onClick={()=>{ startWhiteboard(); setShowActivityModal(false); }} className="bg-slate-800/50 hover:bg-slate-800 p-6 rounded-2xl flex flex-col items-center transition-all border border-white/5 hover:border-indigo-500/30 group">
                           <div className="w-12 h-12 rounded-full bg-indigo-500/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                                <i className="fas fa-pen-nib text-2xl text-indigo-500"></i>
                           </div>
                           <span className="font-bold text-sm text-white">Dessin</span>
                       </button>
                   </div>
               </div>
           </div>
       )}

       {/* Main View */}
       <div className="flex-1 flex flex-col relative bg-[#0f172a]">
          
          {/* Header */}
          <div className="h-20 flex items-center justify-between px-8 z-20 pointer-events-none">
               <div className="pointer-events-auto bg-slate-800/50 backdrop-blur-md px-4 py-2 rounded-full flex items-center space-x-3 hover:bg-slate-800 transition-colors cursor-pointer border border-white/5 shadow-lg" onClick={()=>navigator.clipboard.writeText(peerId||'')}>
                   <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]"></div>
                   <span className="font-mono text-xs font-bold text-slate-300 tracking-wide">{peerId}</span>
               </div>
               <div className="pointer-events-auto flex space-x-3">
                   <button onClick={()=>setShowSettingsModal(true)} className="w-10 h-10 bg-slate-800/50 rounded-full flex items-center justify-center border border-white/5 hover:bg-white hover:text-slate-900 transition-all text-sm shadow-lg"><i className="fas fa-cog"></i></button>
               </div>
          </div>

          <div className="flex-1 px-8 pb-24 flex items-center justify-center relative">
              
              {/* Activity View (Pinned) */}
              {activityView && pinnedView === 'activity' && (
                  <div className="absolute inset-4 z-10 bg-slate-900 rounded-3xl border border-white/10 overflow-hidden shadow-2xl flex flex-col animate-in zoom-in duration-300 ring-1 ring-white/5">
                      <div className="h-12 bg-slate-800/50 flex items-center justify-between px-6 border-b border-white/5 backdrop-blur-md">
                          <span className="font-bold text-xs text-slate-400 uppercase tracking-wider flex items-center">
                              <i className={`fas ${activityView.type === 'youtube' ? 'fa-play text-red-500' : 'fa-pen text-indigo-500'} mr-2`}></i>
                              {activityView.type === 'youtube' ? 'YouTube Together' : 'Whiteboard Pro'}
                          </span>
                          <button onClick={()=>{setActivityView(null); setPinnedView(null); setMyCurrentActivity('none'); broadcastData({type:'status', muted:isMuted, deafened:isDeafened, videoEnabled:isVideoEnabled, isScreenSharing:isScreenSharing, currentActivity:'none'})}} className="w-8 h-8 rounded-full hover:bg-white/5 flex items-center justify-center text-slate-500 hover:text-white transition-colors"><i className="fas fa-times"></i></button>
                      </div>
                      
                      <div className="flex-1 flex overflow-hidden">
                          {/* YOUTUBE UI */}
                          {activityView.type === 'youtube' && (
                              <div className="flex w-full h-full">
                                  {/* Player Section */}
                                  <div className="flex-1 flex flex-col bg-black relative">
                                       {currentVideo ? (
                                           <div id="youtube-player" className="w-full h-full"></div>
                                       ) : (
                                           <div className="flex-1 flex flex-col items-center justify-center text-slate-700">
                                               <i className="fab fa-youtube text-7xl mb-6 opacity-20"></i>
                                               <p className="font-medium">Aucune vidéo sélectionnée</p>
                                           </div>
                                       )}
                                  </div>
                                  
                                  {/* Sidebar Queue & Search */}
                                  <div className="w-80 bg-slate-900 border-l border-white/5 flex flex-col">
                                      {/* Search Bar */}
                                      <div className="p-5 border-b border-white/5">
                                          <div className="flex space-x-2">
                                              <input 
                                                type="text" 
                                                value={youtubeInput} 
                                                onChange={e=>setYoutubeInput(e.target.value)} 
                                                placeholder="Lien YouTube..." 
                                                className="flex-1 bg-slate-800/50 border border-white/10 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-red-500/50 transition-colors text-white placeholder-slate-500"
                                                onKeyDown={e => {if(e.key === 'Enter') addToQueue()}}
                                              />
                                              <button onClick={addToQueue} className="bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white p-2.5 rounded-xl transition-all border border-red-500/20">
                                                  <i className="fas fa-plus text-xs"></i>
                                              </button>
                                          </div>
                                      </div>

                                      {/* Queue List */}
                                      <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                                          {youtubeQueue.length === 0 && <div className="text-center text-slate-600 text-xs mt-10">File d'attente vide</div>}
                                          {youtubeQueue.map((item, idx) => (
                                              <div key={item.id} className={`group flex items-start space-x-3 p-2 rounded-xl hover:bg-white/5 transition-colors ${currentVideo?.id === item.id ? 'bg-white/5 ring-1 ring-red-500/50' : ''}`}>
                                                  <div className="relative w-24 h-14 bg-black rounded-lg overflow-hidden shrink-0 cursor-pointer shadow-md" onClick={()=>playVideo(item)}>
                                                      <img src={item.thumbnail} className="w-full h-full object-cover opacity-80 hover:opacity-100 transition-opacity"/>
                                                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                          <div className="w-6 h-6 rounded-full bg-black/50 backdrop-blur flex items-center justify-center">
                                                               <i className={`fas ${currentVideo?.id === item.id ? 'fa-chart-bar' : 'fa-play'} text-white text-[10px]`}></i>
                                                          </div>
                                                      </div>
                                                  </div>
                                                  <div className="flex-1 min-w-0 py-1">
                                                      <h4 className="text-xs font-bold truncate text-slate-200 cursor-pointer hover:text-white transition-colors" onClick={()=>playVideo(item)}>{item.title}</h4>
                                                      <p className="text-[10px] text-slate-500 mt-0.5">Ajouté par {item.addedByName}</p>
                                                      
                                                      {/* Controls */}
                                                      <div className="flex items-center space-x-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                          <button onClick={()=>moveQueueItem(idx, 'up')} disabled={idx===0} className="text-slate-500 hover:text-white disabled:opacity-30"><i className="fas fa-chevron-up text-[10px]"></i></button>
                                                          <button onClick={()=>moveQueueItem(idx, 'down')} disabled={idx===youtubeQueue.length-1} className="text-slate-500 hover:text-white disabled:opacity-30"><i className="fas fa-chevron-down text-[10px]"></i></button>
                                                          <div className="grow"></div>
                                                          <button onClick={()=>removeFromQueue(item.id)} className="text-slate-500 hover:text-red-400"><i className="fas fa-trash text-[10px]"></i></button>
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
                                  <div className="h-16 border-b border-gray-100 flex items-center justify-between px-6 bg-white text-gray-800 shrink-0 shadow-sm z-10">
                                      <div className="flex items-center space-x-4">
                                          <div className="flex space-x-1.5 p-1 bg-gray-100 rounded-full">
                                              {WB_COLORS.map(c => (
                                                  <button key={c} onClick={()=> {setWbColor(c); setWbIsEraser(false)}} className={`w-5 h-5 rounded-full hover:scale-110 transition-transform ${wbColor === c && !wbIsEraser ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''}`} style={{backgroundColor: c}}></button>
                                              ))}
                                          </div>
                                          <div className="w-px h-6 bg-gray-200 mx-2"></div>
                                          <div className="flex items-center space-x-2 bg-gray-100 rounded-lg p-1">
                                            <button onClick={()=>setWbIsEraser(false)} className={`p-2 rounded-md transition-colors ${!wbIsEraser ? 'bg-white shadow text-black' : 'text-gray-500 hover:text-black'}`}><i className="fas fa-pen text-xs"></i></button>
                                            <button onClick={()=>setWbIsEraser(true)} className={`p-2 rounded-md transition-colors ${wbIsEraser ? 'bg-white shadow text-black' : 'text-gray-500 hover:text-black'}`}><i className="fas fa-eraser text-xs"></i></button>
                                          </div>
                                          <input type="range" min="1" max="20" value={wbSize} onChange={(e)=>setWbSize(parseInt(e.target.value))} className="w-24 accent-slate-800" />
                                      </div>
                                      <div className="flex items-center space-x-3">
                                          <div className="flex items-center space-x-1 bg-gray-100 border border-gray-200 rounded-lg px-1 py-0.5">
                                              <button onClick={()=>{
                                                  const newPage = Math.max(0, wbPageIndex - 1);
                                                  setWbPageIndex(newPage);
                                                  broadcastData({type:'activity', activityType:'whiteboard', action:'set-page', data:{pageIndex: newPage}});
                                              }} className="w-8 h-8 flex items-center justify-center hover:bg-white rounded-md transition-colors text-gray-600"><i className="fas fa-chevron-left text-xs"></i></button>
                                              <span className="text-xs font-bold font-mono w-6 text-center text-gray-700">{wbPageIndex + 1}</span>
                                              <button onClick={()=>{
                                                  const newPage = wbPageIndex + 1;
                                                  setWbPageIndex(newPage);
                                                  broadcastData({type:'activity', activityType:'whiteboard', action:'set-page', data:{pageIndex: newPage}});
                                              }} className="w-8 h-8 flex items-center justify-center hover:bg-white rounded-md transition-colors text-gray-600"><i className="fas fa-chevron-right text-xs"></i></button>
                                          </div>
                                          <button onClick={downloadWhiteboard} className="bg-gray-900 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-black transition-colors shadow-lg"><i className="fas fa-download mr-1"></i> Export</button>
                                          <button onClick={() => {
                                              const ctx = canvasRef.current?.getContext('2d');
                                              ctx?.clearRect(0,0, canvasRef.current!.width, canvasRef.current!.height);
                                              wbHistoryRef.current.set(wbPageIndex, []);
                                              broadcastData({type:'activity', activityType:'whiteboard', action:'clear'});
                                          }} className="text-red-400 hover:text-red-600 p-2 transition-colors"><i className="fas fa-trash"></i></button>
                                      </div>
                                  </div>
                                  {/* Canvas */}
                                  <div className="flex-1 overflow-hidden relative bg-[#f8fafc]">
                                    <div className="absolute inset-0 opacity-5" style={{backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px)', backgroundSize: '20px 20px'}}></div>
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
                                        className="absolute inset-0 w-full h-full cursor-crosshair touch-none z-10"
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
                                            
                                            // Draw immediately locally for zero lag
                                            drawOnCanvas(drawData, e.currentTarget);
                                            
                                            // Save to history
                                            if(!wbHistoryRef.current.has(wbPageIndex)) wbHistoryRef.current.set(wbPageIndex, []);
                                            wbHistoryRef.current.get(wbPageIndex)?.push(drawData);
                                            
                                            // Push to batch queue for network
                                            wbDrawingQueueRef.current.push(drawData);

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
              <div className={`grid gap-6 w-full h-full max-w-7xl transition-all duration-500 ease-out-expo ${pinnedView === 'activity' ? 'opacity-0 pointer-events-none scale-95' : ''} ${activePeers.length === 0 ? 'grid-cols-1' : activePeers.length === 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-2'}`}>
                  {renderVideoUnit('local')}
                  {activePeers.map(peer => <div key={peer.id} className="w-full h-full animate-in zoom-in duration-500">{renderVideoUnit(peer)}</div>)}
                  {activePeers.length === 0 && (
                      <div className="border-2 border-dashed border-white/5 rounded-3xl flex flex-col items-center justify-center text-slate-600 bg-white/[0.02]">
                          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                              <i className="fas fa-spinner fa-spin text-xl text-slate-500"></i>
                          </div>
                          <p className="font-medium text-sm">En attente de participants...</p>
                          <p className="text-xs text-slate-600 mt-2">Invitez des amis avec l'ID en haut à gauche</p>
                      </div>
                  )}
              </div>
          </div>

          {/* Floating Dock (Toolbar) */}
          <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50 flex items-center space-x-4 pointer-events-auto">
               <div className="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-full px-2 py-2 flex items-center space-x-1 shadow-2xl ring-1 ring-black/20">
                   <button onClick={toggleMute} className={`w-12 h-12 rounded-full flex items-center justify-center text-lg transition-all duration-300 hover:scale-105 active:scale-95 ${!isMuted ? 'text-slate-300 hover:bg-white/10' : 'bg-red-500 text-white shadow-lg shadow-red-500/30'}`}><i className={`fas ${!isMuted?'fa-microphone':'fa-microphone-slash'}`}></i></button>
                   <button onClick={toggleDeafen} className={`w-12 h-12 rounded-full flex items-center justify-center text-lg transition-all duration-300 hover:scale-105 active:scale-95 ${!isDeafened ? 'text-slate-300 hover:bg-white/10' : 'bg-red-500 text-white shadow-lg shadow-red-500/30'}`}><i className={`fas ${!isDeafened?'fa-headphones':'fa-headphones-slash'}`}></i></button>
                   <button onClick={toggleVideo} className={`w-12 h-12 rounded-full flex items-center justify-center text-lg transition-all duration-300 hover:scale-105 active:scale-95 ${isVideoEnabled ? 'text-slate-300 hover:bg-white/10' : 'bg-red-500 text-white shadow-lg shadow-red-500/30'}`}><i className={`fas ${isVideoEnabled?'fa-video':'fa-video-slash'}`}></i></button>
                   <button onClick={toggleScreenShare} className={`w-12 h-12 rounded-full flex items-center justify-center text-lg transition-all duration-300 hover:scale-105 active:scale-95 ${isScreenSharing ? 'bg-green-500 text-white shadow-lg shadow-green-500/30' : 'text-slate-300 hover:bg-white/10'}`}><i className="fas fa-desktop"></i></button>
                   
                   <div className="w-px h-6 bg-white/10 mx-2"></div>
                   
                   <button onClick={()=>setShowActivityModal(true)} className="w-12 h-12 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center text-lg transition-all duration-300 hover:scale-110 shadow-lg shadow-indigo-600/30 active:scale-95 ring-2 ring-indigo-500/20"><i className="fas fa-rocket"></i></button>
                   
                   <div className="w-px h-6 bg-white/10 mx-2"></div>

                   <button onClick={leaveRoom} className="w-14 h-12 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center text-lg transition-all duration-300 hover:scale-105 active:scale-95 border border-red-500/20"><i className="fas fa-phone-slash"></i></button>
               </div>
          </div>

       </div>

       {/* Chat Sidebar (Glass) */}
       <div className={`fixed inset-y-4 right-4 w-80 bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl transform transition-transform duration-500 z-40 flex flex-col ${showMobileChat ? 'translate-x-0' : 'translate-x-[120%] md:translate-x-0'}`}>
           <div className="h-16 flex items-center px-6 border-b border-white/5 justify-between bg-white/5 rounded-t-3xl">
               <span className="font-bold text-xs text-slate-400 uppercase tracking-wider flex items-center"><i className="fas fa-comments mr-2"></i> Discussion</span>
               <button className="md:hidden text-slate-500" onClick={()=>setShowMobileChat(false)}><i className="fas fa-times"></i></button>
           </div>
           <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
               {chatHistory.length === 0 && (
                   <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50">
                       <i className="fas fa-comment-dots text-4xl mb-2"></i>
                       <p className="text-xs">Pas encore de messages</p>
                   </div>
               )}
               {chatHistory.map(msg => (
                   <div key={msg.id} className="animate-in slide-in-from-right-4 duration-300">
                       <div className="flex items-baseline justify-between mb-1 px-1">
                           <span className="font-bold text-xs text-indigo-300">{msg.senderName}</span>
                           <span className="text-[10px] text-slate-500">{new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                       </div>
                       <div className="bg-white/5 rounded-2xl rounded-tl-none p-3 text-sm text-slate-200 border border-white/5 shadow-sm">
                           {msg.text}
                           {msg.image && <img src={msg.image} className="mt-2 rounded-lg border border-white/10" />}
                       </div>
                   </div>
               ))}
               <div ref={chatBottomRef}></div>
           </div>
           <div className="p-4 bg-transparent">
               <div className="bg-white/5 rounded-full flex items-center p-1.5 border border-white/10 shadow-inner focus-within:border-indigo-500/50 focus-within:bg-white/10 transition-all">
                   <button onClick={()=>mediaUploadRef.current?.click()} className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors"><i className="fas fa-plus text-xs"></i></button>
                   <input type="text" value={messageInput} onChange={e=>setMessageInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&messageInput.trim()){ broadcastData({type:'chat',text:messageInput,sender:peerId||'',senderName:displayName}); setChatHistory(prev=>[...prev,{id:Date.now().toString(),sender:peerId||'',senderName:displayName,text:messageInput,timestamp:Date.now()}]); setMessageInput(''); }}} className="bg-transparent flex-1 focus:outline-none text-xs px-3 text-white placeholder-slate-500" placeholder="Envoyer un message..." />
                   <input type="file" ref={mediaUploadRef} className="hidden" onChange={(e)=>{const f=e.target.files?.[0]; if(f){const r=new FileReader(); r.onloadend=()=>{broadcastData({type:'file-share',file:r.result as string,fileName:f.name,fileType:f.type,sender:peerId||'',senderName:displayName}); setChatHistory(prev=>[...prev,{id:Date.now().toString(),sender:peerId||'',senderName:displayName,image:r.result as string,timestamp:Date.now()}]);}; r.readAsDataURL(f);}}} />
               </div>
           </div>
       </div>

       {/* Incoming Call Overlay */}
       {incomingCall && (
           <div className="absolute inset-0 z-[60] bg-slate-900/80 backdrop-blur-md flex items-center justify-center">
               <div className="text-center animate-bounce-slow bg-white/5 p-10 rounded-3xl border border-white/10 shadow-2xl">
                   <div className="w-24 h-24 rounded-full bg-slate-800 border-2 border-indigo-500 flex items-center justify-center text-3xl font-bold mb-6 shadow-lg shadow-indigo-500/20 mx-auto relative">
                       {getInitials(incomingCall.call.peer)}
                       <div className="absolute inset-0 rounded-full border-4 border-indigo-500 opacity-20 animate-ping"></div>
                   </div>
                   <h2 className="text-2xl font-bold mb-1 text-white">{incomingCall.metadata?.displayName || 'Inconnu'}</h2>
                   <p className="text-indigo-300 text-sm mb-10 font-medium uppercase tracking-wide">Appel entrant...</p>
                   <div className="flex space-x-6 justify-center">
                       <button onClick={rejectCall} className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center text-xl transition-all hover:scale-110 shadow-lg shadow-red-500/30"><i className="fas fa-times"></i></button>
                       <button onClick={acceptCall} className="w-16 h-16 rounded-full bg-green-500 text-white flex items-center justify-center text-xl transition-all hover:scale-110 shadow-lg shadow-green-500/30"><i className="fas fa-check"></i></button>
                   </div>
               </div>
           </div>
       )}
    </div>
  );
}