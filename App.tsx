
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DataConnection, MediaConnection, PeerInstance, NetworkMessage, LogEntry, ChatMessage } from './types';

// --- Assets & Constants ---
const SOUND_RINGTONE = "https://actions.google.com/sounds/v1/alarms/digital_watch_alarm.ogg"; 
const EMOJI_LIST = ["😀", "😂", "🥰", "😎", "🤔", "😭", "👍", "👎", "🔥", "❤️", "🎉", "👀", "🚀", "💀"];

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

export default function App() {
  // --- State ---
  
  // Login & Connection
  const [username, setUsername] = useState('');
  const [peerId, setPeerId] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  
  const [remoteIdInput, setRemoteIdInput] = useState('');
  const [connectedPeerId, setConnectedPeerId] = useState<string | null>(null);

  // Call Handling
  const [incomingCall, setIncomingCall] = useState<{ call: MediaConnection, metadata?: any } | null>(null);
  const [isCallActive, setIsCallActive] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null); 

  // Media & Status
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  
  // Volume Control (Local)
  const [remoteVolume, setRemoteVolume] = useState(1); // 0 to 1

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, target: 'remote' } | null>(null);

  // Refs
  const isMutedRef = useRef(isMuted);
  const isDeafenedRef = useRef(isDeafened);
  const isVideoEnabledRef = useRef(isVideoEnabled);
  const isScreenSharingRef = useRef(isScreenSharing);
  const wasVideoEnabledBeforeShareRef = useRef(false);

  // Sync refs
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { isDeafenedRef.current = isDeafened; }, [isDeafened]);
  useEffect(() => { isVideoEnabledRef.current = isVideoEnabled; }, [isVideoEnabled]);
  useEffect(() => { isScreenSharingRef.current = isScreenSharing; }, [isScreenSharing]);

  // Remote Status
  const [remotePeerStatus, setRemotePeerStatus] = useState<{ 
    muted: boolean; 
    deafened: boolean;
    videoEnabled: boolean;
    isScreenSharing: boolean;
  }>({ 
    muted: false, 
    deafened: false,
    videoEnabled: false, 
    isScreenSharing: false
  });

  // UI / Layout State
  const [pinnedView, setPinnedView] = useState<'local' | 'remote' | 'activity' | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMobileChat, setShowMobileChat] = useState(false);
  
  // Activity State (WatchTogether & Music)
  const [activity, setActivity] = useState<{ type: 'youtube' | 'music', videoId?: string } | null>(null);
  const [showActivityModal, setShowActivityModal] = useState(false);
  
  // YouTube State
  const [youtubeInput, setYoutubeInput] = useState('');
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const playerRef = useRef<any>(null); // YT Player instance
  const isRemoteUpdateRef = useRef(false); // Flag to prevent loops

  // Music State
  const [musicState, setMusicState] = useState<{ isPlaying: boolean, trackIndex: number }>({ isPlaying: false, trackIndex: 0 });
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Audio Analysis
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);

  // Avatars
  const [localAvatar, setLocalAvatar] = useState<string | null>(null);
  const [remoteAvatar, setRemoteAvatar] = useState<string | null>(null);
  const localAvatarRef = useRef(localAvatar);
  useEffect(() => { localAvatarRef.current = localAvatar; }, [localAvatar]);

  // Chat & Logs
  const [messageInput, setMessageInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Refs
  const peerRef = useRef<PeerInstance | null>(null);
  const dataConnRef = useRef<DataConnection | null>(null);
  const mediaCallRef = useRef<MediaConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const mediaUploadRef = useRef<HTMLInputElement>(null);

  // Audio Context Refs
  const localAudioCtxRef = useRef<AudioContext | null>(null);
  const remoteAudioCtxRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // --- Scroll Chat ---
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, showMobileChat]);

  // --- Close Context Menu on click elsewhere ---
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // --- Music Player Effect ---
  useEffect(() => {
    if (activity?.type === 'music' && audioPlayerRef.current) {
      if (musicState.isPlaying) {
        audioPlayerRef.current.play().catch(e => console.log("Autoplay blocked", e));
      } else {
        audioPlayerRef.current.pause();
      }
    }
  }, [musicState, activity]);

  // --- VIDEO REF CALLBACKS (Fix Black Screen) ---
  const setLocalVideoElement = useCallback((node: HTMLVideoElement | null) => {
    localVideoRef.current = node;
    if (node && localStream) {
      node.srcObject = localStream;
      node.muted = true; // Always mute local video
    }
  }, [localStream]);

  const setRemoteVideoElement = useCallback((node: HTMLVideoElement | null) => {
    remoteVideoRef.current = node;
    if (node && remoteStream) {
      node.srcObject = remoteStream;
      node.volume = remoteVolume;
      node.muted = isDeafened;
    }
  }, [remoteStream, remoteVolume, isDeafened]);

  // --- Helpers ---

  const addLog = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    const id = Date.now();
    setLogs(prev => [...prev, { id, timestamp: new Date().toLocaleTimeString(), message, type }]);
    
    // Auto remove after 4 seconds
    setTimeout(() => {
        setLogs(prev => prev.filter(log => log.id !== id));
    }, 4000);
  };

  const getInitials = (name: string) => name ? name.charAt(0).toUpperCase() : '?';

  // --- Soundboard System ---

  const playSound = (soundId: string) => {
    const audioEl = document.getElementById(soundId) as HTMLAudioElement;
    if (audioEl) {
      if (soundId === 'sound-ringtone' && !audioEl.src) {
        audioEl.src = SOUND_RINGTONE; 
      }
      audioEl.currentTime = 0;
      audioEl.play().catch(e => {}); 
    }
  };

  const stopRingtone = () => {
    const audioEl = document.getElementById('sound-ringtone') as HTMLAudioElement;
    if (audioEl) {
      audioEl.pause();
      audioEl.currentTime = 0;
    }
  };

  // --- Sync State ---
  const sendStatusUpdate = (overrideState?: Partial<{muted: boolean, deafened: boolean, videoEnabled: boolean, isScreenSharing: boolean}>) => {
    if (dataConnRef.current && dataConnRef.current.open) {
      dataConnRef.current.send({ 
        type: 'status', 
        muted: overrideState?.muted ?? isMuted,
        deafened: overrideState?.deafened ?? isDeafened,
        videoEnabled: overrideState?.videoEnabled ?? isVideoEnabled,
        isScreenSharing: overrideState?.isScreenSharing ?? isScreenSharing
      });
    }
  };

  // --- Audio Analyzer ---
  const setupAudioAnalyzer = async (stream: MediaStream, isLocal: boolean) => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      
      if (isLocal && localAudioCtxRef.current) localAudioCtxRef.current.close();
      if (!isLocal && remoteAudioCtxRef.current) remoteAudioCtxRef.current.close();

      const audioCtx = new AudioContext();
      // FIX: Force Resume to ensure browser doesn't suspend context
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      if (isLocal) localAudioCtxRef.current = audioCtx;
      else remoteAudioCtxRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      
      const checkVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const average = sum / dataArray.length;
        const isSpeaking = average > 10; 

        if (isLocal) setIsLocalSpeaking(isSpeaking);
        else setIsRemoteSpeaking(isSpeaking);

        animationFrameRef.current = requestAnimationFrame(checkVolume);
      };
      checkVolume();
    } catch (e) { console.error(e); }
  };

  const stopAudioAnalyzers = () => {
    if (localAudioCtxRef.current) { localAudioCtxRef.current.close(); localAudioCtxRef.current = null; }
    if (remoteAudioCtxRef.current) { remoteAudioCtxRef.current.close(); remoteAudioCtxRef.current = null; }
    if (animationFrameRef.current) { cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null; }
    setIsLocalSpeaking(false); setIsRemoteSpeaking(false);
  };

  // --- Logic: Features ---

  const toggleMute = () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      const newMutedState = !isMuted;
      audioTrack.enabled = !newMutedState;
      setIsMuted(newMutedState);
      playSound(newMutedState ? 'sound-mute' : 'sound-unmute');
      sendStatusUpdate({ muted: newMutedState });
    }
  };

  const toggleDeafen = () => {
    const newDeafenState = !isDeafened;
    
    // Toggle remote video audio
    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = newDeafenState;
    }
    
    setIsDeafened(newDeafenState);
    playSound(newDeafenState ? 'sound-mute' : 'sound-unmute');
    sendStatusUpdate({ deafened: newDeafenState });
  };

  const toggleVideo = () => {
    if (!localStream) return;
    if (isScreenSharing) {
      stopScreenShare(); 
      return;
    }
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      const newVideoState = !isVideoEnabled;
      videoTrack.enabled = newVideoState;
      setIsVideoEnabled(newVideoState);
      sendStatusUpdate({ videoEnabled: newVideoState });
    }
  };

  const startScreenShare = async () => {
    try {
      wasVideoEnabledBeforeShareRef.current = isVideoEnabled;
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { cursor: "always" } as any, 
        audio: false 
      });
      const screenTrack = displayStream.getVideoTracks()[0];

      if (mediaCallRef.current && mediaCallRef.current.peerConnection) {
        const sender = mediaCallRef.current.peerConnection.getSenders().find((s: any) => s.track && s.track.kind === 'video');
        if (sender) {
             await sender.replaceTrack(screenTrack);
        }
      }

      setLocalStream(displayStream);
      setIsScreenSharing(true);
      setIsVideoEnabled(true); 
      setPinnedView('local'); 
      
      sendStatusUpdate({ isScreenSharing: true, videoEnabled: true });

      screenTrack.onended = () => stopScreenShare();

    } catch (err) { console.error("Screen Share Error:", err); }
  };

  const stopScreenShare = async () => {
    try {
      // Re-acquire camera stream to ensure we have a fresh track
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const camTrack = camStream.getVideoTracks()[0];
      const audioTrack = camStream.getAudioTracks()[0];
      
      // Preserve mute state
      audioTrack.enabled = !isMuted;

      if (mediaCallRef.current && mediaCallRef.current.peerConnection) {
        const sender = mediaCallRef.current.peerConnection.getSenders().find((s: any) => s.track && s.track.kind === 'video');
        if (sender) await sender.replaceTrack(camTrack);
        const audioSender = mediaCallRef.current.peerConnection.getSenders().find((s: any) => s.track && s.track.kind === 'audio');
        if (audioSender) await audioSender.replaceTrack(audioTrack);
      }

      setLocalStream(camStream);
      setIsScreenSharing(false);
      
      const shouldCamBeOn = wasVideoEnabledBeforeShareRef.current;
      camTrack.enabled = shouldCamBeOn;
      setIsVideoEnabled(shouldCamBeOn);

      sendStatusUpdate({ isScreenSharing: false, videoEnabled: shouldCamBeOn });
    } catch (e) {
      console.error("Error stopping screen share", e);
    }
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setLocalAvatar(base64String);
        if (dataConnRef.current && dataConnRef.current.open) {
          dataConnRef.current.send({ type: 'profile-update', avatar: base64String });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleImageShare = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && dataConnRef.current) {
        if (file.size > 3 * 1024 * 1024) {
            addLog("Image trop volumineuse (Max 3MB)", 'error');
            return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            const msg: NetworkMessage = {
                type: 'file-share',
                file: base64,
                fileName: file.name,
                fileType: file.type,
                sender: peerId || 'Moi'
            };
            dataConnRef.current?.send(msg);
            setChatHistory(prev => [...prev, {
                id: Date.now().toString(),
                sender: 'Moi',
                image: base64,
                timestamp: Date.now()
            }]);
        };
        reader.readAsDataURL(file);
    }
  };

  const toggleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    const target = e.currentTarget.parentElement?.parentElement as HTMLElement;
    if (target) {
        if (!document.fullscreenElement) {
            target.requestFullscreen().catch(err => console.log(err));
        } else {
            document.exitFullscreen();
        }
    }
  };

  // --- Activities (WatchTogether & Music) ---

  const initYouTubePlayer = (videoId: string) => {
    loadYouTubeAPI(() => {
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch(e) {}
      }
      playerRef.current = new window.YT.Player('youtube-player', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: { 'playsinline': 1, 'controls': 1, 'disablekb': 0, 'rel': 0 },
        events: { 'onReady': onPlayerReady, 'onStateChange': onPlayerStateChange }
      });
    });
  };

  const onPlayerReady = (event: any) => {};

  const onPlayerStateChange = (event: any) => {
      if (isRemoteUpdateRef.current) return;
      const playerState = event.data;
      const currentTime = playerRef.current.getCurrentTime();

      if (playerState === 1 || playerState === 2) {
          if (dataConnRef.current) {
              dataConnRef.current.send({
                  type: 'activity',
                  action: 'sync-state',
                  activityType: 'youtube',
                  data: { playerState, currentTime, timestamp: Date.now() }
              });
          }
      }
  };

  const startYoutubeActivity = () => {
    setYoutubeError(null);
    if (!youtubeInput) return;
    const regExp = /^(?:https?:\/\/)?(?:www\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^#&?]*).*/;
    const match = youtubeInput.match(regExp);
    
    let videoId = "";
    if (match && match[1].length === 11) {
        videoId = match[1];
    } else {
        setYoutubeError("Lien YouTube invalide.");
        return;
    }

    const activityData = { type: 'youtube', videoId } as const;
    setActivity(activityData);
    setPinnedView('activity'); 
    setShowActivityModal(false);
    setYoutubeInput('');

    if (dataConnRef.current) {
        dataConnRef.current.send({ type: 'activity', action: 'start', activityType: 'youtube', data: { videoId } });
    }
    setTimeout(() => initYouTubePlayer(videoId), 100);
  };

  // --- Music Logic ---

  const startMusicActivity = () => {
      const activityData = { type: 'music' } as const;
      setActivity(activityData);
      setPinnedView('activity');
      setShowActivityModal(false);
      setMusicState({ isPlaying: true, trackIndex: 0 });

      if (dataConnRef.current) {
          dataConnRef.current.send({ type: 'activity', action: 'start', activityType: 'music' });
      }
  };

  const handleMusicControl = (action: 'play' | 'pause' | 'next' | 'prev') => {
      let newState = { ...musicState };
      let netAction = '';

      if (action === 'play') { newState.isPlaying = true; netAction = 'play-music'; }
      if (action === 'pause') { newState.isPlaying = false; netAction = 'pause-music'; }
      if (action === 'next') { 
          newState.trackIndex = (newState.trackIndex + 1) % MUSIC_PLAYLIST.length; 
          newState.isPlaying = true; 
          netAction = 'change-track';
      }
      if (action === 'prev') { 
          newState.trackIndex = (newState.trackIndex - 1 + MUSIC_PLAYLIST.length) % MUSIC_PLAYLIST.length; 
          newState.isPlaying = true; 
          netAction = 'change-track';
      }

      setMusicState(newState);
      if (dataConnRef.current) {
          dataConnRef.current.send({ 
              type: 'activity', 
              action: netAction, 
              activityType: 'music', 
              data: { trackIndex: newState.trackIndex } 
          });
      }
  };

  const stopActivity = () => {
    setActivity(null);
    setPinnedView(null);
    if (playerRef.current) { try { playerRef.current.destroy(); } catch(e){} playerRef.current = null; }
    if (dataConnRef.current) {
        dataConnRef.current.send({ type: 'activity', action: 'stop', activityType: 'youtube' }); // generic stop
    }
  };

  // --- Volume Control ---
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const vol = parseFloat(e.target.value);
      setRemoteVolume(vol);
      if (remoteVideoRef.current) {
          remoteVideoRef.current.volume = vol;
      }
  };

  // --- Call Control ---

  const endCall = () => {
    stopAudioAnalyzers();
    if (mediaCallRef.current) mediaCallRef.current.close();
    if (dataConnRef.current) dataConnRef.current.close();
    if (isScreenSharing) stopScreenShare();
    if (playerRef.current) { try { playerRef.current.destroy(); } catch(e){} playerRef.current = null; }
    
    setConnectedPeerId(null);
    setIsCallActive(false);
    setRemotePeerStatus({ muted: false, deafened: false, videoEnabled: false, isScreenSharing: false });
    setRemoteAvatar(null);
    setRemoteStream(null);
    setActivity(null);
    setPinnedView(null);
    playSound('sound-leave');
    addLog('Appel terminé.', 'info');
    setShowMobileChat(false);
  };

  // --- Chat ---

  const sendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!messageInput.trim() || !dataConnRef.current) return;

    const msg: NetworkMessage = {
      type: 'chat',
      text: messageInput,
      sender: peerId || 'Moi'
    };
    dataConnRef.current.send(msg);
    setChatHistory(prev => [...prev, {
      id: Date.now().toString(),
      sender: 'Moi',
      text: messageInput,
      timestamp: Date.now()
    }]);
    setMessageInput('');
    setShowEmojiPicker(false);
  };

  const addEmoji = (emoji: string) => {
      setMessageInput(prev => prev + emoji);
  };

  // --- Connection Setup ---

  const setupDataConnection = useCallback((conn: DataConnection) => {
    dataConnRef.current = conn;
    
    conn.on('open', () => {
      addLog(`Connecté à ${conn.peer}`, 'success');
      setConnectedPeerId(conn.peer);
      playSound('sound-join');
      
      conn.send({ 
        type: 'status', 
        muted: isMutedRef.current, 
        deafened: isDeafenedRef.current,
        videoEnabled: isVideoEnabledRef.current,
        isScreenSharing: isScreenSharingRef.current
      });
      if (localAvatarRef.current) conn.send({ type: 'profile-update', avatar: localAvatarRef.current });
    });

    conn.on('data', (data: NetworkMessage) => {
      if (data.type === 'status') {
        setRemotePeerStatus({ 
          muted: data.muted, 
          deafened: data.deafened,
          videoEnabled: data.videoEnabled,
          isScreenSharing: data.isScreenSharing 
        });
        if (data.isScreenSharing) setPinnedView('remote');
      } 
      else if (data.type === 'chat') {
        playSound('sound-message');
        setChatHistory(prev => [...prev, { id: Date.now().toString(), sender: data.sender, text: data.text, timestamp: Date.now() }]);
      }
      else if (data.type === 'file-share') {
        playSound('sound-message');
        setChatHistory(prev => [...prev, { id: Date.now().toString(), sender: data.sender, image: data.file, timestamp: Date.now() }]);
      }
      else if (data.type === 'profile-update') {
        setRemoteAvatar(data.avatar);
      }
      else if (data.type === 'activity') {
          if (data.action === 'start') {
             if (data.activityType === 'youtube' && data.data?.videoId) {
                setActivity({ type: 'youtube', videoId: data.data.videoId });
                setPinnedView('activity');
                setTimeout(() => initYouTubePlayer(data.data!.videoId!), 100);
                addLog(`${conn.peer} a lancé une vidéo YouTube`, 'info');
             } else if (data.activityType === 'music') {
                setActivity({ type: 'music' });
                setPinnedView('activity');
                setMusicState({ isPlaying: true, trackIndex: 0 });
                addLog(`${conn.peer} a lancé PeerRadio`, 'info');
             }
          } 
          else if (data.action === 'stop') {
              setActivity(null);
              setPinnedView(null);
              if (playerRef.current) { try { playerRef.current.destroy(); } catch(e){} playerRef.current = null; }
          }
          // Sync Logic
          else if (data.activityType === 'youtube' && data.action === 'sync-state' && playerRef.current && data.data) {
              isRemoteUpdateRef.current = true;
              const { playerState, currentTime } = data.data;
              const myTime = playerRef.current.getCurrentTime();
              if (Math.abs(myTime - (currentTime || 0)) > 1.5) playerRef.current.seekTo(currentTime);
              if (playerState === 1 && playerRef.current.getPlayerState() !== 1) playerRef.current.playVideo();
              else if (playerState === 2 && playerRef.current.getPlayerState() !== 2) playerRef.current.pauseVideo();
              setTimeout(() => { isRemoteUpdateRef.current = false; }, 500);
          }
          else if (data.activityType === 'music' && data.data) {
              if (data.action === 'play-music') setMusicState(prev => ({...prev, isPlaying: true}));
              if (data.action === 'pause-music') setMusicState(prev => ({...prev, isPlaying: false}));
              if (data.action === 'change-track') setMusicState({ isPlaying: true, trackIndex: data.data.trackIndex || 0 });
          }
      }
    });

    conn.on('close', () => {
      addLog(`Connexion perdue`, 'error');
      endCall();
    });
  }, []); 

  const startStream = useCallback((call: MediaConnection, stream: MediaStream) => {
    mediaCallRef.current = call;
    setIsCallActive(true);
    // Add small delay to ensure audio context can init properly
    setTimeout(() => setupAudioAnalyzer(stream, true), 100);

    call.on('stream', (rStream) => {
      setRemoteStream(rStream); 
    });
    call.on('close', () => {
      setIsCallActive(false);
      setConnectedPeerId(null);
      stopAudioAnalyzers();
    });
  }, []); 

  const handleIncomingCall = useCallback((call: MediaConnection) => {
    setIncomingCall({ call });
    playSound('sound-ringtone');
  }, []);

  const acceptCall = () => {
    if (!incomingCall || !localStream) return;
    stopRingtone();
    const call = incomingCall.call;
    addLog(`Appel accepté`, 'success');
    call.answer(localStream);
    startStream(call, localStream);
    setIncomingCall(null);
    setConnectedPeerId(call.peer);
  };

  const rejectCall = () => {
    if (!incomingCall) return;
    stopRingtone();
    incomingCall.call.close();
    setIncomingCall(null);
  };

  // --- Main Init ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!username.trim()) return;

    setIsLoading(true);
    const cleanUser = username.replace(/[^a-zA-Z0-9_-]/g, '');
    const myId = `${cleanUser}-${Math.floor(Math.random() * 9000) + 1000}`;
    setPeerId(myId);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      
      // Init: Video OFF
      stream.getVideoTracks().forEach(track => track.enabled = false);
      setIsVideoEnabled(false);
      isVideoEnabledRef.current = false;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true;
      }

      if (window.Peer) {
        const peer = new window.Peer(myId);
        peerRef.current = peer;
        peer.on('open', () => { setIsLoggedIn(true); setIsLoading(false); });
        peer.on('connection', setupDataConnection);
        peer.on('call', handleIncomingCall);
        
        peer.on('error', (err: any) => { 
            console.error("Peer Error:", err);
            if (err.type === 'peer-unavailable') {
                addLog(`L'utilisateur est introuvable ou hors ligne.`, 'error');
            } else {
                setLoginError(`Erreur: ${err.type}`); 
            }
            setIsLoading(false); 
        });

      } else {
          setLoginError("PeerJS introuvable.");
          setIsLoading(false);
      }
    } catch (err) {
      setLoginError("Accès refusé : Caméra/Micro requis.");
      setIsLoading(false);
    }
  };

  const initiateCall = () => {
    if (!remoteIdInput.trim() || !peerRef.current || !localStream) return;
    if (peerId && remoteIdInput.trim() === peerId) {
        addLog("Vous ne pouvez pas vous appeler vous-même.", 'error');
        return;
    }

    const conn = peerRef.current.connect(remoteIdInput);
    if (!conn) {
        addLog("Impossible de créer la connexion.", 'error');
        return;
    }
    setupDataConnection(conn);
    const call = peerRef.current.call(remoteIdInput, localStream);
    startStream(call, localStream);
  };

  // --- LAYOUT RENDERING ---
  
  const handleRightClick = (e: React.MouseEvent) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, target: 'remote' });
  };

  const renderVideoUnit = (type: 'local' | 'remote') => {
    const isLocal = type === 'local';
    const streamActive = isLocal ? isVideoEnabled : remotePeerStatus.videoEnabled;
    const isSharing = isLocal ? isScreenSharing : remotePeerStatus.isScreenSharing;
    const avatar = isLocal ? localAvatar : remoteAvatar;
    const speaking = isLocal ? isLocalSpeaking : isRemoteSpeaking;
    const id = isLocal ? (peerId || 'Moi') : (connectedPeerId || 'Invité');
    const muted = isLocal ? isMuted : remotePeerStatus.muted;
    const deafened = isLocal ? isDeafened : remotePeerStatus.deafened;

    return (
      <div 
        onDoubleClick={() => setPinnedView(pinnedView === type ? null : type)}
        onContextMenu={!isLocal ? handleRightClick : undefined}
        className={`relative bg-[#111214] rounded-xl overflow-hidden flex items-center justify-center border border-[#1e1f22] group w-full h-full transition-all duration-300 shadow-md
          ${pinnedView && pinnedView !== type ? 'opacity-80 hover:opacity-100' : ''}
          ${isSharing ? 'ring-1 ring-[#5865F2]' : ''}
        `}
      >
        {/* Fullscreen Button */}
        <button onClick={toggleFullscreen} className="absolute top-3 right-3 z-30 w-8 h-8 bg-black/50 hover:bg-black/80 rounded-full text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <i className="fas fa-expand text-xs"></i>
        </button>

        {/* Avatar Layer */}
        {!streamActive && (
          <div 
            onClick={() => isLocal && fileInputRef.current?.click()}
            className={`relative w-24 h-24 md:w-32 md:h-32 rounded-full transition-all duration-200 flex items-center justify-center overflow-hidden z-20 ${isLocal ? 'cursor-pointer hover:brightness-110' : ''}
              ${speaking ? 'ring-4 ring-[#3ba55c] shadow-[0_0_20px_#3ba55c55]' : ''}`}
          >
            {avatar ? (
              <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <div className={`w-full h-full ${isLocal ? 'bg-gradient-to-br from-[#5865F2] to-[#4752c4]' : 'bg-gradient-to-br from-[#F57B00] to-[#d96d00]'} flex items-center justify-center text-4xl font-bold text-white`}>
                {getInitials(id)}
              </div>
            )}
             {isLocal && <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[10px] font-bold uppercase tracking-wide">Changer</div>}
          </div>
        )}
        
        {/* Video Layer */}
        <video 
          ref={isLocal ? setLocalVideoElement : setRemoteVideoElement}
          autoPlay 
          playsInline
          key={isLocal ? (isScreenSharing ? 'local-screen' : 'local-cam') : (remotePeerStatus.isScreenSharing ? 'remote-screen' : 'remote-cam')}
          className={`w-full h-full absolute inset-0 bg-black transition-all duration-300
            ${!streamActive ? 'hidden' : 'block'} 
            ${isSharing ? 'object-contain bg-[#000000]' : (isLocal ? 'object-cover transform scale-x-[-1]' : 'object-cover')}`}
        />
        
        {/* Name Tag */}
        <div className="absolute bottom-3 left-3 bg-black/60 px-2 py-1 rounded text-white text-xs font-bold backdrop-blur-md flex items-center z-30 pointer-events-none select-none border border-white/5">
          {isLocal ? username : id.split('-')[0]}
          {muted && <i className="fas fa-microphone-slash text-[#ED4245] ml-2"></i>}
          {deafened && <i className="fas fa-headphones text-[#ED4245] ml-2"></i>}
        </div>

        <div className="absolute top-3 left-3 flex space-x-2 z-30 pointer-events-none">
            {isSharing && <div className="bg-[#5865F2] px-2 py-0.5 rounded text-[10px] font-bold text-white uppercase tracking-wider shadow-lg">En direct</div>}
        </div>
      </div>
    );
  };

  // --- Render Login ---
  if (!isLoggedIn) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#202225] font-sans px-4">
        <div className="w-full max-w-sm bg-[#2f3136] p-8 rounded shadow-lg text-center border border-[#202225]">
          <div className="w-16 h-16 rounded-full bg-[#5865F2] flex items-center justify-center mx-auto mb-4 text-3xl text-white">
            <i className="fab fa-discord"></i>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Bienvenue sur PeerCord</h1>
          <p className="text-[#b9bbbe] text-sm mb-6">Entrez un pseudo pour rejoindre le serveur.</p>
          <form onSubmit={handleLogin} className="text-left">
            <label className="block text-[#b9bbbe] text-xs font-bold uppercase mb-2">Pseudo</label>
            <input 
              type="text" value={username} onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-[#202225] text-white p-3 rounded mb-4 focus:outline-none border border-transparent focus:border-[#5865F2] transition-colors"
              autoFocus placeholder="Ex: Wumpus" disabled={isLoading}
            />
            {loginError && <div className="text-[#ED4245] text-xs mb-4 flex items-center"><i className="fas fa-exclamation-circle mr-1"></i> {loginError}</div>}
            <button type="submit" disabled={isLoading} className="w-full bg-[#5865F2] hover:bg-[#4752c4] text-white font-medium py-3 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {isLoading ? "Connexion..." : "Commencer"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- Render App ---
  return (
    <div className="flex h-screen bg-[#313338] overflow-hidden font-sans select-none text-[#dbdee1]">
      <input type="file" ref={fileInputRef} onChange={handleAvatarUpload} className="hidden" accept="image/*" />
      <input type="file" ref={mediaUploadRef} onChange={handleImageShare} className="hidden" accept="image/*" />

      {/* Hidden Audio Player for Music */}
      <audio ref={audioPlayerRef} src={MUSIC_PLAYLIST[musicState.trackIndex]?.src} loop={false} onEnded={() => handleMusicControl('next')}></audio>

      {/* Context Menu */}
      {contextMenu && (
          <div 
             className="fixed z-[100] bg-[#111214] border border-[#1e1f22] w-56 rounded shadow-xl p-2 animate-in fade-in zoom-in-95 duration-100 origin-top-left"
             style={{ top: contextMenu.y, left: contextMenu.x }}
             onClick={(e) => e.stopPropagation()}
          >
              <div className="px-2 py-1 text-xs font-bold text-[#949BA4] uppercase mb-1">Volume Utilisateur</div>
              <div className="px-2 pb-2">
                  <input type="range" min="0" max="1" step="0.05" value={remoteVolume} onChange={handleVolumeChange} className="w-full accent-[#5865F2] h-1 bg-[#40444b] rounded-lg appearance-none cursor-pointer" />
                  <div className="flex justify-between text-[10px] text-[#b9bbbe] mt-1"><span>0%</span><span>{Math.round(remoteVolume * 100)}%</span><span>100%</span></div>
              </div>
              <div className="h-px bg-[#2b2d31] my-1"></div>
              <button onClick={() => setContextMenu(null)} className="w-full text-left px-2 py-1.5 hover:bg-[#5865F2] hover:text-white rounded text-sm text-[#dbdee1] transition-colors">Fermer</button>
          </div>
      )}

      {/* Activity Modal */}
      {showActivityModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setShowActivityModal(false)}>
           <div className="bg-[#313338] p-6 rounded-lg w-full max-w-md mx-4 shadow-2xl animate-in fade-in zoom-in-95" onClick={e => e.stopPropagation()}>
              <h3 className="text-white font-bold text-lg mb-4">Démarrer une Activité</h3>
              <div className="space-y-3">
                  {/* YouTube Option */}
                  <div className="bg-[#2b2d31] p-3 rounded hover:bg-[#40444b] transition-colors border border-[#1e1f22]">
                      <div className="flex items-center mb-2">
                          <i className="fab fa-youtube text-[#ff0000] mr-2 text-lg"></i>
                          <span className="font-bold text-white text-sm">WatchTogether</span>
                      </div>
                      <input type="text" value={youtubeInput} onChange={e => setYoutubeInput(e.target.value)} placeholder="Lien YouTube..." className="w-full bg-[#1e1f22] text-[#dbdee1] p-2 rounded text-xs mb-2 outline-none focus:ring-1 focus:ring-[#5865F2]"/>
                      <button onClick={startYoutubeActivity} className="w-full bg-[#5865F2] text-white py-1.5 rounded text-xs font-bold">Lancer Vidéo</button>
                  </div>
                  
                  {/* Music Option */}
                  <div className="bg-[#2b2d31] p-3 rounded hover:bg-[#40444b] transition-colors border border-[#1e1f22]">
                       <div className="flex items-center mb-2">
                          <i className="fas fa-music text-[#3ba55c] mr-2 text-lg"></i>
                          <span className="font-bold text-white text-sm">PeerRadio (Gratuit)</span>
                      </div>
                      <p className="text-[#949BA4] text-xs mb-3">Écoutez de la musique Lo-Fi libre de droits synchronisée.</p>
                      <button onClick={startMusicActivity} className="w-full bg-[#3ba55c] text-white py-1.5 rounded text-xs font-bold">Lancer Radio</button>
                  </div>
              </div>
              <button onClick={() => setShowActivityModal(false)} className="w-full mt-4 text-[#dbdee1] text-xs hover:underline">Annuler</button>
           </div>
        </div>
      )}

      {/* Incoming Call */}
      {incomingCall && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in zoom-in duration-300">
          <div className="bg-[#1e1f22] p-8 rounded-2xl shadow-2xl flex flex-col items-center w-80">
            <div className="w-24 h-24 rounded-full bg-[#5865F2] flex items-center justify-center text-3xl font-bold text-white mb-6 shadow-lg animate-pulse">
              {getInitials(incomingCall.call.peer)}
            </div>
            <h2 className="text-xl text-white font-bold mb-1">{incomingCall.call.peer.split('-')[0]}</h2>
            <p className="text-[#b9bbbe] mb-8 text-sm">Appel entrant...</p>
            <div className="flex space-x-8">
              <button onClick={rejectCall} className="w-12 h-12 rounded-full bg-[#ED4245] hover:bg-red-600 text-white flex items-center justify-center transition-transform hover:scale-110 shadow-lg">
                <i className="fas fa-phone-slash"></i>
              </button>
              <button onClick={acceptCall} className="w-12 h-12 rounded-full bg-[#3BA55C] hover:bg-green-600 text-white flex items-center justify-center transition-transform hover:scale-110 shadow-lg animate-bounce">
                <i className="fas fa-phone"></i>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Stage */}
      <div className="flex-1 flex flex-col relative bg-[#313338]">
        {/* Header */}
        <div className="h-12 bg-[#2b2d31] border-b border-[#1e1f22] flex items-center px-4 justify-between shadow-sm z-10 shrink-0">
          <div className="flex items-center text-[#949BA4] font-semibold text-sm tracking-wide">
            <i className="fas fa-hashtag text-base mr-2 text-[#6d6f78]"></i> Salon Vocal
          </div>
          <div className="flex items-center space-x-2">
            {!connectedPeerId && !isCallActive && (
                <div className="flex items-center space-x-2">
                <input type="text" placeholder="ID Ami (Ex: Tom-1234)" value={remoteIdInput} onChange={(e) => setRemoteIdInput(e.target.value)}
                    className="bg-[#1e1f22] text-xs text-[#dbdee1] px-2 py-1.5 rounded focus:outline-none w-24 md:w-48 border border-transparent focus:border-[#5865F2] transition-colors"
                />
                <button onClick={initiateCall} className="bg-[#248046] hover:bg-[#1a6334] text-white text-xs font-medium px-3 py-1.5 rounded transition-colors whitespace-nowrap">APPELER</button>
                </div>
            )}
            <div className="text-xs text-[#949BA4] hover:text-[#dbdee1] cursor-pointer transition-colors px-2 py-1 hidden sm:block" onClick={() => { navigator.clipboard.writeText(peerId || ''); addLog("ID copié", "success"); }} title="Copier mon ID">
                <span className="font-bold text-[#dbdee1]">ID:</span> <span className="opacity-80">{peerId}</span>
            </div>
             {connectedPeerId && (
                <button onClick={() => setShowMobileChat(!showMobileChat)} className="md:hidden text-[#b9bbbe] hover:text-white px-2 relative">
                    <i className="fas fa-comment-alt text-lg"></i>
                    {/* Simple dot for notifications could be added here */}
                </button>
             )}
          </div>
        </div>

        {/* Video Grid */}
        <div className="flex-1 p-3 flex items-center justify-center overflow-hidden relative">
          
          {/* Notification Toast Area */}
          <div className="absolute top-4 right-4 z-50 flex flex-col space-y-2 items-end pointer-events-none">
              {logs.map((log) => (
                  <div key={log.id} className={`px-3 py-2 rounded shadow-lg text-xs font-medium text-white animate-in slide-in-from-right fade-in duration-300
                      ${log.type === 'error' ? 'bg-[#ED4245]' : log.type === 'success' ? 'bg-[#3BA55C]' : 'bg-[#5865F2]'}
                  `}>
                      {log.message}
                  </div>
              ))}
          </div>

          {/* Activity Layer */}
          <div 
            className={`absolute bg-black rounded-lg overflow-hidden shadow-2xl transition-all duration-300 z-10 flex flex-col
               ${activity ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none scale-90'}
               ${pinnedView === 'activity' ? 'inset-3 z-20' : 'bottom-4 right-4 w-64 md:w-80 h-36 md:h-48 border border-[#2f3136]'}
            `}
          >
             {/* Header */}
             <div className="h-8 bg-[#1e1f22] flex items-center justify-between px-3 shrink-0 border-b border-[#2f3136]">
                 <div className="text-[10px] font-bold text-white flex items-center uppercase tracking-wide truncate">
                     {activity?.type === 'youtube' ? <><i className="fab fa-youtube text-[#ff0000] mr-2"></i> WatchTogether</> : <><i className="fas fa-music text-[#3ba55c] mr-2"></i> PeerRadio</>}
                 </div>
                 <div className="flex space-x-2">
                     {pinnedView !== 'activity' && <button onClick={() => setPinnedView('activity')} className="text-[#b9bbbe] hover:text-white"><i className="fas fa-expand text-xs"></i></button>}
                     {pinnedView === 'activity' && <button onClick={() => setPinnedView(null)} className="text-[#b9bbbe] hover:text-white"><i className="fas fa-compress text-xs"></i></button>}
                     <button onClick={stopActivity} className="text-[#ed4245] hover:text-red-400"><i className="fas fa-times text-xs"></i></button>
                 </div>
             </div>
             
             {/* Content */}
             <div className="flex-1 relative bg-[#111214] flex flex-col">
                {activity?.type === 'youtube' && <div id="youtube-player" className="w-full h-full"></div>}
                
                {activity?.type === 'music' && (
                    <div className="flex flex-col items-center justify-center h-full p-4 relative overflow-hidden">
                        {/* Visualizer Background Mockup */}
                        <div className="absolute inset-0 opacity-20 bg-gradient-to-br from-purple-900 to-blue-900 animate-pulse"></div>
                        
                        <div className="z-10 text-center">
                            <i className="fas fa-compact-disc text-6xl text-[#5865F2] animate-[spin_4s_linear_infinite] mb-4 shadow-xl rounded-full"></i>
                            <h3 className="text-white font-bold text-lg mb-1">{MUSIC_PLAYLIST[musicState.trackIndex].title}</h3>
                            <p className="text-[#b9bbbe] text-sm mb-6">{MUSIC_PLAYLIST[musicState.trackIndex].artist}</p>
                            
                            <div className="flex items-center space-x-6">
                                <button onClick={() => handleMusicControl('prev')} className="text-[#dbdee1] hover:text-white text-xl"><i className="fas fa-step-backward"></i></button>
                                <button onClick={() => handleMusicControl(musicState.isPlaying ? 'pause' : 'play')} className="w-12 h-12 bg-[#5865F2] rounded-full text-white flex items-center justify-center hover:bg-[#4752c4] shadow-lg transform hover:scale-105 transition-all">
                                    <i className={`fas ${musicState.isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
                                </button>
                                <button onClick={() => handleMusicControl('next')} className="text-[#dbdee1] hover:text-white text-xl"><i className="fas fa-step-forward"></i></button>
                            </div>
                        </div>
                    </div>
                )}
             </div>
          </div>

          {/* Video Layout Logic */}
          {pinnedView && pinnedView !== 'activity' ? (
             <div className="w-full h-full flex flex-col md:flex-row space-y-3 md:space-y-0 md:space-x-3 animate-in fade-in duration-300">
                <div className="flex-1 h-full rounded-xl overflow-hidden bg-[#111214] order-1 md:order-1">
                    {renderVideoUnit(pinnedView as 'local'|'remote')}
                </div>
                <div className="w-full md:w-60 h-32 md:h-auto flex flex-row md:flex-col space-x-3 md:space-x-0 md:space-y-3 justify-center order-2 md:order-2 shrink-0">
                    <div className="aspect-video w-auto h-full md:w-full md:h-36 rounded-xl overflow-hidden bg-[#111214]">
                       {renderVideoUnit(pinnedView === 'local' ? 'remote' : 'local')}
                    </div>
                </div>
             </div>
          ) : (
            <div className={`grid gap-3 w-full h-full max-w-5xl transition-all duration-300 ${activity && pinnedView === 'activity' ? 'opacity-0 pointer-events-none' : ''} ${connectedPeerId ? 'grid-rows-2 md:grid-rows-1 md:grid-cols-2' : 'grid-cols-1'}`}>
               {renderVideoUnit('local')}
               {connectedPeerId ? renderVideoUnit('remote') : (
                 <div className="bg-[#2b2d31] rounded-xl flex flex-col items-center justify-center border border-[#1e1f22] border-dashed hidden md:flex">
                    <div className="w-16 h-16 rounded-full bg-[#313338] flex items-center justify-center mb-3">
                        <i className="fas fa-user-plus text-2xl text-[#b9bbbe]"></i>
                    </div>
                    <span className="text-[#949BA4] font-medium text-sm">En attente d'un ami...</span>
                    <span className="text-[#b9bbbe] text-xs mt-1">Partagez votre ID pour commencer</span>
                 </div>
               )}
            </div>
          )}
        </div>

        {/* Control Bar */}
        <div className="h-16 bg-[#232428] flex items-center justify-center relative px-2 md:px-4 shrink-0 overflow-x-auto">
           {/* User Info - Hidden on mobile to save space */}
           <div className="hidden lg:flex absolute left-3 items-center p-1.5 rounded hover:bg-[#3f4147] cursor-pointer transition-colors group">
              <div className="w-8 h-8 rounded-full bg-[#5865F2] overflow-hidden relative">
                 {localAvatar ? <img src={localAvatar} className="w-full h-full object-cover"/> : <div className="flex items-center justify-center h-full text-white font-bold text-xs">{getInitials(username)}</div>}
                 <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#23a559] rounded-full border-2 border-[#232428]"></div>
              </div>
              <div className="flex flex-col text-left ml-2">
                 <span className="text-white text-xs font-bold leading-tight max-w-[100px] truncate">{username}</span>
                 <span className="text-[#b9bbbe] text-[10px]">#{peerId?.split('-')[1]}</span>
              </div>
           </div>

           <div className="flex items-center space-x-2 md:space-x-3">
               <ControlButton icon={isVideoEnabled && !isScreenSharing ? "fa-video" : "fa-video-slash"} active={isVideoEnabled && !isScreenSharing} onClick={toggleVideo} color="white" tooltip="Caméra" />
               <ControlButton icon="fa-desktop" active={isScreenSharing} onClick={isScreenSharing ? stopScreenShare : startScreenShare} color="white" tooltip="Partage écran" />
               <ControlButton icon="fa-rocket" active={!!activity} onClick={() => setShowActivityModal(true)} color="white" tooltip="Activités" />
               
               <div className="w-px h-6 bg-[#3f4147] mx-1"></div>
               
               <ControlButton icon={isMuted ? "fa-microphone-slash" : "fa-microphone"} active={!isMuted} onClick={toggleMute} color={isMuted ? "red" : "white"} tooltip="Micro" />
               <ControlButton icon={isDeafened ? "fa-headphones" : "fa-headphones-simple"} active={!isDeafened} onClick={toggleDeafen} color={isDeafened ? "red" : "white"} tooltip="Casque" />
               
               <button onClick={endCall} className="w-10 h-10 rounded-full bg-[#ED4245] hover:bg-red-600 text-white flex items-center justify-center transition-all hover:scale-110 shadow-md ml-2">
                 <i className="fas fa-phone-slash text-sm"></i>
               </button>
           </div>
        </div>
      </div>

      {/* Chat Sidebar (Responsive) */}
      {connectedPeerId && (
        <div className={`
             fixed inset-0 z-40 bg-[#2b2d31] flex-col 
             md:relative md:flex md:w-80 md:inset-auto md:z-20 md:border-l md:border-[#1e1f22] md:shadow-xl
             ${showMobileChat ? 'flex' : 'hidden'}
        `}>
          <div className="h-12 flex items-center justify-between px-4 shadow-sm border-b border-[#1e1f22] shrink-0">
            <h3 className="font-bold text-[#f2f3f5] text-xs uppercase tracking-wide truncate">Discussion avec {connectedPeerId.split('-')[0]}</h3>
            {/* Close button for mobile */}
            <button onClick={() => setShowMobileChat(false)} className="md:hidden text-[#b9bbbe] hover:text-white">
                <i className="fas fa-times"></i>
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
             {chatHistory.length === 0 && (
                 <div className="flex flex-col items-center justify-center h-full opacity-50">
                     <i className="fas fa-comments text-4xl mb-2 text-[#40444b]"></i>
                     <p className="text-xs text-[#949BA4]">Début de la discussion</p>
                 </div>
             )}
             {chatHistory.map((msg) => (
               <div key={msg.id} className="flex space-x-3 group animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <div className="w-8 h-8 rounded-full bg-[#5865F2] flex-shrink-0 flex items-center justify-center text-xs font-bold text-white overflow-hidden mt-0.5 cursor-pointer hover:opacity-80 transition-opacity">
                     {msg.sender === 'Moi' && localAvatar ? <img src={localAvatar} className="object-cover w-full h-full"/> : 
                      msg.sender !== 'Moi' && remoteAvatar ? <img src={remoteAvatar} className="object-cover w-full h-full"/> : getInitials(msg.sender)}
                  </div>
                  <div className="min-w-0 flex-1">
                     <div className="flex items-baseline space-x-2">
                        <span className={`font-medium text-sm cursor-pointer ${msg.sender === 'Moi' ? 'text-[#00aff4]' : 'text-[#f2f3f5]'}`}>
                           {msg.sender === 'Moi' ? username : msg.sender.split('-')[0]}
                        </span>
                        <span className="text-[10px] text-[#949BA4] font-medium">{new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                     </div>
                     {msg.text && <p className="text-[#dbdee1] text-[14px] leading-snug whitespace-pre-wrap mt-0.5 font-light">{msg.text}</p>}
                     {msg.image && (
                        <div className="mt-2 rounded overflow-hidden border border-[#2f3136] cursor-pointer inline-block max-w-full" onClick={() => {
                            const w = window.open("");
                            w?.document.write(`<img src="${msg.image}" style="max-width:100%"/>`);
                        }}>
                            <img src={msg.image} alt="Shared" className="w-full h-auto max-h-48 object-contain bg-[#1e1f22]" />
                        </div>
                     )}
                  </div>
               </div>
             ))}
             <div ref={chatBottomRef} />
          </div>

          <div className="p-3 bg-[#2b2d31] shrink-0">
            <div className="bg-[#383a40] rounded-lg p-1.5 flex items-center relative shadow-inner">
               <button onClick={() => mediaUploadRef.current?.click()} className="text-[#b9bbbe] hover:text-[#dbdee1] w-8 h-8 flex items-center justify-center mr-1 rounded-full hover:bg-[#40444b] transition-colors">
                  <i className="fas fa-plus-circle"></i>
               </button>
               <form onSubmit={sendMessage} className="flex-1">
                  <input
                    type="text" value={messageInput} onChange={e => setMessageInput(e.target.value)}
                    placeholder={`Message...`}
                    className="w-full bg-transparent text-[#dbdee1] text-sm focus:outline-none placeholder-[#949BA4] h-9"
                  />
               </form>
               <div className="relative">
                  <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className={`text-[#b9bbbe] hover:text-[#fcd462] w-8 h-8 flex items-center justify-center transition-colors hover:scale-110 transform ${showEmojiPicker ? 'text-[#fcd462]' : ''}`}>
                     <i className="fas fa-face-grin-wide"></i>
                  </button>
                  {showEmojiPicker && (
                      <div className="absolute bottom-10 right-0 bg-[#2b2d31] border border-[#1e1f22] p-2 rounded-lg shadow-2xl grid grid-cols-4 gap-1 w-48 z-50 animate-in fade-in zoom-in-95">
                          {EMOJI_LIST.map(emoji => (
                              <button key={emoji} onClick={() => addEmoji(emoji)} className="text-xl p-1.5 hover:bg-[#40444b] rounded transition-colors">{emoji}</button>
                          ))}
                      </div>
                  )}
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Subcomponent: Control Button ---
function ControlButton({ icon, active, onClick, color, tooltip }: any) {
    const baseClass = "w-10 h-10 rounded-full flex items-center justify-center transition-all transform active:scale-95 shadow-sm shrink-0";
    const activeClass = color === 'red' ? "bg-[#36393f] text-white hover:bg-[#40444b]" : "bg-[#f2f3f5] text-[#2b2d31] hover:brightness-90";
    const inactiveClass = color === 'red' ? "bg-[#ED4245] text-white hover:bg-red-700" : "bg-[#2b2d31] text-white hover:bg-[#40444b] group-hover:text-white";

    return (
        <div className="relative group flex flex-col items-center">
            {tooltip && <div className="hidden md:block absolute -top-8 bg-black text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none font-bold">{tooltip}</div>}
            <button onClick={onClick} className={`${baseClass} ${active ? activeClass : inactiveClass}`}>
                <i className={`fas ${icon} text-sm`}></i>
            </button>
        </div>
    )
}
