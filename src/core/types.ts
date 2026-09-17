/** Subset of api-v2 objects we rely on. */
export interface ScUser {
  id: number;
  kind: string;
  username: string;
  permalink: string;
  permalink_url?: string;
  followings_count?: number;
  track_count?: number;
  likes_count?: number; // tracks + playlists
}

export interface ScTrack {
  id: number;
  kind: string;
  title: string;
  permalink: string;
  permalink_url?: string;
  duration: number; // ms
  downloadable?: boolean;
  has_downloads_left?: boolean;
  sharing?: string; // "public" | "private"
  streamable?: boolean;
  policy?: string;
  state?: string;
  user?: Partial<ScUser>;
}

/** One item of `/users/{id}/likes`: a liked track or a liked playlist. */
export interface ScLike {
  kind: string; // "like"
  created_at?: string;
  track?: ScTrack;
  playlist?: { id: number; kind: string; title?: string };
}

/** What gets scanned: the uploads of a curator's followings, or the likes of a profile. */
export type Mode = 'followings' | 'likes';

export interface Source {
  mode: Mode;
  profile: ScUser;
}

export type Quality = 'HIGH' | 'LOW' | 'UNKNOWN';

export type SkipReason = 'not_downloadable' | 'no_downloads_left' | 'not_public' | 'too_long' | 'forbidden';

/** An eligible track, as seen by the scan. */
export interface Candidate {
  id: number;
  title: string;
  uploader: string; // permalink of the account that published it
  uploaderName: string;
  duration: number;
  quality: Quality;
  ext?: string;
  size?: number;
  url?: string; // download link obtained during the scan
  urlAt?: number;
  loginRequired?: boolean;
}

export interface IndexEntry {
  id: string;
  path: string; // relative to the library root, "/"-separated
  title?: string;
  curator?: string; // permalink of the scanned profile (curator or liker), kept under its historical key
  mode?: Mode;
  uploader?: string;
  downloaded_at?: string;
}

export interface Session {
  token: string;
  username: string;
  permalink: string;
  userId: number;
  savedAt: string;
}
