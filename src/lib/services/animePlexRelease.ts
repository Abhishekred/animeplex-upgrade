import {Alert, Linking} from 'react-native';
import Constants from 'expo-constants';

const RELEASE_URL =
  'https://raw.githubusercontent.com/Abhishekred/Animeplex-Admin-panel/main/release.json';

type ReleaseManifest = {
  app?: string;
  version?: string;
  versionCode?: number;
  forceUpdate?: boolean;
  title?: string;
  releaseNotes?: string;
  apkUrl?: string;
  minimumVersion?: string;
};

function compareVersions(a: string, b: string): number {
  const parse = (value: string) =>
    value.split(/[.+-]/, 1)[0].split('.').map(part => Number(part) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] || 0) - (right[i] || 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

export async function checkAnimePlexRelease(): Promise<void> {
  try {
    const response = await fetch(`${RELEASE_URL}?t=${Date.now()}`, {
      headers: {Accept: 'application/json'},
    });
    if (!response.ok) return;

    const release = (await response.json()) as ReleaseManifest;
    if (!release.version || release.app !== 'AnimePlex') return;

    const installedVersion = Constants.expoConfig?.version || '0.0.0';
    const installedCode = Number(Constants.expoConfig?.android?.versionCode || 0);
    const belowMinimum = compareVersions(installedVersion, release.minimumVersion || '0.0.0') < 0;
    const hasNewVersion =
      compareVersions(release.version, installedVersion) > 0 ||
      (Number(release.versionCode) > installedCode && release.version === installedVersion);
    const mustUpdate = Boolean(release.forceUpdate || belowMinimum);

    if (!hasNewVersion && !belowMinimum) return;

    const message = [
      `Version ${release.version} is available.`,
      release.releaseNotes?.trim() || 'Bug fixes and improvements.',
      release.apkUrl
        ? (mustUpdate ? 'This update is required. Choose Update now to continue.' : 'Choose Download to open the APK download page.')
        : 'The release is announced, but an APK download link has not been added yet.',
    ].join('\\n\\n');

    const downloadButton = release.apkUrl
      ? [{
          text: mustUpdate ? 'Update now' : 'Download',
          onPress: () => {
            Linking.openURL(release.apkUrl!).catch(() => {
              Alert.alert('Unable to open link', 'Please try again later.');
            });
          },
        }]
      : [];

    Alert.alert(
      release.title || 'AnimePlex update available',
      message,
      mustUpdate ? downloadButton : [{text: 'Later', style: 'cancel'}, ...downloadButton],
      {cancelable: !mustUpdate},
    );
  } catch (error) {
    // Update checks are best-effort and must never prevent the app from opening.
    console.warn('[AnimePlex updates] Release check failed:', error);
  }
}
