
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
  metadata: any;
}

export interface MediaConnection {
  answer: (stream: MediaStream) => void;
  on: (event: string, cb: (stream: MediaStream) => void) => void;
  close: () => void;
  peer: string;
  open: boolean;
  peerConnection: RTCPeerConnection;
  metadata: any;
}

export interface PeerInstance {
  new (id?: string, options?: PeerOptions): PeerInstance;
  on: (event: string, cb: (data: any) => void) => void;
  connect: (id: string, options?: { metadata: any }) => DataConnection;
  call: (id: string, stream: MediaStream, options?: { metadata: any }) => MediaConnection;
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
export interface RemotePeer {
  id: string; // The Peer ID
  displayName: string;
  avatar?: string;
  stream?: MediaStream;
  dataConn?: DataConnection;
  mediaCall?: MediaConnection;
  status: {
    muted: boolean;
    deafened: boolean;
    videoEnabled: boolean;
    isScreenSharing: boolean;
  };
  currentActivity: 'none' | 'youtube' | 'whiteboard'; // What are they doing?
  volume: number; // 0-1 (Local volume control)
  isSpeaking: boolean;
}

export interface ChatMessage {
  id: string;
  sender: string;
  senderName?: string; // Display Name
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
  currentActivity?: 'none' | 'youtube' | 'whiteboard';
}

export interface TextDataMessage {
  type: 'chat';
  text: string;
  sender: string;
  senderName: string;
}

export interface FileDataMessage {
  type: 'file-share';
  file: string; // Base64
  fileName: string;
  fileType: string;
  sender: string;
  senderName: string;
}

export interface ProfileUpdateMessage {
  type: 'profile-update';
  avatar?: string; // Base64
  displayName?: string;
}

// Drawing Data Types
export interface DrawLine {
    prevX: number;
    prevY: number;
    x: number;
    y: number;
    color: string;
    size: number;
    isEraser: boolean;
}

export interface QueueItem {
    id: string; // Unique ID for the queue item
    videoId: string; // YouTube Video ID
    title: string;
    thumbnail: string;
    addedBy: string; // Peer ID
    addedByName: string;
}

export interface ActivityMessage {
  type: 'activity';
  action: 'start' | 'stop' | 'sync-state' | 'draw' | 'draw-batch' | 'clear' | 'new-page' | 'set-page' | 'sync-request' | 'add-queue' | 'remove-queue' | 'play-queue' | 'update-queue';
  activityType: 'youtube' | 'whiteboard';
  data?: {
    // Youtube
    videoId?: string;
    playerState?: number;
    currentTime?: number;
    queueItem?: QueueItem;
    queue?: QueueItem[];
    
    // Whiteboard
    drawData?: DrawLine;
    drawBatch?: DrawLine[]; // New optimization
    pageIndex?: number;
  };
}

// Sent by host to new joiners so they can connect to others
export interface PeerListMessage {
  type: 'peer-list';
  peers: string[]; // List of other peer IDs in the room
}

export type NetworkMessage = StatusMessage | TextDataMessage | ProfileUpdateMessage | ActivityMessage | FileDataMessage | PeerListMessage;

export interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'success';
}

export interface DeviceInfo {
    deviceId: string;
    label: string;
}
