import {useFocusEffect} from '@react-navigation/native';
import {View, ScrollView, ToastAndroid, Linking, BackHandler, findNodeHandle, Image} from 'react-native';
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
  clearLogs,
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

// AnimePlex releases are managed from the Admin Panel. The panel API reads
// the public release manifest and keeps GitHub credentials off the Android app.
const UPDATE_MANIFEST_URL = 'https://aimeplex2admin.vercel.app/api/release';

type AnimePlexReleaseManifest = {
  app?: string;
  version: string;
  versionCode?: number;
  forceUpdate?: boolean;
  title?: string;
  releaseNotes?: string;
  apkUrl?: string;
  minimumVersion?: string;
};

export const checkForUpdate = async (
  setUpdateLoading: React.Dispatch<React.SetStateAction<boolean>>,
  autoDownload: boolean,
  showToast: boolean = true,
) => {
  setUpdateLoading(true);
  try {
    const res = await fetch(UPDATE_MANIFEST_URL, {
      method: 'GET',
      headers: {Accept: 'application/json', 'Cache-Control': 'no-cache'},
    });
    if (!res.ok) {
      throw new Error(`Admin Panel update check failed (HTTP ${res.status})`);
    }

    const data = (await res.json()) as AnimePlexReleaseManifest;
    if (
      data?.app !== 'AnimePlex' ||
      typeof data.version !== 'string' ||
      !/^\\d+\\.\\d+\\.\\d+$/.test(data.version)
    ) {
      throw new Error('Admin Panel returned an invalid AnimePlex release manifest');
    }

    const localVersion = Application.nativeApplicationVersion || '0.0.0';
    const latestVersion = data.version;
    const hasUpdate = compareVersions(localVersion, latestVersion);
    const isBelowMinimum =
      !!data.minimumVersion &&
      compareVersions(localVersion, data.minimumVersion);

    if (!hasUpdate && !isBelowMinimum) {
      showToast && ToastAndroid.show('AnimePlex is up to date', ToastAndroid.SHORT);
      return;
    }

    const apkUrl =
      typeof data.apkUrl === 'string' && /^https:\\/\\//i.test(data.apkUrl)
        ? data.apkUrl
        : '';
    const apkLinkConfigured =
      !!apkUrl && !apkUrl.includes('aimeplex2admin.vercel.app');

    if (!apkLinkConfigured) {
      ToastAndroid.show(
        'Update is listed in Admin Panel, but a direct APK URL has not been configured yet.',
        ToastAndroid.LONG,
      );
    }

    showAppDialog({
      title: data.title || `AnimePlex update v${latestVersion}`,
      message:
        data.releaseNotes ||
        `A new AnimePlex version (${latestVersion}) is available.`,
      messageFormat: 'markdown',
      actions: [
        ...(data.forceUpdate || isBelowMinimum ? [] : [{label: 'Later'}]),
        {
          label: apkLinkConfigured ? 'Update' : 'Close',
          variant: 'primary',
          onPress: () => {
            if (!apkLinkConfigured) return;
            const fileName = `AnimePlex-${latestVersion}-${isTV ? 'TV' : 'Mobile'}.apk`;
            return autoDownload
              ? downloadUpdate(apkUrl, fileName)
              : Linking.openURL(apkUrl);
          },
        },
      ],
    });
    console.log('AnimePlex update manifest', {
      localVersion,
      latestVersion,
      versionCode: data.versionCode,
      forceUpdate: data.forceUpdate,
    });
  } catch (error) {
    ToastAndroid.show('Could not check AnimePlex updates. Please try again.', ToastAndroid.SHORT);
    console.log('Admin Panel update error', error);
  } finally {
    setUpdateLoading(false);
  }
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
  const [clearingLogs, setClearingLogs] = useState(false);

  const handleClearLogs = async () => {
    setClearingLogs(true);
    try {
      await clearLogs();
      ToastAndroid.show('Logs cleared', ToastAndroid.SHORT);
    } catch (error: any) {
      ToastAndroid.show(error?.message || 'Could not clear logs', ToastAndroid.SHORT);
    } finally {
      setClearingLogs(false);
    }
  };

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
            <Image
              source={require('../../../assets/adaptive_icon.png')}
              resizeMode="contain"
              accessible
              accessibilityLabel="AnimePlex app logo"
              style={{
                width: 56,
                height: 56,
                marginRight: 12,
                borderRadius: 12,
                backgroundColor: colors.surfaceContainerHigh,
              }}
            />
            <AppText
              role="headlineLargeEmphasized"
              className="text-m3-on-background">
              AnimePlex
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
                description="Look for a new release when AnimePlex opens"
                value={autoCheckUpdate}
                onValueChange={next => {
                  setAutoCheckUpdate(next);
                  settingsStorage.setAutoCheckUpdateEnabled(next);
                }}
              />
              <SettingsRow
                title="Check for updates"
                description="Compare this AnimePlex build with the latest release"
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
              trailing={
                exportingLogs ? <LoadingIndicator size={14} /> : undefined
              }
              onPress={exportingLogs || clearingLogs ? undefined : exportLogs}
            />
            <SettingsRow
              title="Clear logs"
              description="Clear old logs before reproducing a problem."
              icon="delete-outline"
              divider={false}
              trailing={clearingLogs ? <LoadingIndicator size={14} /> : undefined}
              onPress={clearingLogs || exportingLogs ? undefined : handleClearLogs}
            />
          </SettingsSection>
        )}
      </ScrollView>
    </TVFocusGuide>
  );
};

export default About;

function compareVersions(localVersion: string, remoteVersion: string): boolean {
  const parse = (value: string) =>
    value.replace(/^[vV]/, '').split(/[.+-]/).slice(0, 3).map(part => {
      const match = part.match(/^\\d+/);
      return match ? Number(match[0]) : 0;
    });
  const local = parse(localVersion);
  const remote = parse(remoteVersion);
  for (let index = 0; index < 3; index++) {
    const difference = (remote[index] || 0) - (local[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}
