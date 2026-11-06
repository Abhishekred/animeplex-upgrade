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
  features?: Record<string, boolean | undefined>;
  providers?: {
    enabled?: boolean;
    defaultProvider?: string;
    priority?: string[];
    maintenanceMessage?: string;
  };
};

// Read the public config file directly from GitHub. The Vercel dashboard is
// protected by team SSO; app clients must not need dashboard authentication.
const ADMIN_CONFIG_URL =
  'https://raw.githubusercontent.com/Abhishekred/Animeplex-Admin-panel/main/admin-config.json';

let cachedConfig: AnimePlexAdminConfig | null = null;
let lastFetchAt = 0;
const CACHE_TTL_MS = 60_000;

/**
 * Fetch the public, read-only configuration published by AnimePlex Control
 * Center. This endpoint intentionally contains no admin credentials.
 */
export async function fetchAnimePlexAdminConfig(
  force = false,
): Promise<AnimePlexAdminConfig | null> {
  if (!force && cachedConfig && Date.now() - lastFetchAt < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const response = await fetch(ADMIN_CONFIG_URL, {
      method: 'GET',
      headers: {Accept: 'application/json'},
    });
    if (!response.ok) {
      throw new Error(`Admin config request failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as AnimePlexAdminConfig;
    if (!payload || typeof payload !== 'object') {
      throw new Error('Admin config response is invalid');
    }

    cachedConfig = {
      ...payload,
      app: payload.app || 'AnimePlex',
      updatedAt: payload.updatedAt || null,
    };
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
