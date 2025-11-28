
// Defining PeerJS types manually since we are using CDN
export interface PeerOptions {
  host?: string;
  port?: number;
  path?: string;
  secure?: boolean;
  debug?: number;
}

export interface DataConnection {
  send: (data: any) => void;
  on: (event: string, cb: (data: any) => void) => void;
  close: () => void;
  peer: string;
  open: boolean;
}

export interface MediaConnection {
  answer: (stream: MediaStream) => void;
  on: (event: string, cb: (stream: MediaStream) => void) => void;
  close: () => void;
  peer: string;
  open: boolean;
  peerConnection: RTCPeerConnection;
}

export interface PeerInstance {
  new (id?: string, options?: PeerOptions): PeerInstance;
  on: (event: string, cb: (data: any) => void) => void;
  connect: (id: string) => DataConnection;
  call: (id: string, stream: MediaStream) => MediaConnection;
  destroy: () => void;
  id: string;
}

// Attach Peer to window for TypeScript
declare global {
  interface Window {
    Peer: PeerInstance;
    onYouTubeIframeAPIReady: () => void;
    YT: any;
  }
}

// App Logic Types
export interface ChatMessage {
  id: string;
  sender: string;
  text?: string;
  image?: string; // Base64
  timestamp: number;
  isSystem?: boolean;
}

export interface StatusMessage {
  type: 'status';
  muted: boolean;
  deafened: boolean;
  videoEnabled: boolean;
  isScreenSharing: boolean;
}

export interface TextDataMessage {
  type: 'chat';
  text: string;
  sender: string;
}

export interface FileDataMessage {
  type: 'file-share';
  file: string; // Base64
  fileName: string;
  fileType: string;
  sender: string;
}

export interface ProfileUpdateMessage {
  type: 'profile-update';
  avatar: string; // Base64
}

export interface ActivityMessage {
  type: 'activity';
  action: 'start' | 'stop' | 'sync-state' | 'play-music' | 'pause-music' | 'change-track';
  activityType: 'youtube' | 'music';
  data?: {
    // Youtube
    videoId?: string;
    playerState?: number;
    currentTime?: number;
    // Music
    trackIndex?: number;
    isPlaying?: boolean;
    
    timestamp?: number;
  };
}

export type NetworkMessage = StatusMessage | TextDataMessage | ProfileUpdateMessage | ActivityMessage | FileDataMessage;

export interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'success';
}
