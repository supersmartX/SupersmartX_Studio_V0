'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { NUDGE_AMOUNT_KEYBOARD } from '@/constants';

import { useWelcomeModal } from '@/hooks/useWelcomeModal';
import { useCamera } from '@/hooks/useCamera';
import { useRecorder } from '@/hooks/useRecorder';
import { useScriptStorage } from '@/hooks/useScriptStorage';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useFocusView } from '@/hooks/useFocusView';
import { useToast } from '@/hooks/useToast';
import { useShare } from '@/hooks/useShare';
import { useMasterRecording } from '@/hooks/useMasterRecording';
import { useExportPipeline } from '@/hooks/useExportPipeline';
import { useMediaQuery } from '@/hooks/useMediaQuery';

import { useStudioConfig } from '@/hooks/useStudioConfig';
import { useStudioCamera } from '@/hooks/useStudioCamera';
import { useRecordingTimer } from '@/hooks/useRecordingTimer';
import { useStudioUI } from '@/hooks/useStudioUI';
import { getEntitlements } from '@/lib/entitlements';

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
import { RecordingsPanel } from '@/components/studio/LibraryPanel';
import { InsightsPlaceholder } from '@/features/insights/InsightsPlaceholder';
import { Toast } from '@/components/common/Toast';
import type { TabType } from '@/types';

export default function HomePage() {
  // Base hooks (called first, no ordering dependency)
  const welcomeModal = useWelcomeModal();
  const { toast, showToast, queueLength } = useToast();
  const { share } = useShare(showToast);
  const focusView = useFocusView();
  const scriptStorage = useScriptStorage();
  const { data: session } = useSession();

  // Core infrastructure hooks
  const { settings, recordingConfig } = useStudioConfig();
  const camera = useCamera();
  const recorder = useRecorder(camera.stream, recordingConfig);

  // Camera management hook (needs settings + recorder state)
  const { handleCameraInitialize, handleVideoDeviceChange, handleAudioDeviceChange } = useStudioCamera({
    recordingState: recorder.recordingState,
    settings,
    camera,
  });

  const ui = useStudioUI();
  const { masterRecording: masterRecordingData, createMasterRecording, clearMasterRecording, restoreMasterRecording } = useMasterRecording();

  const handlePricingClick = useCallback(() => {
    if (!session?.user) {
      ui.setIsAuthModalOpen(true);
    } else {
      ui.setIsPricingModalOpen(true);
    }
  }, [session, ui]);

  const handleUpgradeClick = useCallback(() => {
    if (!session?.user) {
      ui.setIsAuthModalOpen(true);
    } else {
      ui.setIsPricingModalOpen(true);
    }
  }, [session, ui]);
  const entitlements = getEntitlements((session?.user?.plan as 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly') || 'free');
  const { elapsedSeconds, resetTimer } = useRecordingTimer({
    recordingState: recorder.recordingState,
    stopRecording: recorder.stopRecording,
    showToast,
    maxDurationSeconds: entitlements.maxDurationSeconds,
    resetOnComplete: false,
  });

  // Local UI state
  const isMobile = useMediaQuery('(max-width: 640px)');
  const [activePanel, setActivePanel] = useState<TabType | 'record' | 'share'>('studio');
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const prompterContainerRef = useRef<HTMLDivElement>(null);

  const {
    exportConfig,
    exportJobs,
    setExportConfig,
    selectPlatform,
    updateCrop,
    startExport,
    startBatchExport,
    cancelExport,
    clearJobs,
  } = useExportPipeline();

  // Restore master recording from IndexedDB on mount
  useEffect(() => {
    if (!masterRecordingData) {
      restoreMasterRecording();
    }
  }, [masterRecordingData, restoreMasterRecording]);

  // Handle recording completion → create master recording
  useEffect(() => {
    if (recorder.recordingState === 'completed') {
      ui.setIsDrawerVisible(true);

      if (recorder.recordingResult?.blob) {
        // Extract actual video dimensions from the recorded blob
        // Camera track settings can differ from actual MediaRecorder output
        const videoEl = document.createElement('video');
        const blobUrl = URL.createObjectURL(recorder.recordingResult.blob);
        videoEl.src = blobUrl;
        videoEl.preload = 'metadata';

        videoEl.onloadedmetadata = () => {
          URL.revokeObjectURL(blobUrl);
          const actualWidth = videoEl.videoWidth || recordingConfig.width;
          const actualHeight = videoEl.videoHeight || recordingConfig.height;
          createMasterRecording(
            recorder.recordingResult!.blob,
            recorder.recordingResult!.duration,
            recorder.recordingResult!.hasAudio,
            actualWidth,
            actualHeight
          );
        };

        videoEl.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          // Fallback to config dimensions
          createMasterRecording(
            recorder.recordingResult!.blob,
            recorder.recordingResult!.duration,
            recorder.recordingResult!.hasAudio,
            recordingConfig.width,
            recordingConfig.height
          );
        };
      }

      resetTimer();
    }
  }, [recorder.recordingState, recorder.recordingResult, createMasterRecording, recordingConfig.width, recordingConfig.height]);

  const handleRecordStart = useCallback(() => {
    if (!camera.stream) return;

    if (prompterContainerRef.current) {
      prompterContainerRef.current.scrollTop = 0;
    }

    resetTimer();

    const scrollCallback = () => {
      if (!prompterContainerRef.current) return;
      const container = prompterContainerRef.current;
      const speed = settings.teleprompter.scrollSpeed;
      const multiplier = settings.teleprompter.scrollSpeedMultiplier;
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
  }, [camera.stream, recorder, settings.teleprompter.scrollSpeed, settings.teleprompter.scrollSpeedMultiplier, resetTimer]);

  const handleRecordStop = useCallback(() => {
    if (recorder.recordingState === 'recording' || recorder.recordingState === 'paused') {
      recorder.stopRecording();
    } else if (
      recorder.recordingState === 'idle' &&
      camera.stream &&
      !ui.isDrawerVisible
    ) {
      handleRecordStart();
    }
  }, [recorder, camera.stream, ui.isDrawerVisible, handleRecordStart]);

  const handleCloseDrawer = useCallback(() => {
    if (recorder.recordingState === 'completed' && masterRecordingData) {
      if (!window.confirm('Discard this recording? This cannot be undone.')) {
        return;
      }
    }
    ui.setIsDrawerVisible(false);
    if (recorder.recordingState === 'completed') {
      recorder.resetRecording();
      clearMasterRecording();
      clearJobs();
      setExportConfig(null);
    }
  }, [ui, recorder, clearMasterRecording, clearJobs, setExportConfig, masterRecordingData]);

  const handlePracticeAgain = useCallback(() => {
    ui.setIsDrawerVisible(false);
    recorder.resetRecording();
    clearMasterRecording();
    clearJobs();
    setExportConfig(null);
  }, [ui, recorder, clearMasterRecording, clearJobs, setExportConfig]);

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

  const handleToggleInspector = useCallback(() => {
    setIsInspectorOpen((prev) => !prev);
  }, []);

  const handleShowShortcuts = useCallback(() => {
    showToast('Space: Start/Stop · P: Pause/Resume · M: Mute · ↑↓: Nudge script · Esc: Close');
  }, [showToast]);

  const handleOpenTeleprompter = useCallback(() => {
    setActivePanel('studio');
    setIsInspectorOpen(true);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (window.location.search) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, []);

  useKeyboardShortcuts({
    onRecordStop: handleRecordStop,
    onRecordPause: recorder.pauseRecording,
    onRecordResume: () =>
      recorder.resumeRecording(
        () => {
          if (!prompterContainerRef.current) return;
          const container = prompterContainerRef.current;
          const speed = settings.teleprompter.scrollSpeed;
          const multiplier = settings.teleprompter.scrollSpeedMultiplier;
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
      ),
    onMicToggle: handleMicToggle,
    onNudgeUp: handleNudgeUp,
    onNudgeDown: handleNudgeDown,
    onCloseDrawer: handleCloseDrawer,
    isRecording: recorder.recordingState === 'recording',
    isPaused: recorder.recordingState === 'paused',
    canRecord: !!camera.stream,
    isDrawerVisible: ui.isDrawerVisible,
    showNudgeToast: showToast,
  });

  const isStudio = activePanel === 'studio';

  const inspectorProps = {
    settings: settings.teleprompter,
    onSettingsChange: settings.setTeleprompter,
    focusViewEnabled: focusView.isEnabled,
    onFocusViewToggle: focusView.toggle,
    mirrorCamera: settings.isMirrored,
    onMirrorCameraToggle: () => settings.setIsMirrored((prev) => !prev),
    countdownEnabled: settings.countdownEnabled,
    onCountdownToggle: () => settings.setCountdownEnabled((prev) => !prev),
    videoDevices: camera.videoDevices,
    audioDevices: camera.audioDevices,
    selectedVideoDevice: settings.selectedVideoDevice,
    selectedAudioDevice: settings.selectedAudioDevice,
    onVideoDeviceChange: handleVideoDeviceChange,
    onAudioDeviceChange: handleAudioDeviceChange,
    platformId: settings.platformId,
    onPlatformChange: settings.setPlatformId,
    customAspectRatio: settings.customAspectRatio,
    onCustomAspectRatioChange: settings.setCustomAspectRatio,
    customWidth: settings.customWidth,
    onCustomWidthChange: settings.setCustomWidth,
    customHeight: settings.customHeight,
    onCustomHeightChange: settings.setCustomHeight,
    aspectRatio: settings.aspectRatio,
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
        onGetStarted={() => {
          welcomeModal.closeModal();
          if (!camera.isInitialized) handleCameraInitialize();
        }}
        onExploreStudio={welcomeModal.closeModal}
      />

      <div className="h-screen flex flex-col bg-canvas overflow-hidden">
        <Header
          isMobile={isMobile}
          hasRecording={recorder.recordingState === 'completed' && !!masterRecordingData}
          onExport={() => ui.setIsDrawerVisible(true)}
          onShare={share}
          onToggleInspector={handleToggleInspector}
          onSignIn={ui.handleAuthRequired}
        />

        <div className="flex-1 min-h-0 flex overflow-hidden">
          <IconRail
            activePanel={activePanel}
            onPanelChange={handlePanelChange}
            isCameraInitialized={camera.isInitialized}
            isCameraRequesting={camera.status === 'requesting'}
            onCameraInitialize={handleCameraInitialize}
            isMicMuted={isMicMuted}
            onMicToggle={handleMicToggle}
            focusViewEnabled={focusView.isEnabled}
            onFocusViewToggle={focusView.toggle}
            onPreferencesToggle={handleToggleInspector}
            onOpenTeleprompter={handleOpenTeleprompter}
            onShowShortcuts={handleShowShortcuts}
            onPricingClick={handlePricingClick}
            userPlan={session?.user?.plan || 'free'}
          />

          <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden" role="main">
            <div className={`flex-1 min-h-0 flex flex-col overflow-hidden ${isStudio ? '' : 'hidden'}`}>
              <DeviceSelectorBar
                videoDevices={camera.videoDevices}
                audioDevices={camera.audioDevices}
                selectedVideoDevice={settings.selectedVideoDevice}
                selectedAudioDevice={settings.selectedAudioDevice}
                onVideoDeviceChange={handleVideoDeviceChange}
                onAudioDeviceChange={handleAudioDeviceChange}
                onRefresh={camera.refreshDevices}
              />

              <Canvas
                focusViewEnabled={focusView.isEnabled}
                onFocusViewToggle={focusView.toggle}
                aspectRatio={settings.aspectRatio}
                recordingConfig={recordingConfig}
              >
                <CameraPreview
                  stream={camera.stream}
                  isMirrored={settings.isMirrored}
                  focusViewEnabled={focusView.isEnabled}
                />

                <TeleprompterOverlay
                  ref={prompterContainerRef}
                  script={scriptStorage.script}
                  settings={settings.teleprompter}
                />

                <FocalGuideway position={settings.teleprompter.textStartPosition} />

                <RecordingBadge recordingState={recorder.recordingState} />

                <Timer
                  isRunning={recorder.recordingState === 'recording'}
                  elapsedSeconds={elapsedSeconds}
                />

                <CountdownOverlay
                  countdownText={recorder.countdownText}
                  isVisible={recorder.recordingState === 'countdown' && settings.countdownEnabled}
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
                <RecordingsPanel
                  isMobile={isMobile}
                  onExportRecording={(recording) => {
                    createMasterRecording(
                      recording.blob,
                      recording.duration,
                      recording.hasAudio,
                      recording.width,
                      recording.height
                    );
                    ui.setIsDrawerVisible(true);
                  }}
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
                    const speed = settings.teleprompter.scrollSpeed;
                    const multiplier = settings.teleprompter.scrollSpeedMultiplier;
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

          <div className={isStudio ? '' : 'hidden'}>
            <InspectorPanel
              {...inspectorProps}
              isMobile={isMobile}
              isOpen={isInspectorOpen}
              onClose={handleToggleInspector}
            />
          </div>
        </div>

        <BottomNav
          activePanel={activePanel}
          onPanelChange={handlePanelChange}
          recordingState={recorder.recordingState}
          onRecordToggle={handleRecordStop}
          onPause={recorder.pauseRecording}
          onResume={() =>
            recorder.resumeRecording(
              () => {
                if (!prompterContainerRef.current) return;
                const container = prompterContainerRef.current;
                const speed = settings.teleprompter.scrollSpeed;
                const multiplier = settings.teleprompter.scrollSpeedMultiplier;
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
          onSettingsToggle={handleToggleInspector}
          onPricingClick={handlePricingClick}
          isCameraInitialized={camera.isInitialized}
          isCameraRequesting={camera.status === 'requesting'}
          onCameraInitialize={handleCameraInitialize}
          userPlan={session?.user?.plan || 'free'}
        />

        <Footer />
      </div>

      <ExportModal
        isVisible={ui.isDrawerVisible}
        masterRecording={masterRecordingData}
        onClose={handleCloseDrawer}
        onPracticeAgain={handlePracticeAgain}
        onShare={share}
        showToast={showToast}
        isAuthenticated={!!session?.user}
        userPlan={session?.user?.plan || 'free'}
        onAuthRequired={ui.handleAuthRequired}
        onDownloadLimitReached={handleUpgradeClick}
        exportConfig={exportConfig}
        onSelectPlatform={selectPlatform}
        onUpdateCrop={updateCrop}
        onStartExport={startExport}
        onStartBatchExport={startBatchExport}
        onCancelExport={() => cancelExport(exportJobs[exportJobs.length - 1]?.id || '')}
      />

      <PricingModal
        isOpen={ui.isPricingModalOpen}
        onClose={() => ui.setIsPricingModalOpen(false)}
        showToast={showToast}
        userPlan={session?.user?.plan || 'free'}
        isAuthenticated={!!session?.user}
      />

      <AuthModal
        isOpen={ui.isAuthModalOpen}
        onClose={() => ui.setIsAuthModalOpen(false)}
        onSuccess={ui.handleAuthSuccess}
        mode="download"
      />

      <Toast message={toast?.message ?? null} queueLength={queueLength} />
    </>
  );
}
