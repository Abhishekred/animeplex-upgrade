import {useFocusEffect} from '@react-navigation/native';
import {View, ScrollView, ToastAndroid, Linking, BackHandler, findNodeHandle} from 'react-native';
// import pkg from '../../../package.json';
import React, {useState, useEffect, useRef, useCallback} from 'react';
import {settingsStorage} from '../../lib/storage';
import * as RNFS from '@dr.pogodin/react-native-fs';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import {notificationService} from '../../lib/services/Notification';
import SettingsRow from '../../components/ui/SettingsRow';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingsSwitchRow from '../../components/ui/SettingsSwitchRow';
import AppText from '../../components/ui/Text';
import LoadingIndicator from '../../components/ui/LoadingIndicator';
import {showAppDialog} from '../../lib/zustand/appDialogStore';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import {isTV} from '../../lib/tv';
import {
  isDetailedLoggingEnabled,
  setDetailedLogging,
  shareLogs,
} from '../../lib/logging/vegaLog';
import {useRemoteStore} from '../../lib/remote/remoteStore';

const deletePartialFile = async (filePath: string) => {
  try {
    if (await RNFS.exists(filePath)) {
      await RNFS.unlink(filePath);
    }
  } catch {}
};

const downloadUpdate = async (url: string, name: string) => {
  console.log('downloading', url, name);
  await notificationService.requestPermission();

  const filePath = `${RNFS.CachesDirectoryPath}/${name}`;

  let expectedSize = 0;

  const {promise} = RNFS.downloadFile({
    fromUrl: url,
    background: true,
    progressInterval: 1000,
    progressDivider: 1,
    toFile: filePath,
    begin: res => {
      expectedSize = res.contentLength;
      console.log('begin', res.jobId, res.statusCode, res.contentLength);
    },
    progress: res => {
      notificationService.showUpdateProgress(
        'Downloading Update',
        `Version ${Application.nativeApplicationVersion} -> ${name}`,
        {
          current: res.bytesWritten,
          max: res.contentLength,
          indeterminate: false,
        },
      );
    },
  });

  try {
    const res = await promise;
    await notificationService.cancelNotification('updateProgress');

    if (res.statusCode !== 200 || res.bytesWritten < expectedSize) {
      console.log(
        `[update] Download failed: status=${res.statusCode}, bytes=${res.bytesWritten}/${expectedSize}`,
      );
      await deletePartialFile(filePath);
      ToastAndroid.show(
        'Download failed, please try again',
        ToastAndroid.SHORT,
      );
      return;
    }

    await notificationService.displayUpdateNotification({
      id: 'downloadComplete',
      title: 'Download Complete',
      body: 'Tap to install',
      data: {filePath, action: 'install'},
    });
  } catch (error) {
    console.log('[update] Download error:', error);
    await notificationService.cancelNotification('updateProgress');
    await deletePartialFile(filePath);
    ToastAndroid.show('Download failed, please try again', ToastAndroid.SHORT);
  }
};

// handle check for update
export const checkForUpdate = async (
  setUpdateLoading: React.Dispatch<React.SetStateAction<boolean>>,
  autoDownload: boolean,
  showToast: boolean = true,
) => {
  setUpdateLoading(true);
  try {
    // AnimePlex updates are managed exclusively from the Admin Panel manifest.
    // Do not fall back to the upstream Vega release feed.
    const manifestResponse = await fetch(
      'https://raw.githubusercontent.com/Abhishekred/Animeplex-Admin-panel/main/release.json',
      {headers: {'Cache-Control': 'no-cache'}},
    );
    if (!manifestResponse.ok) {
      throw new Error(`AnimePlex Admin update manifest unavailable (HTTP ${manifestResponse.status})`);
    }
    const manifest = await manifestResponse.json();
    if (!manifest?.version) {
      throw new Error('AnimePlex Admin has not published a valid release version');
    }
    const apkUrl = typeof manifest.apkUrl === 'string' ? manifest.apkUrl.trim() : '';
    const apkName = apkUrl.split('/').pop()?.split('?')[0] || 'AnimePlex-update.apk';
    const data: any = {
      tag_name: String(manifest.version).startsWith('v')
        ? String(manifest.version)
        : `v${manifest.version}`,
      body: manifest.releaseNotes || manifest.title || 'AnimePlex update available.',
      assets: apkUrl && apkUrl.toLowerCase().split('?')[0].endsWith('.apk')
        ? [{name: apkName, browser_download_url: apkUrl}]
        : [],
      html_url: apkUrl || 'https://animeplex-admin-panel.vercel.app/',
      forceUpdate: Boolean(manifest.forceUpdate),
      minimumVersion: manifest.minimumVersion || '0.0.0',
    };
    if (!data?.tag_name) {
      throw new Error('Invalid release data received from AnimePlex admin or GitHub');
    }
    const localVersion = Application.nativeApplicationVersion;
    const remoteVersion = Number(
      data.tag_name.replace('v', '')?.split('.').join(''),
    );
    if (compareVersions(localVersion || '', data.tag_name.replace('v', ''))) {
      ToastAndroid.show('New update available', ToastAndroid.SHORT);
      showAppDialog({
        title: `Update v${localVersion} -> ${data.tag_name}`,
        message: data.body,
        messageFormat: 'markdown',
        actions: [
          {label: 'Cancel'},
          {
            label: 'Update',
            variant: 'primary',
            onPress: () => {
              const apkAsset = data?.assets?.find((asset: any) =>
                asset.name?.toLowerCase().endsWith('.apk'),
              );
              if (autoDownload && apkAsset) {
                return downloadUpdate(apkAsset.browser_download_url, apkAsset.name);
              }
              if (!apkAsset) {
                ToastAndroid.show(
                  'Update is published, but the Admin Panel APK URL is missing or invalid.',
                  ToastAndroid.LONG,
                );
                return Linking.openURL('https://animeplex-admin-panel.vercel.app/');
              }
              return Linking.openURL(apkAsset.browser_download_url);
            },
          },
        ],
      });
      console.log(
        'local version',
        localVersion,
        'remote version',
        remoteVersion,
      );
    } else {
      showToast && ToastAndroid.show('App is up to date', ToastAndroid.SHORT);
      console.log(
        'local version',
        localVersion,
        'remote version',
        remoteVersion,
      );
    }
  } catch (error) {
    const isRateLimit =
      error instanceof Error &&
      error.message.toLowerCase().includes('rate limit');
    const msg = isRateLimit
      ? 'GitHub API rate limit exceeded. Please wait a few minutes before trying again.'
      : 'Failed to check for update';
    ToastAndroid.show(msg, ToastAndroid.SHORT);
    console.log('Update error', error);
  }
  setUpdateLoading(false);
};

const About = ({navigation}: any) => {
  const colors = useM3Colors();
  const backRef = useRef<View>(null);
  const autoDownloadRef = useRef<View>(null);
  const [backHandle, setBackHandle] = useState<number | null>(null);
  const [autoDownloadHandle, setAutoDownloadHandle] = useState<number | null>(null);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [autoDownload, setAutoDownload] = useState(
    settingsStorage.isAutoDownloadEnabled(),
  );
  const [autoCheckUpdate, setAutoCheckUpdate] = useState<boolean>(
    settingsStorage.isAutoCheckUpdateEnabled(),
  );
  const [detailedLogging, setDetailedLoggingState] = useState(
    isDetailedLoggingEnabled,
  );
  const [exportingLogs, setExportingLogs] = useState(false);

  const exportLogs = async () => {
    setExportingLogs(true);
    try {
      const device = useRemoteStore.getState().connectedDevice;
      await shareLogs(
        device
          ? `Receiver ${device.type}: ${[device.manufacturer, device.model, device.name]
              .filter(Boolean)
              .join(' ')}`
          : undefined,
      );
    } catch (error: any) {
      ToastAndroid.show(
        error?.message || 'Could not export logs',
        ToastAndroid.SHORT,
      );
    } finally {
      setExportingLogs(false);
    }
  };

  // Register only while this screen is focused. A hidden screen in a
  // mounted tab or stack must not swallow back presses.
  useFocusEffect(
    useCallback(() => {
      if (!isTV) {
        return;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (navigation?.canGoBack?.()) {
          navigation.goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [navigation]),
  );

  return (
    <TVFocusGuide autoFocus={true} trapFocusRight={true} trapFocusDown={true} style={{flex: 1}}>
      <ScrollView
        focusable={false}
        accessible={false}
        style={{flex: 1, backgroundColor: colors.background}}
        contentContainerStyle={{padding: 20, paddingBottom: 40}}
        showsVerticalScrollIndicator={false}>
        <View className="mb-7">
          <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 12}}>
            <TVFocusable
              ref={backRef}
              onLayout={() => setBackHandle(findNodeHandle(backRef.current))}
              nextFocusDown={autoDownloadHandle}
              hasTVPreferredFocus={isTV}
              accessibilityLabel="Go back"
              accessibilityRole="button"
              onPress={() => navigation.goBack()}
              borderRadius={22}
              style={{
                alignItems: 'center',
                height: 44,
                justifyContent: 'center',
                marginRight: 10,
                width: 44,
              }}>
              <MaterialCommunityIcons
                name="arrow-left"
                size={28}
                color={colors.onBackground}
              />
            </TVFocusable>
            <AppText
              role="headlineLargeEmphasized"
              className="text-m3-on-background">
              About AnimePlex
            </AppText>
          </View>
          <AppText role="bodyLarge" className="mt-1 text-m3-on-surface-variant">
            App information and updates
          </AppText>
        </View>

        <SettingsSection title="App">
          <SettingsRow
            title="Version"
            description={`AnimePlex ${Application.nativeApplicationVersion || ''}`}
            icon="information-outline"
            divider={Constants.expoConfig?.extra?.isPlayStore}
          />

          {!Constants.expoConfig?.extra?.isPlayStore && (
            <>
              <SettingsSwitchRow
                ref={autoDownloadRef}
                nextFocusUp={backHandle}
                title="Auto install updates"
                description="Download and install new releases automatically"
                value={autoDownload}
                onValueChange={next => {
                  setAutoDownload(next);
                  settingsStorage.setAutoDownloadEnabled(next);
                }}
              />
              <SettingsSwitchRow
                title="Check on startup"
                description="Look for a new AnimePlex release when the app opens"
                value={autoCheckUpdate}
                onValueChange={next => {
                  setAutoCheckUpdate(next);
                  settingsStorage.setAutoCheckUpdateEnabled(next);
                }}
              />
              <SettingsRow
                title="Check for updates"
                description="Compare this build with the latest release"
                icon="update"
                divider={false}
                trailing={
                  updateLoading ? <LoadingIndicator size={14} /> : undefined
                }
                onPress={
                  updateLoading
                    ? undefined
                    : () => checkForUpdate(setUpdateLoading, autoDownload, true)
                }
              />
            </>
          )}
        </SettingsSection>

        {!isTV && (
          <SettingsSection title="Troubleshooting">
            <SettingsSwitchRow
              title="Detailed logging"
              description="Records more detail for bug reports. Keeps up to 2 MB of logs. Turns off after 24 hours."
              value={detailedLogging}
              onValueChange={next => {
                setDetailedLoggingState(next);
                setDetailedLogging(next);
              }}
            />
            <SettingsRow
              title="Export logs"
              description="Share recent app logs with the developer. Links and sign-in data are removed."
              icon="file-document-outline"
              divider={false}
              trailing={
                exportingLogs ? <LoadingIndicator size={14} /> : undefined
              }
              onPress={exportingLogs ? undefined : exportLogs}
            />
          </SettingsSection>
        )}
      </ScrollView>
    </TVFocusGuide>
  );
};

export default About;

function compareVersions(localVersion: string, remoteVersion: string): boolean {
  try {
    // Split versions into arrays and convert to numbers
    const local = localVersion.split('.').map(Number);
    const remote = remoteVersion.split('.').map(Number);

    // Compare major version
    if (remote[0] > local[0]) {
      return true;
    }
    if (remote[0] < local[0]) {
      return false;
    }

    // Compare minor version
    if (remote[1] > local[1]) {
      return true;
    }
    if (remote[1] < local[1]) {
      return false;
    }

    // Compare patch version
    if (remote[2] > local[2]) {
      return true;
    }

    return false;
  } catch (error) {
    console.error('Invalid version format');
    return false;
  }
}
