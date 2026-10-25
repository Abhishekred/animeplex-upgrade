/** Shared Watch Party contracts. These types intentionally contain no credentials. */

export type WatchPartyRole = 'host' | 'member';

export type WatchPartyStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export type WatchPartyPlaybackAction =
  | 'play'
  | 'pause'
  | 'seek'
  | 'media_changed';

export interface WatchPartyMedia {
  /** Stable identity for the title/episode, not a provider URL. */
  mediaId: string;
  title: string;
  episodeTitle?: string;
  posterUrl?: string;
  providerId?: string;
  /** Hash/identity for the selected playable source; do not expose credentials. */
  sourceFingerprint: string;
}

export interface WatchPartyMember {
  userId: string;
  displayName: string;
  role: WatchPartyRole;
  status: WatchPartyStatus;
  joinedAt: string;
  mediaCompatible: boolean;
}

export interface WatchPartyRoom {
  id: string;
  code: string;
  hostUserId: string;
  status: 'open' | 'closed';
  media: WatchPartyMedia;
  createdAt: string;
  expiresAt: string;
}

export interface WatchPartyPlaybackState {
  roomId: string;
  sequence: number;
  action: WatchPartyPlaybackAction;
  positionSeconds: number;
  playing: boolean;
  mediaId: string;
  sourceFingerprint: string;
  hostTimestamp: number;
}

export interface WatchPartyChatMessage {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  text: string;
  createdAt: string;
}
