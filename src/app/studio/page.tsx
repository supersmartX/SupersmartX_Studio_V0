'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { NUDGE_AMOUNT_KEYBOARD, PLATFORM_PRESETS } from '@/constants';

import { useWelcomeModal } from '@/hooks/useWelcomeModal';
import { useCamera } from '@/hooks/useCamera';
import { useRecorder } from '@/hooks/useRecorder';
import { useScriptStorage } from '@/hooks/useScriptStorage';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useFocusView } from '@/hooks/useFocusView';
import { useToast } from '@/hooks/useToast';
import { useShare } from '@/hooks/useShare';
import { useLibrary } from '@/hooks/useLibrary';
import { useSettings } from '@/hooks/useSettings';
import { useRecordingConfig } from '@/hooks/useRecordingConfig';
import { useMasterRecording } from '@/hooks/useMasterRecording';
import { useExportPipeline } from '@/hooks/useExportPipeline';

import { Header } from '@/components/layout/Header';
import { IconRail } from '@/components/layout/IconRail';
import { BottomNav } from '@/components/layout/BottomNav';
import { InspectorPanel } from '@/components/layout/InspectorPanel';
import { Canvas } from '@/components/layout/Canvas';
import { DeviceSelectorBar } from '@/components/layout/DeviceSelectorBar';
import { TransportBar } from '@/components/layout/TransportBar';
import { Footer } from '@/components/layout/Footer';
import { CameraPreview } from '@/components/studio/CameraPreview';
import { TeleprompterOverlay } from '@/components/studio/TeleprompterOverlay';
import { RecordingBadge } from '@/components/studio/RecordingBadge';
import { Timer } from '@/components/studio/Timer';
import { CountdownOverlay } from '@/components/studio/CountdownOverlay';
import { InitOverlay } from '@/components/studio/InitOverlay';
import { FocalGuideway } from '@/components/studio/FocalGuideway';
import { WelcomeModal } from '@/components/dialogs/WelcomeModal';
import { ExportModal } from '@/components/dialogs/ExportModal';
import { PricingModal } from '@/components/dialogs/PricingModal';
import { AuthModal } from '@/components/auth/AuthModal';
import { executePendingDownload } from '@/lib/auth-guard';
import { LibraryPanel } from '@/components/studio/LibraryPanel';
import { InsightsPlaceholder } from '@/features/insights/InsightsPlaceholder';
import { Toast } from '@/components/common/Toast';
import type { TabType } from '@/types';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

export default function HomePage() {
  const welcomeModal = useWelcomeModal();
  const camera = useCamera();
  const { toast, showToast } = useToast();
  const { share } = useShare(showToast);
  const focusView = useFocusView();
  const scriptStorage = useScriptStorage();
  const { data: session } = useSession();
  const library = useLibrary();
  const settingsStore = useSettings();
  const {
    config: recordingConfig,
    setPlatformId: setRecordingPlatformId,
    setCustomAspectRatio: setRecordingCustomAspectRatio,
    setCustomDimensions: setRecordingCustomDimensions,
    setMirrored: setRecordingMirrored,
    setVideoDevice: setRecordingVideoDevice,
    setAudioDevice: setRecordingAudioDevice,
  } = useRecordingConfig();
  const {
    masterRecording: masterRecordingData,
    createMasterRecording,
    clearMasterRecording,
  } = useMasterRecording();
  const {
    exportConfig,
    exportJobs,
    setExportConfig,
    selectPlatform,
    updateCrop,
    resetCrop,
    startExport,
    startBatchExport,
    cancelExport,
    clearJobs,
  } = useExportPipeline();

  // Only used for drawer/modal state logic, NOT for layout visibility
  const isMobile = useMediaQuery('(max-width: 640px)');

  const [activePanel, setActivePanel] = useState<TabType | 'record' | 'share'>('studio');
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [downloadCount, setDownloadCount] = useState(0);
  const prompterContainerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);
  const recordingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const FREE_VIDEO_DOWNLOAD_LIMIT = 3;
  const FREE_MAX_RECORDING_SECONDS = 300; // 5 minutes

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);

  const handleAuthRequired = useCallback(() => {
    setIsAuthModalOpen(true);
  }, []);

  const handleAuthSuccess = useCallback(() => {
    executePendingDownload();
  }, []);

  const recorder = useRecorder(camera.stream, recordingConfig);

  useEffect(() => {
    if (camera.videoDevices.length > 0) {
      const stillExists = camera.videoDevices.some(d => d.deviceId === settingsStore.selectedVideoDevice);
      if (!settingsStore.selectedVideoDevice || !stillExists) {
        settingsStore.setSelectedVideoDevice(camera.videoDevices[0].deviceId);
      }
    } else {
      settingsStore.setSelectedVideoDevice('');
    }
    if (camera.audioDevices.length > 0) {
      const stillExists = camera.audioDevices.some(d => d.deviceId === settingsStore.selectedAudioDevice);
      if (!settingsStore.selectedAudioDevice || !stillExists) {
        settingsStore.setSelectedAudioDevice(camera.audioDevices[0].deviceId);
      }
    } else {
      settingsStore.setSelectedAudioDevice('');
    }
  }, [camera.videoDevices, camera.audioDevices, settingsStore.selectedVideoDevice, settingsStore.selectedAudioDevice]);

  // Sync settings store changes to recording config store
  useEffect(() => {
    setRecordingPlatformId(settingsStore.platformId);
    setRecordingCustomAspectRatio(settingsStore.customAspectRatio);
    setRecordingCustomDimensions(settingsStore.customWidth, settingsStore.customHeight);
    setRecordingMirrored(settingsStore.isMirrored);
  }, [
    settingsStore.platformId,
    settingsStore.customAspectRatio,
    settingsStore.customWidth,
    settingsStore.customHeight,
    settingsStore.isMirrored,
    setRecordingPlatformId,
    setRecordingCustomAspectRatio,
    setRecordingCustomDimensions,
    setRecordingMirrored,
  ]);

  // Sync device IDs from settings to recording config
  useEffect(() => {
    setRecordingVideoDevice(settingsStore.selectedVideoDevice);
    setRecordingAudioDevice(settingsStore.selectedAudioDevice);
  }, [
    settingsStore.selectedVideoDevice,
    settingsStore.selectedAudioDevice,
    setRecordingVideoDevice,
    setRecordingAudioDevice,
  ]);

  useEffect(() => {
    if (recorder.recordingState === 'recording') {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => {
          const next = prev + 1;
          if (next === FREE_MAX_RECORDING_SECONDS - 60) {
            showToast('1 minute remaining on Free plan recording limit');
          }
          if (next >= FREE_MAX_RECORDING_SECONDS) {
            if (timerRef.current) clearInterval(timerRef.current);
            setTimeout(() => recorder.stopRecording(), 0);
            showToast('Recording stopped — 5 minute limit reached on Free plan');
            return FREE_MAX_RECORDING_SECONDS;
          }
          return next;
        });
      }, 1000);
    } else if (recorder.recordingState === 'paused') {
      if (timerRef.current) clearInterval(timerRef.current);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [recorder.recordingState, recorder.stopRecording, showToast]);

  const handleRecordStart = useCallback(() => {
    if (!camera.stream) return;

    if (prompterContainerRef.current) {
      prompterContainerRef.current.scrollTop = 0;
    }

    setElapsedSeconds(0);

    const scrollCallback = () => {
      if (!prompterContainerRef.current) return;
      const container = prompterContainerRef.current;
      const speed = settingsStore.teleprompter.scrollSpeed;
      const multiplier = settingsStore.teleprompter.scrollSpeedMultiplier;
      container.scrollTop += (speed / 20) * multiplier;
    };

    const checkEndCallback = (): boolean => {
      if (!prompterContainerRef.current) return false;
      const container = prompterContainerRef.current;
      const scrolledHeight = container.scrollTop + container.clientHeight;
      const scrollableHeight = container.scrollHeight;
      return scrolledHeight >= scrollableHeight - 5;
    };

    recorder.startRecording(scrollCallback, checkEndCallback);
  }, [camera.stream, recorder, settingsStore.teleprompter.scrollSpeed, settingsStore.teleprompter.scrollSpeedMultiplier]);

  const handleRecordStop = useCallback(() => {
    if (recorder.recordingState === 'recording' || recorder.recordingState === 'paused') {
      recorder.stopRecording();
    } else if (
      recorder.recordingState === 'idle' &&
      camera.stream &&
      !isDrawerVisible
    ) {
      handleRecordStart();
    }
    // Ignore countdown — don't start or stop while countdown is active
  }, [recorder, camera.stream, isDrawerVisible, handleRecordStart]);

  const handleCloseDrawer = useCallback(() => {
    setIsDrawerVisible(false);
    if (recorder.recordingState === 'completed') {
      recorder.resetRecording();
      clearMasterRecording();
      clearJobs();
      setExportConfig(null);
      setElapsedSeconds(0);
    }
  }, [recorder, clearMasterRecording, clearJobs, setExportConfig]);

  const handlePracticeAgain = useCallback(() => {
    setIsDrawerVisible(false);
    recorder.resetRecording();
    clearMasterRecording();
    clearJobs();
    setExportConfig(null);
    setElapsedSeconds(0);
  }, [recorder, clearMasterRecording, clearJobs, setExportConfig]);

  const handleNudgeUp = useCallback(() => {
    if (prompterContainerRef.current) {
      prompterContainerRef.current.scrollBy({
        top: -NUDGE_AMOUNT_KEYBOARD,
        behavior: 'smooth',
      });
    }
  }, []);

  const handleNudgeDown = useCallback(() => {
    if (prompterContainerRef.current) {
      prompterContainerRef.current.scrollBy({
        top: NUDGE_AMOUNT_KEYBOARD,
        behavior: 'smooth',
      });
    }
  }, []);

  const handleMicToggle = useCallback(() => {
    setIsMicMuted((prev) => {
      const nextMuted = !prev;
      if (camera.stream) {
        camera.stream.getAudioTracks().forEach((track) => {
          track.enabled = !nextMuted;
        });
      }
      return nextMuted;
    });
  }, [camera.stream]);

  const handlePanelChange = useCallback((panel: TabType | 'record' | 'share') => {
    if (panel === 'record') {
      handleRecordStop();
    } else {
      setActivePanel(panel);
    }
  }, [handleRecordStop]);

  const handleCameraInitialize = useCallback(async () => {
    const platformPreset = PLATFORM_PRESETS.find((p) => p.id === settingsStore.platformId) ?? PLATFORM_PRESETS[0];
    const constraints: MediaStreamConstraints = {
      video: settingsStore.selectedVideoDevice
        ? { deviceId: { exact: settingsStore.selectedVideoDevice }, width: { ideal: platformPreset.width }, height: { ideal: platformPreset.height } }
        : { width: { ideal: platformPreset.width }, height: { ideal: platformPreset.height }, facingMode: 'user' },
      audio: settingsStore.selectedAudioDevice
        ? { deviceId: { exact: settingsStore.selectedAudioDevice } }
        : true,
    };

    try {
      await camera.initialize(constraints);
    } catch {
      await camera.initialize();
    }
  }, [camera, settingsStore.selectedAudioDevice, settingsStore.selectedVideoDevice, settingsStore.platformId]);

  const handleVideoDeviceChange = useCallback(async (deviceId: string) => {
    settingsStore.setSelectedVideoDevice(deviceId);
    if (camera.isInitialized) {
      const constraints: MediaStreamConstraints = {
        video: { deviceId: { exact: deviceId } },
        audio: settingsStore.selectedAudioDevice
          ? { deviceId: { exact: settingsStore.selectedAudioDevice } }
          : true,
      };
      await camera.initialize(constraints);
    }
  }, [camera, settingsStore.selectedAudioDevice, settingsStore.setSelectedVideoDevice]);

  const handleAudioDeviceChange = useCallback(async (deviceId: string) => {
    settingsStore.setSelectedAudioDevice(deviceId);
    if (camera.isInitialized) {
      const constraints: MediaStreamConstraints = {
        video: settingsStore.selectedVideoDevice
          ? { deviceId: { exact: settingsStore.selectedVideoDevice } }
          : true,
        audio: { deviceId: { exact: deviceId } },
      };
      await camera.initialize(constraints);
    }
  }, [camera, settingsStore.selectedVideoDevice, settingsStore.setSelectedAudioDevice]);

  useEffect(() => {
    if (camera.isInitialized && recorder.recordingState === 'idle') {
      handleCameraInitialize();
    }
  }, [settingsStore.platformId, camera.isInitialized, recorder.recordingState, handleCameraInitialize]);

  const handleToggleInspector = useCallback(() => {
    setIsInspectorOpen((prev) => !prev);
  }, []);

  const handleShowShortcuts = useCallback(() => {
    showToast('Space: Record/Pause · Arrows: Nudge script · Esc: Close');
  }, [showToast]);

  const handleOpenTeleprompter = useCallback(() => {
    setActivePanel('studio');
    setIsInspectorOpen(true);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const dlCount = parseInt(localStorage.getItem('sxs-download-count') || '0', 10);
      setDownloadCount(dlCount);

      if (window.location.search) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, []);

  const handlePricingClick = useCallback(() => {
    setIsPricingModalOpen(true);
  }, []);

  useKeyboardShortcuts({
    onRecordStop: handleRecordStop,
    onNudgeUp: handleNudgeUp,
    onNudgeDown: handleNudgeDown,
    onCloseDrawer: handleCloseDrawer,
    isRecording: recorder.recordingState === 'recording',
    canRecord: !!camera.stream,
    isDrawerVisible,
    showNudgeToast: showToast,
  });

  useEffect(() => {
    if (recorder.recordingState === 'completed') {
      setIsDrawerVisible(true);
      
      if (recorder.recordingResult?.blob) {
        const videoTrack = camera.stream?.getVideoTracks()[0];
        const settings = videoTrack?.getSettings();
        createMasterRecording(
          recorder.recordingResult.blob,
          elapsedSeconds,
          recorder.recordingResult.hasAudio,
          settings?.width || recordingConfig.width,
          settings?.height || recordingConfig.height
        );
      }
      
      if (typeof window !== 'undefined') {
        localStorage.setItem('sxs-recording-count',
          (parseInt(localStorage.getItem('sxs-recording-count') || '0', 10) + 1).toString()
        );
      }
    }
  }, [recorder.recordingState, recorder.recordingResult, elapsedSeconds, createMasterRecording]);

  const isStudio = activePanel === 'studio';

  const inspectorProps = {
    settings: settingsStore.teleprompter,
    onSettingsChange: settingsStore.setTeleprompter,
    focusViewEnabled: focusView.isEnabled,
    onFocusViewToggle: focusView.toggle,
    mirrorCamera: settingsStore.isMirrored,
    onMirrorCameraToggle: () => settingsStore.setIsMirrored((prev) => !prev),
    countdownEnabled: settingsStore.countdownEnabled,
    onCountdownToggle: () => settingsStore.setCountdownEnabled((prev) => !prev),
    videoDevices: camera.videoDevices,
    audioDevices: camera.audioDevices,
    selectedVideoDevice: settingsStore.selectedVideoDevice,
    selectedAudioDevice: settingsStore.selectedAudioDevice,
    onVideoDeviceChange: handleVideoDeviceChange,
    onAudioDeviceChange: handleAudioDeviceChange,
    platformId: settingsStore.platformId,
    onPlatformChange: settingsStore.setPlatformId,
    customAspectRatio: settingsStore.customAspectRatio,
    onCustomAspectRatioChange: settingsStore.setCustomAspectRatio,
    customWidth: settingsStore.customWidth,
    onCustomWidthChange: settingsStore.setCustomWidth,
    customHeight: settingsStore.customHeight,
    onCustomHeightChange: settingsStore.setCustomHeight,
    aspectRatio: settingsStore.aspectRatio,
    script: scriptStorage.script,
    onScriptChange: scriptStorage.setScript,
    onClearScript: scriptStorage.clearScript,
    wordCount: scriptStorage.wordCount,
    progress: scriptStorage.progress,
    onLoadInspiration: scriptStorage.loadInspiration,
  };

  return (
    <>
      <WelcomeModal
        isVisible={welcomeModal.isVisible}
        dontShowAgain={welcomeModal.dontShowAgain}
        onDontShowChange={welcomeModal.setDontShowAgain}
        onGetStarted={welcomeModal.closeModal}
        onExploreStudio={welcomeModal.closeModal}
      />

      <div className="h-screen flex flex-col bg-canvas overflow-hidden">
        <Header
          recordingState={recorder.recordingState}
          isMobile={isMobile}
          hasRecording={recorder.recordingState === 'completed'}
          onExport={() => setIsDrawerVisible(true)}
          onShare={share}
          onToggleInspector={handleToggleInspector}
          onSignIn={handleAuthRequired}
        />

        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* IconRail - hidden on mobile/tablet via CSS (hidden lg:flex) */}
          <IconRail
            activePanel={activePanel}
            onPanelChange={handlePanelChange}
            isCameraInitialized={camera.isInitialized}
            onCameraInitialize={handleCameraInitialize}
            isMicMuted={isMicMuted}
            onMicToggle={handleMicToggle}
            focusViewEnabled={focusView.isEnabled}
            onFocusViewToggle={focusView.toggle}
            onPreferencesToggle={handleToggleInspector}
            onOpenTeleprompter={handleOpenTeleprompter}
            onShowShortcuts={handleShowShortcuts}
            onPricingClick={handlePricingClick}
          />

          <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden" role="main">
            {/* Studio view — CSS visibility prevents unmount/remount of CameraPreview stream */}
            <div className={`flex-1 min-h-0 flex flex-col overflow-hidden ${isStudio ? '' : 'hidden'}`}>
              <DeviceSelectorBar
                videoDevices={camera.videoDevices}
                audioDevices={camera.audioDevices}
                selectedVideoDevice={settingsStore.selectedVideoDevice}
                selectedAudioDevice={settingsStore.selectedAudioDevice}
                onVideoDeviceChange={handleVideoDeviceChange}
                onAudioDeviceChange={handleAudioDeviceChange}
                onRefresh={camera.refreshDevices}
              />

              <Canvas
                focusViewEnabled={focusView.isEnabled}
                onFocusViewToggle={focusView.toggle}
                aspectRatio={settingsStore.aspectRatio}
                recordingConfig={recordingConfig}
                onCanvasReady={(canvas) => { recordingCanvasRef.current = canvas; }}
              >
                <CameraPreview
                  stream={camera.stream}
                  isMirrored={settingsStore.isMirrored}
                  focusViewEnabled={focusView.isEnabled}
                />

                <TeleprompterOverlay
                  ref={prompterContainerRef}
                  script={scriptStorage.script}
                  settings={settingsStore.teleprompter}
                />

                <FocalGuideway position={settingsStore.teleprompter.textStartPosition} />

                <RecordingBadge recordingState={recorder.recordingState} />

                <Timer
                  isRunning={recorder.recordingState === 'recording'}
                  elapsedSeconds={elapsedSeconds}
                />

                <CountdownOverlay
                  countdownText={recorder.countdownText}
                  isVisible={recorder.recordingState === 'countdown' && settingsStore.countdownEnabled}
                />

                {!camera.isInitialized && (
                  <InitOverlay
                    onInitialize={handleCameraInitialize}
                    status={camera.status === 'ready' ? 'idle' : camera.status}
                    errorMessage={camera.errorMessage}
                  />
                )}
              </Canvas>
            </div>

            {activePanel === 'library' && (
              <div className="flex-1 min-h-0 overflow-auto">
                <LibraryPanel
                  scripts={library.scripts}
                  isLoaded={library.isLoaded}
                  onCreateScript={library.createScript}
                  onUpdateScript={library.updateScript}
                  onDeleteScript={library.deleteScript}
                  onSearchScripts={library.searchScripts}
                  onLoadScript={scriptStorage.setScript}
                  currentContent={scriptStorage.script}
                />
              </div>
            )}

            {activePanel === 'insights' && (
              <div className="flex-1 min-h-0 overflow-auto">
                <InsightsPlaceholder />
              </div>
            )}

            <TransportBar
              recordingState={recorder.recordingState}
              canRecord={!!camera.stream}
              hasRecording={recorder.recordingState === 'completed'}
              isMicMuted={isMicMuted}
              elapsedSeconds={elapsedSeconds}
              onMicToggle={handleMicToggle}
              onStart={handleRecordStart}
              onPause={recorder.pauseRecording}
              onResume={() =>
                recorder.resumeRecording(
                  () => {
                    if (!prompterContainerRef.current) return;
                    const container = prompterContainerRef.current;
                    const speed = settingsStore.teleprompter.scrollSpeed;
                    const multiplier = settingsStore.teleprompter.scrollSpeedMultiplier;
                    container.scrollTop += (speed / 20) * multiplier;
                  },
                  () => {
                    if (!prompterContainerRef.current) return false;
                    const container = prompterContainerRef.current;
                    return (
                      container.scrollTop + container.clientHeight >=
                      container.scrollHeight - 5
                    );
                  }
                )
              }
              onStop={recorder.stopRecording}
            />
          </main>

          {/* InspectorPanel - CSS visibility prevents unmount/remount on tab switch */}
          <div className={isStudio ? '' : 'hidden'}>
            <InspectorPanel
              {...inspectorProps}
              isMobile={isMobile}
              isOpen={isInspectorOpen}
              onClose={handleToggleInspector}
            />
          </div>
        </div>

        {/* BottomNav - hidden on tablet/desktop via CSS (flex md:hidden) */}
        <BottomNav
          activePanel={activePanel}
          onPanelChange={handlePanelChange}
          recordingState={recorder.recordingState}
          onRecordToggle={handleRecordStop}
          onSettingsToggle={handleToggleInspector}
          onPricingClick={handlePricingClick}
          isCameraInitialized={camera.isInitialized}
          onCameraInitialize={handleCameraInitialize}
        />

        {/* Footer - hidden on mobile/tablet via CSS (hidden md:flex) */}
        <Footer />
      </div>

      <ExportModal
        isVisible={isDrawerVisible}
        masterRecording={masterRecordingData}
        onClose={handleCloseDrawer}
        onPracticeAgain={handlePracticeAgain}
        onShare={share}
        showToast={showToast}
        isAuthenticated={!!session?.user}
        userPlan={session?.user?.plan || 'free'}
        onAuthRequired={handleAuthRequired}
        downloadCount={downloadCount}
        downloadLimit={FREE_VIDEO_DOWNLOAD_LIMIT}
        onDownloadLimitReached={() => setIsPricingModalOpen(true)}
        exportConfig={exportConfig}
        exportJobs={exportJobs}
        onSelectPlatform={selectPlatform}
        onUpdateCrop={updateCrop}
        onResetCrop={resetCrop}
        onStartExport={startExport}
        onStartBatchExport={startBatchExport}
        onCancelExport={() => cancelExport(exportJobs[exportJobs.length - 1]?.id || '')}
      />

      <PricingModal
        isOpen={isPricingModalOpen}
        onClose={() => setIsPricingModalOpen(false)}
        showToast={showToast}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
        mode="download"
      />

      <Toast message={toast?.message ?? null} />
    </>
  );
}
