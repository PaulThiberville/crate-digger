/** Subset of api-v2 objects we rely on. */
export interface ScUser {
  id: number;
  kind: string;
  username: string;
  permalink: string;
  permalink_url?: string;
  followings_count?: number;
  track_count?: number;
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

export type Quality = 'HIGH' | 'LOW' | 'UNKNOWN';

export type SkipReason = 'not_downloadable' | 'no_downloads_left' | 'not_public' | 'too_long' | 'forbidden';

/** An eligible track, as seen by the scan. */
export interface Candidate {
  id: number;
  title: string;
  uploader: string; // permalink of the following that published it
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
  curator?: string;
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
