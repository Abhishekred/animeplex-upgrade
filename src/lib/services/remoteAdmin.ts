import * as Crypto from 'expo-crypto';

export const ANIMEPLEX_ADMIN_ORIGIN = 'https://animeplex-admin-panel.vercel.app';
const CONFIG_URL = `${ANIMEPLEX_ADMIN_ORIGIN}/api/config`;
const TELEMETRY_URL = `${ANIMEPLEX_ADMIN_ORIGIN}/api/telemetry';

export type RemoteAdminConfig = {
  app?: string;
  updatedAt?: string | null;
  general?: {
    maintenanceMode?: boolean;
    minimumAppVersion?: string;
    announcementEnabled?: boolean;
    announcementTitle?: string;
    announcementMessage?: string;
  };
  features?: Record<string, boolean | number | string>;
  content?: Record<string, boolean>;
  providers?: Record<string, unknown>;
  playback?: Record<string, unknown>;
  notifications?: Record<string, boolean>;
  privacy?: Record<string, boolean>;
  limits?: Record<string, number>;
  security?: Record<string, unknown>;
};

type ConfigEnvelope = {
  app?: string;
  config?: RemoteAdminConfig;
  updatedAt?: string | null;
};

type ViewerHeartbeat = {
  title: string;
  season?: string;
  episode?: string;
  platform?: string;
  startedAt?: string;
};

let currentConfig: RemoteAdminConfig | null = null;
let configPoll: ReturnType<typeof setInterval> | null = null;
let anonymousDeviceId: string | null = null;
let listeners = new Set<(config: RemoteAdminConfig) => void>();

export function getRemoteAdminConfig(): RemoteAdminConfig | null {
  return currentConfig;
}

export function subscribeRemoteAdminConfig(
  listener: (config: RemoteAdminConfig) => void,
): () => void {
  listeners.add(listener);
  if (currentConfig) listener(currentConfig);
  return () => listeners.delete(listener);
}

export async function fetchRemoteAdminConfig(): Promise<RemoteAdminConfig | null> {
  try {
    const response = await fetch(CONFIG_URL, {
      method: 'GET',
      headers: {Accept: 'application/json', 'Cache-Control': 'no-cache'},
    });
    if (!response.ok) throw new Error(`Admin config HTTP ${response.status}`);
    const envelope = (await response.json()) as ConfigEnvelope;
    if (!envelope?.config || typeof envelope.config !== 'object') {
      throw new Error('Invalid AnimePlex admin config response');
    }
    currentConfig = envelope.config;
    listeners.forEach(listener => {
      try {
        listener(currentConfig as RemoteAdminConfig);
      } catch (error) {
        console.warn('[AnimePlex Admin] Config listener failed:', error);
      }
    });
    return currentConfig;
  } catch (error) {
    // The app must remain usable when the remote dashboard is offline.
    console.warn('[AnimePlex Admin] Could not refresh remote settings:', error);
    return currentConfig;
  }
}

export function startRemoteAdminSync(intervalMs = 60_000): () => void {
  void fetchRemoteAdminConfig();
  if (configPoll) clearInterval(configPoll);
  configPoll = setInterval(() => {
    void fetchRemoteAdminConfig();
  }, intervalMs);
  return () => {
    if (configPoll) clearInterval(configPoll);
    configPoll = null;
  };
}

async function getAnonymousDeviceId(): Promise<string> {
  if (!anonymousDeviceId) anonymousDeviceId = Crypto.randomUUID();
  return anonymousDeviceId;
}

export async function sendViewerHeartbeat(
  session: ViewerHeartbeat,
): Promise<void> {
  if (!session.title?.trim()) return;
  try {
    const deviceId = await getAnonymousDeviceId();
    const response = await fetch(TELEMETRY_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify({
        deviceId,
        title: session.title.trim().slice(0, 200),
        season: session.season?.slice(0, 80) || '',
        episode: session.episode?.slice(0, 80) || '',
        platform: session.platform || 'android',
        startedAt: session.startedAt || new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      console.warn('[AnimePlex Admin] Viewer heartbeat rejected:', response.status);
    }
  } catch (error) {
    // Telemetry is best-effort and must never interrupt video playback.
    console.warn('[AnimePlex Admin] Viewer heartbeat failed:', error);
  }
}
