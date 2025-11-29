import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DataConnection, MediaConnection, PeerInstance, NetworkMessage, LogEntry, ChatMessage, DeviceInfo, RemotePeer, ActivityMessage } from './types';

// --- Assets & Constants ---
const SOUND_RINGTONE = "https://actions.google.com/sounds/v1/alarms/digital_watch_alarm.ogg"; 
const MAX_PEERS_LIMIT = 3; // Absolute hard limit (Host + 3 guests = 4 total)

// Royalty Free Music Playlist (Pixabay / CDN)
const MUSIC_PLAYLIST = [
  { title: "Lofi Chill", artist: "FASSounds", src: "https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3" },
  { title: "Study Beat", artist: "Coma-Media", src: "https://cdn.pixabay.com/download/audio/2022/02/22/audio_c06fba1b22.mp3" },
  { title: "Relaxing Jazz", artist: "Music_Unlimited", src: "https://cdn.pixabay.com/download/audio/2022/09/22/audio_c0c8b13953.mp3" },
  { title: "Ambient Piano", artist: "SoulProdMusic", src: "https://cdn.pixabay.com/download/audio/2022/10/05/audio_68612125da.mp3" }
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
  
  // --- Audio Settings ---
  const [inputDevices, setInputDevices] = useState<DeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<DeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>('');
  const [selectedSpeakerId, setSelectedSpeakerId] = useState<string>('');
  const [micGain, setMicGain] = useState(1); 
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'audio' | 'profile'>('audio');

  // --- Context Menu ---
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, peerId: string } | null>(null);

  // --- Refs for State Access in Callbacks ---
  const isMutedRef = useRef(isMuted);
  const isDeafenedRef = useRef(isDeafened);
  const isVideoEnabledRef = useRef(isVideoEnabled);
  const isScreenSharingRef = useRef(isScreenSharing);
  const displayNameRef = useRef(displayName);
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

  // --- UI State ---
  const [pinnedView, setPinnedView] = useState<'local' | 'activity' | string | null>(null); // 'local', 'activity', or peerId
  const [showMobileChat, setShowMobileChat] = useState(false);
  
  // --- Activity State ---
  const [activity, setActivity] = useState<{ type: 'youtube' | 'music', videoId?: string } | null>(null);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [youtubeInput, setYoutubeInput] = useState('');
  const playerRef = useRef<any>(null); 
  const isRemoteUpdateRef = useRef(false); 
  const syncIntervalRef = useRef<number | null>(null);
  
  const [musicState, setMusicState] = useState<{ isPlaying: boolean, trackIndex: number }>({ isPlaying: false, trackIndex: 0 });
  const [musicVolume, setMusicVolume] = useState(0.2); // Default 20%
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // --- Audio Analysis ---
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

  // Audio Processing Refs
  const localAudioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  // Store analyzers for each peer: Key = peerId
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

  useEffect(() => {
    if (activity?.type === 'music' && audioPlayerRef.current) {
      audioPlayerRef.current.volume = musicVolume;
      if (musicState.isPlaying) {
        audioPlayerRef.current.play().catch(e => console.log("Autoplay blocked", e));
      } else {
        audioPlayerRef.current.pause();
      }
    }
  }, [musicState, activity, musicVolume]);

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

      // Combine processed audio with original video
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
          
          if (localStream && localStream.getVideoTracks().length > 0) {
              const videoTrack = localStream.getVideoTracks()[0];
              newStream.addTrack(videoTrack);
          }
          setLocalStream(newStream);
          const processed = setupAudioGraph(newStream);
          
          // Update all active calls with new track
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

  // --- PEER MANAGEMENT ---

  const addPeer = (id: string, partialPeer: Partial<RemotePeer>) => {
      setPeers(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(id) || {
              id, displayName: 'Connexion...', status: { muted: false, deafened: false, videoEnabled: false, isScreenSharing: false },
              volume: 1, isSpeaking: false
          } as RemotePeer;
          
          newMap.set(id, { ...existing, ...partialPeer });
          return newMap;
      });
  };

  const removePeer = (id: string) => {
      setPeers(prev => {
          const newMap = new Map(prev);
          const p = newMap.get(id);
          if (p) {
              if (p.mediaCall) p.mediaCall.close();
              if (p.dataConn) p.dataConn.close();
          }
          newMap.delete(id);
          return newMap;
      });
      // Also remove analyzer
      if (peerAnalysersRef.current.has(id)) {
          peerAnalysersRef.current.delete(id);
      }
      // Safety: unpin if pinned
      setPinnedView(prev => (prev === id ? null : prev));
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
      // Note: Client side limit check, but host will also reject
      if (peersRef.current.size >= MAX_PEERS_LIMIT) { addLog("Salon plein (Max 4)", "error"); return; }

      const streamToSend = processedStream || setupAudioGraph(localStream);
      
      // 1. Media Call
      const call = peerRef.current.call(targetId, streamToSend, {
          metadata: { displayName: displayName, avatar: localAvatarRef.current }
      });

      // 2. Data Connection
      const conn = peerRef.current.connect(targetId, {
          metadata: { displayName: displayName, avatar: localAvatarRef.current }
      });

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
          // Initial Sync
          conn.send({ 
              type: 'status', 
              muted: isMutedRef.current, 
              deafened: isDeafenedRef.current,
              videoEnabled: isVideoEnabledRef.current,
              isScreenSharing: isScreenSharingRef.current
          });
          conn.send({ type: 'profile-update', avatar: localAvatarRef.current, displayName: displayNameRef.current });
          
          // Activity Sync (if hosting/present)
          if (activity) {
              if (activity.type === 'youtube' && activity.videoId) conn.send({ type: 'activity', action: 'start', activityType: 'youtube', data: { videoId: activity.videoId } });
              else if (activity.type === 'youtube') conn.send({ type: 'activity', action: 'start', activityType: 'youtube' }); // Empty start
              else conn.send({ type: 'activity', action: 'start', activityType: 'music' });
          }

          addLog(`${remoteId} a rejoint la salle`, "success");
      });

      conn.on('data', (data: NetworkMessage) => {
          handleNetworkMessage(remoteId, data);
      });
      conn.on('close', () => removePeer(remoteId));
  };

  const handleNetworkMessage = (senderId: string, data: NetworkMessage) => {
      switch (data.type) {
          case 'status':
              addPeer(senderId, { status: { muted: data.muted, deafened: data.deafened, videoEnabled: data.videoEnabled, isScreenSharing: data.isScreenSharing } });
              break;
          case 'profile-update':
              addPeer(senderId, { displayName: data.displayName || 'Utilisateur', avatar: data.avatar });
              break;
          case 'chat':
              playSound('sound-message');
              setChatHistory(prev => [...prev, { id: Date.now().toString(), sender: senderId, senderName: data.senderName, text: data.text, timestamp: Date.now() }]);
              break;
          case 'file-share':
              playSound('sound-message');
              setChatHistory(prev => [...prev, { id: Date.now().toString(), sender: senderId, senderName: data.senderName, image: data.file, timestamp: Date.now() }]);
              break;
          case 'peer-list':
              // MESH TOPOLOGY DISCOVERY
              data.peers.forEach(pid => {
                  if (pid !== peerId && !peersRef.current.has(pid)) {
                      connectToPeer(pid);
                  }
              });
              break;
          case 'activity':
              handleActivityMessage(data);
              break;
      }
  };

  const startYoutubeVideo = (id: string) => {
      setActivity({ type: 'youtube', videoId: id });
      setPinnedView('activity');
      if(playerRef.current) { try { playerRef.current.destroy(); } catch(e){} }
      
      // Delay to ensure DOM is ready
      setTimeout(() => {
          loadYouTubeAPI(() => {
              try {
                  playerRef.current = new window.YT.Player('youtube-player', {
                      height: '100%',
                      width: '100%',
                      videoId: id,
                      playerVars: {
                          'playsinline': 1,
                          'controls': 1,
                          'enablejsapi': 1,
                          'origin': window.location.origin, // FIXED: ERROR 153
                          'rel': 0,
                          'modestbranding': 1
                      },
                      events: {
                          'onStateChange': onPlayerStateChange,
                          'onError': onPlayerError,
                          'onReady': () => {
                              // Optional: Broadcast start again to be sure everyone is on the same ID
                          }
                      }
                  });
              } catch(e) {
                  console.error("YT init error", e);
                  addLog("Erreur chargement YouTube", "error");
              }
          });
      }, 100);
  };

  const onPlayerError = (event: any) => {
      console.error("YouTube Error", event.data);
      const errors: {[key: number]: string} = {
          2: "Paramètres invalides",
          5: "Erreur HTML5",
          100: "Vidéo introuvable / Privée",
          101: "Vidéo bloquée (Copyright)",
          150: "Vidéo bloquée (Copyright)"
      };
      addLog(`Erreur YouTube: ${errors[event.data] || event.data}`, "error");
  };

  const handleActivityMessage = (data: ActivityMessage) => {
      if (data.action === 'start') {
          if (data.activityType === 'youtube') {
              setActivity({ type: 'youtube', videoId: data.data?.videoId });
              setPinnedView('activity');
              if (data.data?.videoId) {
                  // Only restart if it's a different video or we don't have a player
                  const currentId = playerRef.current?.getVideoData?.()?.video_id;
                  if (!playerRef.current || currentId !== data.data.videoId) {
                      startYoutubeVideo(data.data.videoId);
                  }
              } else {
                  setActivity({ type: 'youtube' });
              }
          } else if (data.activityType === 'music') {
              setActivity({ type: 'music' });
              setPinnedView('activity');
              setMusicState({ isPlaying: true, trackIndex: 0 });
          }
      } else if (data.action === 'stop') {
          setActivity(null); setPinnedView(null);
      } else if (data.activityType === 'music' && data.data) {
          if (data.action === 'play-music') setMusicState(prev => ({...prev, isPlaying: true}));
          if (data.action === 'pause-music') setMusicState(prev => ({...prev, isPlaying: false}));
          if (data.action === 'change-track') setMusicState({ isPlaying: true, trackIndex: data.data.trackIndex || 0 });
      } else if (data.activityType === 'youtube' && data.action === 'sync-state' && playerRef.current && data.data) {
          // REMOTE SYNC EXECUTION
          isRemoteUpdateRef.current = true;
          
          const { playerState, currentTime } = data.data;
          const myTime = playerRef.current.getCurrentTime();
          
          // Sync Time (Seek) only if drift is > 1.5s to avoid stutter
          if (Math.abs(myTime - (currentTime || 0)) > 1.5) {
              playerRef.current.seekTo(currentTime, true);
          }

          // Sync State
          const myState = playerRef.current.getPlayerState();
          if (playerState === 1 && myState !== 1 && myState !== 3) { // 1 = Playing, 3 = Buffering
              playerRef.current.playVideo();
          } else if (playerState === 2 && myState !== 2) { // 2 = Paused
              playerRef.current.pauseVideo();
          }

          // Reset lock after a short delay
          setTimeout(() => { isRemoteUpdateRef.current = false; }, 800);
      }
  };

  const onPlayerStateChange = (event: any) => {
      // If this event was caused by a remote sync, ignore it to prevent loop
      if (isRemoteUpdateRef.current) return;

      const playerState = event.data;
      const currentTime = playerRef.current.getCurrentTime();

      // Broadcast states: Playing (1), Paused (2), Buffering (3)
      if (playerState === 1 || playerState === 2 || playerState === 3) {
          broadcastData({
              type: 'activity', action: 'sync-state', activityType: 'youtube',
              data: { playerState, currentTime, timestamp: Date.now() }
          });
      }
  };

  // --- AUDIO ANALYSIS (REMOTE) ---
  const setupRemoteAudioAnalyzer = (peerId: string, stream: MediaStream) => {
      const ctx = localAudioCtxRef.current; // Use same context
      if (!ctx) return;
      
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128; // Lower resolution is fine
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser); // We don't connect to destination because the <video> tag handles playback
      
      peerAnalysersRef.current.set(peerId, analyser);
  };

  // Global Audio Loop (Checks all peers)
  useEffect(() => {
      const loop = () => {
          if (peerAnalysersRef.current.size > 0) {
              const dataArray = new Uint8Array(128);
              
              setPeers(prev => {
                  let changed = false;
                  const newMap = new Map(prev);
                  
                  newMap.forEach((peer, id) => {
                      const analyser = peerAnalysersRef.current.get(id);
                      if (analyser) {
                          analyser.getByteFrequencyData(dataArray);
                          let sum = 0;
                          for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
                          const avg = sum / dataArray.length;
                          const isSpeaking = avg > 5; // Sensitivity
                          
                          if (peer.isSpeaking !== isSpeaking) {
                              newMap.set(id, { ...peer, isSpeaking });
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
      // HOST LOGIC: Reject if room is full based on capacity
      // capacity is "Total users including host", so peers.size must be < capacity - 1
      if (peersRef.current.size >= (roomCapacityRef.current - 1)) {
          conn.close();
          return;
      }

      // 1. Accept Connection
      setupDataEvents(conn, conn.peer);
      const meta = conn.metadata || {};
      addPeer(conn.peer, { displayName: meta.displayName || 'Ami', avatar: meta.avatar, dataConn: conn });

      // 2. MESH DISCOVERY: Send list of ALREADY connected peers to the new joiner
      const currentPeerIds = Array.from(peersRef.current.keys());
      if (currentPeerIds.length > 0) {
          setTimeout(() => {
              conn.send({ type: 'peer-list', peers: currentPeerIds });
          }, 500);
      }
  };

  const handleIncomingCall = (call: MediaConnection) => {
      // HOST LOGIC: Reject if room is full
      if (peersRef.current.size >= (roomCapacityRef.current - 1)) {
          call.close();
          return;
      }
      setIncomingCall({ call, metadata: call.metadata });
      playSound('sound-ringtone');
  };

  const acceptCall = () => {
    if (!incomingCall || !localStream) return;
    const call = incomingCall.call;
    const meta = incomingCall.metadata || {};
    
    // Create Processed Stream
    const streamToSend = processedStream || setupAudioGraph(localStream);
    call.answer(streamToSend);
    
    // Add peer
    setupCallEvents(call, call.peer);
    addPeer(call.peer, { displayName: meta.displayName || 'Ami', avatar: meta.avatar, mediaCall: call });

    setIncomingCall(null);
    const audioEl = document.getElementById('sound-ringtone') as HTMLAudioElement;
    audioEl.pause(); audioEl.currentTime = 0;
  };

  const leaveRoom = () => {
      peersRef.current.forEach(peer => {
          if (peer.mediaCall) peer.mediaCall.close();
          if (peer.dataConn) peer.dataConn.close();
      });
      setPeers(new Map());
      peerAnalysersRef.current.clear();
      
      setActivity(null); setPinnedView(null);
      if (playerRef.current) { try{playerRef.current.destroy()}catch(e){} playerRef.current=null; }
      
      setViewState('lobby');
      addLog("Vous avez quitté le salon.", "info");
      playSound('sound-leave');
  };

  // --- UI HELPERS ---

  const addLog = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    const id = Date.now();
    setLogs(prev => [...prev, { id, timestamp: new Date().toLocaleTimeString(), message, type }]);
    setTimeout(() => setLogs(prev => prev.filter(log => log.id !== id)), 4000);
  };

  const getInitials = (name: string) => name ? name.charAt(0).toUpperCase() : '?';
  const playSound = (id: string) => { (document.getElementById(id) as HTMLAudioElement)?.play().catch(() => {}); };
  
  // --- LOGIN & INIT ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    setIsLoading(true);
    
    // Clean ID
    const myId = `${username.replace(/[^a-zA-Z0-9_-]/g, '')}-${Math.floor(Math.random() * 9000) + 1000}`;
    setPeerId(myId);
    setDisplayName(username);
    setLocalAvatar(localAvatarRef.current);

    try {
      await loadDevices();
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      const processed = setupAudioGraph(stream);
      stream.getVideoTracks().forEach(track => track.enabled = false);
      setIsVideoEnabled(false);
      if (localVideoRef.current) { localVideoRef.current.srcObject = stream; localVideoRef.current.muted = true; }

      if (window.Peer) {
        const peer = new window.Peer(myId);
        peerRef.current = peer;
        peer.on('open', () => { 
            setIsLoading(false); 
            setViewState('lobby'); 
        });
        peer.on('connection', handleIncomingConnection);
        peer.on('call', handleIncomingCall);
        peer.on('error', (e) => { 
            if (e.type === 'peer-unavailable') addLog("Salon/Utilisateur introuvable.", "error");
            else addLog(`Erreur Peer: ${e.type}`, "error"); 
            setIsLoading(false); 
        });
      }
    } catch (err) { setLoginError("Accès refusé : Caméra/Micro requis."); setIsLoading(false); }
  };

  const createRoom = (capacity: number, mode: 'standard' | 'cinema' = 'standard') => {
      setRoomCapacity(capacity);
      setViewState('room');
      addLog(mode === 'cinema' ? "Salon Cinéma créé !" : "Salon créé !", "success");
      
      if (mode === 'cinema') {
          setTimeout(() => {
              setActivity({ type: 'youtube' }); // No Video ID initially
              setPinnedView('activity');
              broadcastData({ type: 'activity', action: 'start', activityType: 'youtube' });
          }, 500);
      }
  };

  const joinRoom = (e: React.FormEvent) => {
      e.preventDefault();
      if (!remoteIdInput.trim()) return;
      if (remoteIdInput.trim() === peerId) { addLog("Vous ne pouvez pas vous appeler.", "error"); return; }
      setRoomCapacity(4); // Default when joining, host controls actual limit
      setViewState('room');
      connectToPeer(remoteIdInput.trim());
  };

  // --- ACTION HANDLERS (Toolbar) ---
  const toggleMute = () => {
     if(!processedStream) return;
     const track = processedStream.getAudioTracks()[0];
     if(track) { 
         track.enabled = !track.enabled; 
         setIsMuted(!track.enabled); 
         broadcastData({ 
            type: 'status', 
            muted: !track.enabled,
            deafened: isDeafened,
            videoEnabled: isVideoEnabled,
            isScreenSharing: isScreenSharing
         }); 
     }
  };
  const toggleVideo = () => {
     if(!localStream) return;
     const track = localStream.getVideoTracks()[0];
     if(track) { 
         track.enabled = !track.enabled; 
         setIsVideoEnabled(!isVideoEnabled); 
         broadcastData({ 
             type: 'status', 
             videoEnabled: !track.enabled,
             muted: isMuted,
             deafened: isDeafened,
             isScreenSharing: isScreenSharing
         }); 
     }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
        // STOP SHARING -> BACK TO CAMERA
        try {
            const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            const videoTrack = cameraStream.getVideoTracks()[0];
            
            // Disable video if it was disabled before (preserve user intent)
            setIsVideoEnabled(true);

            // Replace in Peers
            peersRef.current.forEach(p => {
                if (p.mediaCall && p.mediaCall.peerConnection) {
                    const sender = p.mediaCall.peerConnection.getSenders().find((s:any) => s.track?.kind === 'video');
                    if (sender) sender.replaceTrack(videoTrack);
                }
            });

            // Update Local
            setLocalStream(prev => {
                if(!prev) return cameraStream;
                const newStream = new MediaStream(prev.getTracks());
                const oldVideo = newStream.getVideoTracks()[0];
                if(oldVideo) { newStream.removeTrack(oldVideo); oldVideo.stop(); }
                newStream.addTrack(videoTrack);
                return newStream;
            });

            setIsScreenSharing(false);
            broadcastData({ type: 'status', isScreenSharing: false, videoEnabled: true, muted: isMuted, deafened: isDeafened });

        } catch(e) { console.error("Error reverting to camera", e); }
    } else {
        // START SHARING
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = stream.getVideoTracks()[0];

            screenTrack.onended = () => {
                if(isScreenSharingRef.current) toggleScreenShare();
            };

            // Replace in Peers
            peersRef.current.forEach(p => {
                if (p.mediaCall && p.mediaCall.peerConnection) {
                    const sender = p.mediaCall.peerConnection.getSenders().find((s:any) => s.track?.kind === 'video');
                    if (sender) sender.replaceTrack(screenTrack);
                }
            });

            // Update Local
            setLocalStream(prev => {
                if(!prev) return stream;
                const newStream = new MediaStream(prev.getTracks());
                const oldVideo = newStream.getVideoTracks()[0];
                if(oldVideo) newStream.removeTrack(oldVideo); 
                newStream.addTrack(screenTrack);
                return newStream;
            });

            setIsScreenSharing(true);
            broadcastData({ type: 'status', isScreenSharing: true, videoEnabled: true, muted: isMuted, deafened: isDeafened });
        } catch(e) {
            console.log("Screen share cancelled");
        }
    }
  };

  // --- RENDER HELPERS ---
  const renderVideoUnit = (peer: RemotePeer | 'local') => {
      const isLocal = peer === 'local';
      // Safety check for peer object, prevent crash if peer left
      if (!isLocal && (!peer || !peer.id)) return null;
      
      const id = isLocal ? peerId : peer.id;
      const display = isLocal ? displayName : peer.displayName;
      const avatar = isLocal ? localAvatar : peer.avatar;
      const stream = isLocal ? localStream : peer.stream;
      const status = isLocal ? { muted: isMuted, deafened: isDeafened, videoEnabled: isVideoEnabled, isScreenSharing: isScreenSharing } : peer.status;
      const speaking = isLocal ? isLocalSpeaking : peer.isSpeaking;

      return (
          <div className={`relative bg-[#1e1f22] rounded-2xl overflow-hidden flex items-center justify-center border border-white/5 group w-full h-full shadow-2xl transition-all duration-300
               ${speaking ? 'border-[#3ba55c] shadow-[0_0_15px_rgba(59,165,92,0.3)]' : ''} ${status.isScreenSharing ? 'ring-1 ring-[#5865F2]' : ''}`}
               onDoubleClick={() => setPinnedView(pinnedView === id ? null : id || 'local')}
               onContextMenu={!isLocal ? (e) => { e.preventDefault(); setContextMenu({x: e.clientX, y: e.clientY, peerId: peer.id}) } : undefined}
          >
              {!status.videoEnabled && (
                  <div className={`w-24 h-24 rounded-full flex items-center justify-center overflow-hidden z-20 ${speaking ? 'ring-4 ring-[#3ba55c] shadow-[0_0_20px_#3ba55c55]' : ''} transition-all duration-200`}>
                      {avatar ? <img src={avatar} className="w-full h-full object-cover"/> : 
                      <div className="w-full h-full bg-gradient-to-br from-[#5865F2] to-[#4752c4] flex items-center justify-center text-3xl font-bold text-white shadow-inner">{getInitials(display)}</div>}
                  </div>
              )}
              <video 
                 ref={(el) => { 
                     if(el && stream) { 
                         el.srcObject = stream; 
                         el.muted = isLocal || status.deafened; 
                         if(!isLocal && 'setSinkId' in el && selectedSpeakerId) (el as any).setSinkId(selectedSpeakerId);
                         el.play().catch(()=>{});
                     }
                 }}
                 autoPlay playsInline className={`absolute inset-0 w-full h-full bg-[#111214] ${status.videoEnabled ? 'block' : 'hidden'} ${status.isScreenSharing ? 'object-contain' : (isLocal ? 'object-cover scale-x-[-1]' : 'object-cover')}`}
              />
              <div className="absolute bottom-4 left-4 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-lg text-white text-xs font-bold border border-white/10 flex items-center z-30 pointer-events-none">
                  {display}
                  {status.muted && <i className="fas fa-microphone-slash text-[#ED4245] ml-2"></i>}
                  {status.deafened && <i className="fas fa-headphones text-[#ED4245] ml-2"></i>}
              </div>
          </div>
      );
  };

  // --- RENDER: LOGIN ---
  if (viewState === 'login') {
      return (
          <div className="h-screen flex items-center justify-center bg-[#111214] p-4 relative overflow-hidden font-sans">
              <div className="absolute inset-0 bg-gradient-to-br from-[#5865F2]/10 to-[#EB459E]/5 pointer-events-none"></div>
              <div className="absolute -top-40 -left-40 w-96 h-96 bg-[#5865F2]/20 rounded-full blur-[100px] pointer-events-none"></div>
              
              <div className="w-full max-w-sm bg-[#1e1f22]/80 backdrop-blur-2xl p-8 rounded-3xl shadow-2xl text-center border border-white/5 relative z-10 animate-in fade-in zoom-in duration-500">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#5865F2] to-[#4752c4] flex items-center justify-center mx-auto mb-6 text-4xl text-white shadow-[0_10px_30px_rgba(88,101,242,0.4)] transform hover:scale-110 transition-transform"><i className="fab fa-discord"></i></div>
                  <h1 className="text-3xl font-black text-white mb-2 tracking-tight">PeerCord</h1>
                  <p className="text-[#949BA4] text-sm mb-8 font-medium">L'expérience vocale nouvelle génération.</p>
                  <form onSubmit={handleLogin}>
                      <div className="bg-[#2b2d31] rounded-xl p-1.5 border border-black/20 focus-within:border-[#5865F2] focus-within:ring-4 ring-[#5865F2]/10 transition-all mb-4">
                        <input type="text" value={username} onChange={e=>setUsername(e.target.value)} className="w-full bg-transparent text-white p-3 focus:outline-none placeholder-[#72767d] font-medium" placeholder="Votre Pseudo" autoFocus />
                      </div>
                      <button disabled={isLoading} className="w-full bg-[#5865F2] hover:bg-[#4752c4] text-white py-3.5 rounded-xl font-bold shadow-lg shadow-[#5865F2]/30 transform active:scale-95 transition-all">
                        {isLoading ? <i className="fas fa-circle-notch fa-spin"></i> : "Rejoindre le réseau"}
                      </button>
                  </form>
                  {loginError && <p className="text-[#ED4245] text-xs mt-4 font-bold bg-[#ED4245]/10 py-2 rounded">{loginError}</p>}
              </div>
          </div>
      );
  }

  // --- RENDER: LOBBY (DASHBOARD) ---
  if (viewState === 'lobby') {
      return (
          <div className="h-screen bg-[#111214] flex flex-col md:flex-row overflow-hidden font-sans text-[#dbdee1]">
               <input type="file" ref={fileInputRef} onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => { localAvatarRef.current = reader.result as string; setLocalAvatar(reader.result as string); };
                    reader.readAsDataURL(file);
                  }
               }} className="hidden" accept="image/*" />

               {/* SIDEBAR */}
               <div className="w-full md:w-80 bg-[#1e1f22] border-r border-black/20 flex flex-col p-6 shrink-0 relative z-20">
                   <div className="flex flex-col items-center mb-10">
                       <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                          <div className="w-28 h-28 rounded-full bg-gradient-to-br from-[#5865F2] to-[#EB459E] p-1 shadow-2xl hover:shadow-[0_0_30px_rgba(88,101,242,0.5)] transition-shadow duration-300">
                              <div className="w-full h-full rounded-full bg-[#1e1f22] overflow-hidden relative">
                                {localAvatar ? <img src={localAvatar} className="w-full h-full object-cover"/> : <div className="w-full h-full flex items-center justify-center text-4xl font-black text-white">{getInitials(displayName)}</div>}
                              </div>
                          </div>
                          <div className="absolute bottom-1 right-1 bg-[#3BA55C] w-7 h-7 rounded-full border-4 border-[#1e1f22]"></div>
                       </div>
                       <h2 className="text-2xl font-black text-white mt-4">{displayName}</h2>
                       <div className="text-xs text-[#b9bbbe] bg-[#2b2d31] px-4 py-1.5 rounded-full mt-3 cursor-pointer hover:bg-[#35373c] hover:text-white transition-all border border-white/5" onClick={() => navigator.clipboard.writeText(peerId||'')}>
                         #{peerId?.split('-')[1]} <i className="fas fa-copy ml-1.5 opacity-50"></i>
                       </div>
                   </div>

                   <div className="mt-auto space-y-4">
                       <label className="text-xs font-bold text-[#949BA4] uppercase tracking-wider block ml-1">Rejoindre un Salon</label>
                       <form onSubmit={joinRoom} className="flex flex-col space-y-3">
                          <div className="bg-[#2b2d31] rounded-xl p-1 border border-black/20 focus-within:border-[#5865F2] transition-colors">
                              <input type="text" value={remoteIdInput} onChange={e => setRemoteIdInput(e.target.value)} placeholder="Entrez l'ID (ex: Tom-1234)" className="w-full bg-transparent text-white px-3 py-3 text-sm focus:outline-none placeholder-[#5f6269]" />
                          </div>
                          <button className="w-full bg-[#4f545c] hover:bg-[#5d6269] text-white py-3 rounded-xl text-sm font-bold transition-all shadow-lg">Rejoindre</button>
                       </form>
                   </div>
               </div>

               {/* MAIN DASHBOARD */}
               <div className="flex-1 p-8 overflow-y-auto relative">
                   <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#5865F2]/5 rounded-full blur-[120px] pointer-events-none"></div>
                   
                   <div className="relative z-10 max-w-6xl mx-auto pt-8">
                       <h1 className="text-4xl font-black text-white mb-2">Bienvenue sur le Hub</h1>
                       <p className="text-[#949BA4] mb-12 text-lg">Votre espace de communication sécurisé et instantané.</p>

                       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                           
                           {/* CARDS */}
                           {[
                               { icon: "fa-user-friends", title: "Duo Lounge", desc: "Discussion privée", cap: 2, color: "text-[#5865F2]", bg: "bg-[#5865F2]", mode: 'standard' },
                               { icon: "fa-users", title: "Trio Squad", desc: "Petit groupe", cap: 3, color: "text-[#FEE75C]", bg: "bg-[#FEE75C]", mode: 'standard' },
                               { icon: "fa-users-cog", title: "Full Party", desc: "Capacité maximale", cap: 4, color: "text-[#3BA55C]", bg: "bg-[#3BA55C]", mode: 'standard' },
                               { icon: "fa-film", title: "Ciné Club", desc: "WatchTogether", cap: 4, color: "text-[#ED4245]", bg: "bg-[#ED4245]", mode: 'cinema' }
                           ].map((card, i) => (
                               <div key={i} onClick={() => createRoom(card.cap, card.mode as any)} className="bg-[#1e1f22] p-8 rounded-3xl border border-white/5 hover:border-white/10 hover:bg-[#232428] cursor-pointer transition-all group flex flex-col items-center text-center shadow-xl hover:shadow-2xl hover:-translate-y-2 relative overflow-hidden">
                                   <div className={`absolute top-0 left-0 w-full h-1 ${card.bg}`}></div>
                                   <div className={`w-16 h-16 rounded-2xl ${card.bg}/10 ${card.color} flex items-center justify-center text-3xl mb-6 group-hover:scale-110 transition-transform duration-300`}>
                                       <i className={`fas ${card.icon}`}></i>
                                   </div>
                                   <h3 className="text-white font-bold text-xl">{card.title}</h3>
                                   <p className="text-[#949BA4] text-sm mt-2">{card.desc}</p>
                                   <div className="mt-6">
                                       <span className="text-[10px] font-bold text-[#b9bbbe] uppercase tracking-wider bg-[#2b2d31] px-3 py-1.5 rounded-full border border-white/5">Max {card.cap}</span>
                                   </div>
                               </div>
                           ))}

                       </div>

                       <div className="mt-16 bg-gradient-to-r from-[#5865F2]/10 to-transparent p-6 rounded-2xl border border-[#5865F2]/20 flex items-center space-x-6">
                           <div className="w-12 h-12 rounded-full bg-[#5865F2] flex items-center justify-center text-white shrink-0 shadow-lg shadow-[#5865F2]/20"><i className="fas fa-share-alt"></i></div>
                           <div>
                               <h4 className="text-white font-bold text-lg">Invitez vos amis</h4>
                               <p className="text-[#b9bbbe] text-sm mt-1">L'ID de salon (ex: <span className="font-mono text-white bg-black/20 px-1.5 py-0.5 rounded">Pseudo-1234</span>) est unique. Partagez-le pour qu'ils puissent vous rejoindre.</p>
                           </div>
                       </div>
                   </div>
               </div>
          </div>
      );
  }

  // --- RENDER: ROOM ---
  const activePeers = Array.from(peers.values());
  const gridClass = activePeers.length === 0 ? 'grid-cols-1' :
                    activePeers.length === 1 ? 'grid-cols-1 md:grid-cols-2' :
                    'grid-cols-2';
  
  const pinnedPeer = pinnedView === 'local' ? 'local' : (typeof pinnedView === 'string' ? peers.get(pinnedView) : undefined);

  return (
    <div className="flex h-screen bg-[#111214] overflow-hidden font-sans select-none text-[#dbdee1]">
       <input type="file" ref={mediaUploadRef} onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64 = reader.result as string;
                    broadcastData({ type: 'file-share', file: base64, fileName: file.name, fileType: file.type, sender: peerId || '', senderName: displayName });
                    setChatHistory(prev => [...prev, { id: Date.now().toString(), sender: peerId || '', senderName: displayName, image: base64, timestamp: Date.now() }]);
                };
                reader.readAsDataURL(file);
            }
       }} className="hidden" accept="image/*" />
       
       {/* Incoming Call Modal */}
       {incomingCall && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="bg-[#1e1f22] p-8 rounded-3xl shadow-2xl flex flex-col items-center w-96 text-center border border-white/10 ring-1 ring-white/5">
            <div className="w-24 h-24 rounded-full bg-[#5865F2] flex items-center justify-center text-3xl font-black text-white mb-6 animate-bounce shadow-lg ring-8 ring-[#111214]">{getInitials(incomingCall.call.peer)}</div>
            <h2 className="text-white font-bold text-2xl mb-1">{incomingCall.metadata?.displayName || 'Inconnu'}</h2>
            <p className="text-[#949BA4] text-sm mb-8 font-medium">Demande à rejoindre le salon...</p>
            <div className="flex space-x-6">
               <button onClick={() => { incomingCall.call.close(); setIncomingCall(null); }} className="bg-[#2b2d31] text-[#ED4245] w-16 h-16 rounded-full hover:bg-[#ED4245] hover:text-white transition-all shadow-lg flex items-center justify-center text-xl"><i className="fas fa-times"></i></button>
               <button onClick={acceptCall} className="bg-[#2b2d31] text-[#3BA55C] w-16 h-16 rounded-full hover:bg-[#3BA55C] hover:text-white transition-all shadow-lg flex items-center justify-center text-xl"><i className="fas fa-check"></i></button>
            </div>
          </div>
        </div>
       )}

       {/* Settings Modal - Activity Selector */}
       {showActivityModal && (
           <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md" onClick={()=>setShowActivityModal(false)}>
               <div className="bg-[#1e1f22] p-8 rounded-3xl w-full max-w-lg shadow-2xl border border-white/10 transform transition-all scale-100" onClick={e=>e.stopPropagation()}>
                   <h3 className="text-white font-black mb-6 text-2xl text-center">Démarrer une Activité</h3>
                   <div className="grid grid-cols-2 gap-4">
                       <button onClick={()=>{ setActivity({type:'youtube'}); setPinnedView('activity'); broadcastData({type:'activity', action:'start', activityType:'youtube'}); setShowActivityModal(false); }} className="bg-gradient-to-br from-[#ED4245] to-[#c23639] hover:brightness-110 text-white p-6 rounded-2xl font-bold flex flex-col items-center justify-center transition-all shadow-lg group">
                           <i className="fab fa-youtube text-4xl mb-3 group-hover:scale-110 transition-transform"></i>
                           <span>WatchTogether</span>
                       </button>
                       <button onClick={()=>{ setActivity({type:'music'}); setPinnedView('activity'); setMusicState({isPlaying:true, trackIndex:0}); broadcastData({type:'activity', action:'start', activityType:'music'}); setShowActivityModal(false); }} className="bg-gradient-to-br from-[#3BA55C] to-[#2d7d46] hover:brightness-110 text-white p-6 rounded-2xl font-bold flex flex-col items-center justify-center transition-all shadow-lg group">
                           <i className="fas fa-music text-4xl mb-3 group-hover:scale-110 transition-transform"></i>
                           <span>PeerRadio</span>
                       </button>
                   </div>
               </div>
           </div>
       )}

       {/* Main Content */}
       <div className="flex-1 flex flex-col relative bg-[#111214]">
          {/* Header */}
          <div className="h-16 bg-[#1e1f22]/80 backdrop-blur border-b border-black/20 flex items-center px-6 justify-between shrink-0 shadow-sm z-10">
              <div className="flex items-center text-[#dbdee1] font-bold text-sm cursor-pointer hover:text-white transition-colors group bg-[#2b2d31]/50 pr-4 rounded-full border border-white/5" onClick={() => navigator.clipboard.writeText(peerId || '')}>
                  <div className="w-10 h-10 rounded-full bg-[#5865F2] flex items-center justify-center mr-3 text-white shadow-lg shadow-[#5865F2]/20"><i className="fas fa-hashtag"></i></div>
                  <div className="flex flex-col py-1">
                      <span className="text-[10px] text-[#949BA4] uppercase font-bold tracking-wider">ID du Salon</span>
                      <span className="text-white font-mono group-hover:text-[#5865F2] transition-colors">{peerId}</span>
                  </div>
              </div>
              <button onClick={() => setShowMobileChat(!showMobileChat)} className="md:hidden text-[#b9bbbe] hover:text-white"><i className="fas fa-comment-alt text-xl"></i></button>
          </div>

          {/* Grid Area */}
          <div className="flex-1 p-4 overflow-hidden relative flex items-center justify-center">
              
              {/* Activity Overlay */}
              {activity && (
                  <div className={`absolute z-20 bg-[#1e1f22] rounded-2xl overflow-hidden shadow-2xl flex flex-col transition-all duration-300 border border-white/10 ${pinnedView === 'activity' ? 'inset-4' : 'bottom-6 right-6 w-80 h-48 shadow-[0_10px_40px_rgba(0,0,0,0.5)]'}`}>
                      {/* Activity Header */}
                      <div className="h-10 bg-[#2b2d31] flex items-center justify-between px-4 cursor-move border-b border-black/20">
                          <span className="text-xs font-bold text-white flex items-center uppercase tracking-wide">
                              <i className={`fas ${activity.type === 'youtube' ? 'fa-youtube text-[#ED4245]' : 'fa-music text-[#3BA55C]'} mr-2`}></i>
                              {activity.type === 'youtube' ? 'YouTube' : 'PeerRadio'}
                          </span>
                          <div className="flex space-x-3">
                             <button onClick={() => setPinnedView(pinnedView === 'activity' ? null : 'activity')} className="text-[#b9bbbe] hover:text-white"><i className={`fas ${pinnedView === 'activity' ? 'fa-compress' : 'fa-expand'}`}></i></button>
                             <button onClick={() => { setActivity(null); setPinnedView(null); broadcastData({type:'activity', action:'stop', activityType:'youtube'}) }} className="text-[#ED4245] hover:text-red-400"><i className="fas fa-times"></i></button>
                          </div>
                      </div>
                      <div className="flex-1 bg-black relative flex flex-col">
                          {activity.type === 'youtube' && (
                              activity.videoId ? (
                                  <div id="youtube-player" className="w-full h-full"></div>
                              ) : (
                                  <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-[#1e1f22]">
                                      <i className="fab fa-youtube text-5xl text-[#ED4245] mb-4"></i>
                                      <h3 className="text-white font-bold mb-4 text-center">Collez un lien YouTube</h3>
                                      <div className="flex w-full max-w-sm space-x-2">
                                          <input type="text" value={youtubeInput} onChange={e => setYoutubeInput(e.target.value)} placeholder="https://youtube.com/watch?v=..." className="flex-1 bg-[#2b2d31] border border-white/10 rounded-lg px-3 text-sm text-white focus:outline-none focus:border-[#ED4245]" />
                                          <button onClick={() => {
                                              const id = getYoutubeId(youtubeInput);
                                              if(id) { startYoutubeVideo(id); broadcastData({type:'activity', action:'start', activityType:'youtube', data:{videoId:id}}); setYoutubeInput(''); }
                                              else addLog("Lien invalide", "error");
                                          }} className="bg-[#ED4245] text-white px-4 rounded-lg font-bold hover:bg-red-600 transition-colors">Lancer</button>
                                      </div>
                                  </div>
                              )
                          )}
                          {activity.type === 'music' && (
                              <div className="flex-1 flex flex-col relative bg-gradient-to-br from-[#1e1f22] to-[#111214] p-4">
                                  <div className="flex-1 flex items-center justify-center flex-col text-white">
                                      <div className={`w-20 h-20 rounded-full bg-[#2b2d31] border-4 border-[#3BA55C]/30 flex items-center justify-center mb-4 ${musicState.isPlaying ? 'animate-spin-slow' : ''}`}>
                                          <i className="fas fa-compact-disc text-4xl text-[#3BA55C]"></i>
                                      </div>
                                      <span className="text-sm font-bold px-4 text-center mb-1">{MUSIC_PLAYLIST[musicState.trackIndex]?.title}</span>
                                      <span className="text-xs text-[#949BA4]">{MUSIC_PLAYLIST[musicState.trackIndex]?.artist}</span>
                                  </div>
                                  {/* Minimal Controls */}
                                  <div className="h-12 bg-[#2b2d31]/50 rounded-lg flex items-center justify-between px-3 mt-2 border border-white/5">
                                      <button onClick={()=>{ /* prev logic */}} className="text-[#b9bbbe] hover:text-white"><i className="fas fa-step-backward"></i></button>
                                      <button onClick={()=>{ 
                                          const newState = !musicState.isPlaying; 
                                          setMusicState(p => ({...p, isPlaying: newState})); 
                                          broadcastData({type:'activity', action: newState ? 'play-music' : 'pause-music', activityType:'music'}); 
                                      }} className="w-8 h-8 bg-[#3BA55C] rounded-full flex items-center justify-center text-white shadow hover:scale-105 transition-transform">
                                          <i className={`fas ${musicState.isPlaying ? 'fa-pause' : 'fa-play'} text-xs`}></i>
                                      </button>
                                      <button onClick={()=>{ /* next logic */}} className="text-[#b9bbbe] hover:text-white"><i className="fas fa-step-forward"></i></button>
                                      
                                      {/* Volume Slider for Background Music */}
                                      <div className="flex items-center ml-4 w-20 group relative">
                                        <i className="fas fa-volume-down text-xs text-[#b9bbbe] mr-2"></i>
                                        <input 
                                            type="range" min="0" max="1" step="0.05" 
                                            value={musicVolume} onChange={e => setMusicVolume(parseFloat(e.target.value))}
                                            className="w-full h-1 bg-[#4f545c] rounded-lg appearance-none cursor-pointer accent-[#3BA55C]" 
                                        />
                                      </div>
                                  </div>
                              </div>
                          )}
                      </div>
                  </div>
              )}

              {/* Video Grid */}
              <div className={`grid gap-6 w-full h-full max-w-7xl transition-all duration-500 ${pinnedView === 'activity' ? 'opacity-30 pointer-events-none scale-95 blur-sm' : ''} ${pinnedView && pinnedView !== 'activity' ? 'hidden' : gridClass}`}>
                  {/* Local Video */}
                  {renderVideoUnit('local')}
                  {/* Remote Videos */}
                  {activePeers.map(peer => (
                      <div key={peer.id} className="w-full h-full animate-in zoom-in duration-300">
                          {renderVideoUnit(peer)}
                      </div>
                  ))}
                  {/* Placeholder */}
                  {activePeers.length === 0 && (
                      <div className="bg-[#1e1f22]/30 border-2 border-dashed border-[#2b2d31] rounded-3xl flex flex-col items-center justify-center text-[#949BA4]">
                          <div className="w-20 h-20 rounded-full bg-[#2b2d31] flex items-center justify-center mb-4 animate-pulse">
                              <i className="fas fa-user-plus text-3xl text-[#5865F2]"></i>
                          </div>
                          <p className="text-lg font-bold">En attente de joueurs...</p>
                          <p className="text-sm mt-2 opacity-50">Partagez votre ID pour commencer.</p>
                      </div>
                  )}
              </div>

              {/* Pinned View */}
              {pinnedView && pinnedView !== 'activity' && pinnedPeer && (
                  <div className="w-full h-full flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-4 relative animate-in fade-in zoom-in duration-300">
                      <button onClick={()=>setPinnedView(null)} className="absolute top-4 right-4 z-50 bg-black/60 hover:bg-black/80 text-white w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md transition-all shadow-lg border border-white/10"><i className="fas fa-times"></i></button>

                      <div className="flex-1 relative shadow-2xl rounded-2xl overflow-hidden">{renderVideoUnit(pinnedPeer)}</div>
                      <div className="h-32 md:h-auto md:w-64 flex md:flex-col space-x-4 md:space-x-0 md:space-y-4 overflow-auto p-2 custom-scrollbar">
                          {pinnedView !== 'local' && <div className="w-56 h-36 md:w-full md:h-40 shrink-0 cursor-pointer hover:ring-2 ring-[#5865F2] rounded-2xl transition-all shadow-lg overflow-hidden" onClick={()=>setPinnedView('local')}>{renderVideoUnit('local')}</div>}
                          {activePeers.map(p => p.id !== pinnedView && (
                              <div key={p.id} className="w-56 h-36 md:w-full md:h-40 shrink-0 cursor-pointer hover:ring-2 ring-[#5865F2] rounded-2xl transition-all shadow-lg overflow-hidden" onClick={()=>setPinnedView(p.id)}>{renderVideoUnit(p)}</div>
                          ))}
                      </div>
                  </div>
              )}
          </div>

          {/* Footer Control Bar */}
          <div className="h-24 bg-[#1e1f22]/90 backdrop-blur-xl flex items-center justify-center space-x-6 shrink-0 shadow-[0_-10px_40px_rgba(0,0,0,0.4)] z-30 pb-4 md:pb-0 px-8 border-t border-white/5">
               <button onClick={toggleVideo} className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all transform hover:scale-105 active:scale-95 ${isVideoEnabled ? 'bg-[#f2f3f5] text-black shadow-lg shadow-white/10' : 'bg-[#2b2d31] text-white hover:bg-[#35373c] border border-white/5'}`} title="Caméra"><i className={`fas ${isVideoEnabled ? 'fa-video' : 'fa-video-slash'} text-xl`}></i></button>
               <button onClick={toggleMute} className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all transform hover:scale-105 active:scale-95 ${!isMuted ? 'bg-[#f2f3f5] text-black shadow-lg shadow-white/10' : 'bg-[#ED4245] text-white hover:bg-red-600 shadow-lg shadow-red-500/30'}`} title="Micro"><i className={`fas ${!isMuted ? 'fa-microphone' : 'fa-microphone-slash'} text-xl`}></i></button>
               <button onClick={toggleScreenShare} className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all transform hover:scale-105 active:scale-95 ${isScreenSharing ? 'bg-[#5865F2] text-white shadow-lg shadow-[#5865F2]/30' : 'bg-[#2b2d31] text-white hover:bg-[#35373c] border border-white/5'}`} title="Partager Écran"><i className="fas fa-desktop text-xl"></i></button>
               <button onClick={() => setShowActivityModal(true)} className="w-14 h-14 rounded-2xl bg-[#2b2d31] text-white hover:bg-[#35373c] hover:text-[#5865F2] border border-white/5 flex items-center justify-center transition-all transform hover:scale-105 active:scale-95" title="Activités"><i className="fas fa-rocket text-xl"></i></button>
               <button onClick={leaveRoom} className="w-20 h-14 rounded-2xl bg-[#ED4245] text-white hover:bg-red-600 flex items-center justify-center shadow-lg shadow-red-500/20 transition-all transform hover:scale-105 active:scale-95 ml-4" title="Raccrocher"><i className="fas fa-phone-slash text-xl"></i></button>
          </div>
       </div>

       {/* Chat Sidebar */}
       <div className={`fixed inset-0 z-40 bg-[#1e1f22] md:relative md:w-80 md:inset-auto md:flex flex-col border-l border-white/5 ${showMobileChat ? 'flex' : 'hidden'} transition-transform duration-300`}>
           <div className="h-16 border-b border-white/5 flex items-center px-6 font-bold text-[#f2f3f5] text-sm shadow-sm justify-between bg-[#2b2d31]/50">
               <span className="flex items-center tracking-wide"><i className="fas fa-hashtag text-[#949BA4] mr-2"></i> DISCUSSION</span>
               <button className="md:hidden w-8 h-8 flex items-center justify-center rounded hover:bg-[#35373c]" onClick={()=>setShowMobileChat(false)}><i className="fas fa-times"></i></button>
           </div>
           <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar bg-[#111214]">
               {chatHistory.map(msg => (
                   <div key={msg.id} className="flex space-x-3 group animate-in slide-in-from-left-2 duration-300">
                       <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#5865F2] to-[#4752c4] shrink-0 flex items-center justify-center text-sm font-bold text-white overflow-hidden shadow-md mt-0.5">
                           {msg.sender === peerId && localAvatar ? <img src={localAvatar} className="w-full h-full object-cover"/> : getInitials(msg.senderName || msg.sender)}
                       </div>
                       <div className="flex-1">
                           <div className="flex items-baseline space-x-2 mb-0.5">
                               <span className="text-sm font-bold text-white hover:underline cursor-pointer">{msg.senderName || msg.sender}</span>
                               <span className="text-[10px] text-[#949BA4]">{new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                           </div>
                           <p className="text-[#dbdee1] text-sm whitespace-pre-wrap leading-relaxed opacity-90">{msg.text}</p>
                           {msg.image && <img src={msg.image} className="mt-2 max-w-full rounded-xl border border-white/10 shadow-lg cursor-pointer hover:opacity-90 transition-opacity" onClick={() => {const w = window.open(""); w?.document.write(`<img src="${msg.image}" />`)}}/>}
                       </div>
                   </div>
               ))}
               <div ref={chatBottomRef}></div>
           </div>
           <div className="p-4 bg-[#1e1f22] border-t border-white/5">
               <div className="bg-[#111214] rounded-xl p-2 flex items-center shadow-inner border border-white/5 focus-within:border-[#5865F2] transition-colors">
                   <button onClick={() => mediaUploadRef.current?.click()} className="w-8 h-8 rounded-lg bg-[#2b2d31] hover:text-white flex items-center justify-center mr-2 transition-colors text-[#949BA4]"><i className="fas fa-plus text-xs"></i></button>
                   <input type="text" value={messageInput} onChange={e=>setMessageInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') { broadcastData({type:'chat', text:messageInput, sender:peerId||'', senderName:displayName}); setChatHistory(prev=>[...prev, {id:Date.now().toString(), sender:peerId||'', senderName:displayName, text:messageInput, timestamp:Date.now()}]); setMessageInput(''); }}} className="bg-transparent flex-1 focus:outline-none text-white text-sm placeholder-[#5f6269] px-2" placeholder={`Envoyer un message...`} />
               </div>
           </div>
       </div>

       {/* Hidden Audio Player */}
       <audio ref={audioPlayerRef} src={MUSIC_PLAYLIST[musicState.trackIndex]?.src} onEnded={()=>{/* Next logic */}}></audio>
    </div>
  );
}