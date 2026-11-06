export type AnimePlexAdminConfig = {
  app?: string;
  updatedAt?: string | null;
  general?: {
    maintenanceMode?: boolean;
    minimumAppVersion?: string;
    announcementEnabled?: boolean;
    announcementTitle?: string;
    announcementMessage?: string;
  };
  features?: {
    hamburgerMenu?: boolean;
    watchParty?: boolean;
    liveChat?: boolean;
    downloads?: boolean;
    cast?: boolean;
    autoPlay?: boolean;
    skipIntro?: boolean;
    continueWatching?: boolean;
    adultContent?: boolean;
    [key: string]: boolean | undefined;
  };
  playback?: {
    defaultAudio?: string;
    defaultQuality?: string;
    autoQuality?: boolean;
    subtitlesEnabled?: boolean;
    preferredSubtitle?: string;
    playerControls?: boolean;
  };
  homeShortcuts?: Array<{
    id: string;
    label: string;
    providerValue: string;
    enabled: boolean;
  }>;
  providers?: {
    enabled?: boolean;
    defaultProvider?: string;
    priority?: string[];
    maintenanceMessage?: string;
  };
  notifications?: {
    inApp?: boolean;
    releaseAlerts?: boolean;
    maintenanceAlerts?: boolean;
    featureAlerts?: boolean;
  };
  privacy?: {
    analyticsEnabled?: boolean;
    crashReports?: boolean;
    showViewerNames?: boolean;
  };
  limits?: {
    maxWatchPartyMembers?: number;
    heartbeatSeconds?: number;
    sessionTimeoutSeconds?: number;
  };
  content?: {
    movies?: boolean;
    anime?: boolean;
    tvSeries?: boolean;
    webSeries?: boolean;
    featuredEnabled?: boolean;
  };
  security?: {
    minimumSupportedVersion?: string;
    forceUpdate?: boolean;
    blockedVersions?: string[];
  };
  navigationBar?: Record<string, string | number | boolean>;
  platformStyle?: Record<string, string | number | boolean>;
};

const ADMIN_CONFIG_URL =
  'https://raw.githubusercontent.com/Abhishekred/Animeplex-Admin-panel/main/admin-config.json';

let cachedConfig: AnimePlexAdminConfig | null = null;
let lastFetchAt = 0;
const CACHE_TTL_MS = 60_000;

export async function fetchAnimePlexAdminConfig(
  force = false,
): Promise<AnimePlexAdminConfig | null> {
  if (!force && cachedConfig && Date.now() - lastFetchAt < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const response = await fetch(ADMIN_CONFIG_URL, {
      method: 'GET',
      headers: {Accept: 'application/json', 'Cache-Control': 'no-cache'},
    });
    if (!response.ok) {
      throw new Error(`Admin config request failed: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as AnimePlexAdminConfig;
    if (!payload || typeof payload !== 'object' || payload.app !== 'AnimePlex') {
      throw new Error('Admin config response is invalid');
    }
    cachedConfig = payload;
    lastFetchAt = Date.now();
    return cachedConfig;
  } catch (error) {
    console.warn('[AnimePlex Admin] Remote config unavailable:', error);
    return cachedConfig;
  }
}

export function getCachedAnimePlexAdminConfig(): AnimePlexAdminConfig | null {
  return cachedConfig;
}
