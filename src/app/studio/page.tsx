'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { DEFAULT_SETTINGS, NUDGE_AMOUNT_KEYBOARD } from '@/constants';

import { useWelcomeModal } from '@/hooks/useWelcomeModal';
import { useCamera } from '@/hooks/useCamera';
import { useRecorder } from '@/hooks/useRecorder';
import { useScriptStorage } from '@/hooks/useScriptStorage';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useFocusView } from '@/hooks/useFocusView';
import { useToast } from '@/hooks/useToast';
import { useShare } from '@/hooks/useShare';

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
import { SupportModal } from '@/components/dialogs/SupportModal';
import { AuthModal } from '@/components/auth/AuthModal';
import { executePendingDownload } from '@/lib/auth-guard';
import { LibraryPlaceholder } from '@/features/library/LibraryPlaceholder';
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

  const isMobile = useMediaQuery('(max-width: 768px)');

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [activePanel, setActivePanel] = useState<TabType | 'record' | 'share'>('studio');
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isMirrored, setIsMirrored] = useState(true);
  const [countdownEnabled, setCountdownEnabled] = useState(true);
  const [selectedVideoDevice, setSelectedVideoDevice] = useState('');
  const [selectedAudioDevice, setSelectedAudioDevice] = useState('');
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [isTeleprompterVisible] = useState(true);
  const prompterContainerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const handleAuthRequired = useCallback(() => {
    setIsAuthModalOpen(true);
  }, []);

  const handleAuthSuccess = useCallback(() => {
    executePendingDownload();
  }, []);

  const recorder = useRecorder(camera.stream);

  useEffect(() => {
    if (camera.videoDevices.length > 0 && !selectedVideoDevice) {
      setSelectedVideoDevice(camera.videoDevices[0].deviceId);
    }
    if (camera.audioDevices.length > 0 && !selectedAudioDevice) {
      setSelectedAudioDevice(camera.audioDevices[0].deviceId);
    }
  }, [camera.videoDevices, camera.audioDevices, selectedVideoDevice, selectedAudioDevice]);

  useEffect(() => {
    if (recorder.recordingState === 'recording') {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [recorder.recordingState]);

  const handleRecordStart = useCallback(() => {
    if (!camera.stream) return;

    if (prompterContainerRef.current) {
      prompterContainerRef.current.scrollTop = 0;
    }

    setElapsedSeconds(0);

    const scrollCallback = () => {
      if (!prompterContainerRef.current) return;
      const container = prompterContainerRef.current;
      const speed = settings.scrollSpeed;
      const multiplier = settings.scrollSpeedMultiplier;
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
  }, [camera.stream, recorder, settings.scrollSpeed, settings.scrollSpeedMultiplier]);

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
  }, [recorder, camera.stream, isDrawerVisible, handleRecordStart]);

  const handleCloseDrawer = useCallback(() => {
    setIsDrawerVisible(false);
  }, []);

  const handlePracticeAgain = useCallback(() => {
    setIsDrawerVisible(false);
    recorder.resetRecording();
    setElapsedSeconds(0);
  }, [recorder]);

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
    const constraints: MediaStreamConstraints = {
      video: selectedVideoDevice
        ? { deviceId: { exact: selectedVideoDevice } }
        : { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user' },
      audio: selectedAudioDevice
        ? { deviceId: { exact: selectedAudioDevice } }
        : true,
    };

    await camera.initialize(constraints);
  }, [camera, selectedAudioDevice, selectedVideoDevice]);

  const handleVideoDeviceChange = useCallback(async (deviceId: string) => {
    setSelectedVideoDevice(deviceId);
    if (camera.isInitialized) {
      const constraints: MediaStreamConstraints = {
        video: { deviceId: { exact: deviceId } },
        audio: selectedAudioDevice
          ? { deviceId: { exact: selectedAudioDevice } }
          : true,
      };
      await camera.initialize(constraints);
    }
  }, [camera, selectedAudioDevice]);

  const handleAudioDeviceChange = useCallback(async (deviceId: string) => {
    setSelectedAudioDevice(deviceId);
    if (camera.isInitialized) {
      const constraints: MediaStreamConstraints = {
        video: selectedVideoDevice
          ? { deviceId: { exact: selectedVideoDevice } }
          : true,
        audio: { deviceId: { exact: deviceId } },
      };
      await camera.initialize(constraints);
    }
  }, [camera, selectedVideoDevice]);

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

  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const support = new URLSearchParams(window.location.search).get('support');
    if (support === '1') {
      setIsSupportModalOpen(true);
    }
  }, []);

  const handleSupportClick = useCallback(() => {
    setIsSupportModalOpen(true);
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
    }
  }, [recorder.recordingState]);

  const isStudio = activePanel === 'studio';

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
          onToggleInspector={isMobile ? handleToggleInspector : undefined}
          onSignIn={handleAuthRequired}
        />

        <div className="flex-1 min-h-0 flex overflow-hidden">
          {!isMobile && (
            <IconRail
              activePanel={activePanel}
              onPanelChange={handlePanelChange}
              recordingState={recorder.recordingState}
              onRecordToggle={handleRecordStop}
              isCameraInitialized={camera.isInitialized}
              onCameraInitialize={handleCameraInitialize}
              isMicMuted={isMicMuted}
              onMicToggle={handleMicToggle}
              focusViewEnabled={focusView.isEnabled}
              onFocusViewToggle={focusView.toggle}
              onPreferencesToggle={handleToggleInspector}
              onOpenTeleprompter={handleOpenTeleprompter}
              onShowShortcuts={handleShowShortcuts}
              onSupportClick={handleSupportClick}
            />
          )}

          <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden" role="main">
            {isStudio && (
              <>
                <DeviceSelectorBar
                  videoDevices={camera.videoDevices}
                  audioDevices={camera.audioDevices}
                  selectedVideoDevice={selectedVideoDevice}
                  selectedAudioDevice={selectedAudioDevice}
                  onVideoDeviceChange={handleVideoDeviceChange}
                  onAudioDeviceChange={handleAudioDeviceChange}
                  onRefresh={camera.refreshDevices}
                />

                <Canvas
                  focusViewEnabled={focusView.isEnabled}
                  onFocusViewToggle={focusView.toggle}
                >
                  <CameraPreview
                    stream={camera.stream}
                    isMirrored={isMirrored}
                    focusViewEnabled={focusView.isEnabled}
                  />

                  {isTeleprompterVisible && (
                    <TeleprompterOverlay
                      ref={prompterContainerRef}
                      script={scriptStorage.script}
                      settings={settings}
                      containerMaxWidth={isMobile ? 375 : undefined}
                    />
                  )}

                  <FocalGuideway position={settings.textStartPosition} />

                  <RecordingBadge recordingState={recorder.recordingState} />

                  <Timer
                    isRunning={recorder.recordingState === 'recording'}
                    elapsedSeconds={elapsedSeconds}
                  />

                  <CountdownOverlay
                    countdownText={recorder.countdownText}
                    isVisible={recorder.recordingState === 'countdown' && countdownEnabled}
                  />

                  {!camera.isInitialized && (
                    <InitOverlay
                      onInitialize={handleCameraInitialize}
                      status={camera.status === 'ready' ? 'idle' : camera.status}
                      errorMessage={camera.errorMessage}
                      permissionState={camera.permissionState}
                    />
                  )}
                </Canvas>
              </>
            )}

            {activePanel === 'library' && (
              <div className="flex-1 min-h-0 overflow-auto">
                <LibraryPlaceholder />
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
                    const speed = settings.scrollSpeed;
                    const multiplier = settings.scrollSpeedMultiplier;
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

          {!isMobile && isStudio && isInspectorOpen && (
            <InspectorPanel
              settings={settings}
              onSettingsChange={setSettings}
              focusViewEnabled={focusView.isEnabled}
              onFocusViewToggle={focusView.toggle}
              mirrorCamera={isMirrored}
              onMirrorCameraToggle={() => setIsMirrored((prev) => !prev)}
              countdownEnabled={countdownEnabled}
              onCountdownToggle={() => setCountdownEnabled((prev) => !prev)}
              videoDevices={camera.videoDevices}
              audioDevices={camera.audioDevices}
              selectedVideoDevice={selectedVideoDevice}
              selectedAudioDevice={selectedAudioDevice}
              onVideoDeviceChange={handleVideoDeviceChange}
              onAudioDeviceChange={handleAudioDeviceChange}
              script={scriptStorage.script}
              onScriptChange={scriptStorage.setScript}
              onClearScript={scriptStorage.clearScript}
              wordCount={scriptStorage.wordCount}
              progress={scriptStorage.progress}
              onLoadInspiration={scriptStorage.loadInspiration}
              onClose={handleToggleInspector}
            />
          )}
        </div>

        {isMobile && (
          <BottomNav
            activePanel={activePanel}
            onPanelChange={handlePanelChange}
            recordingState={recorder.recordingState}
            onRecordToggle={handleRecordStop}
            onSettingsToggle={handleToggleInspector}
            isCameraInitialized={camera.isInitialized}
            onCameraInitialize={handleCameraInitialize}
          />
        )}

        {!isMobile && <Footer />}

        {isMobile && isStudio && (
          <InspectorPanel
            settings={settings}
            onSettingsChange={setSettings}
            focusViewEnabled={focusView.isEnabled}
            onFocusViewToggle={focusView.toggle}
            mirrorCamera={isMirrored}
            onMirrorCameraToggle={() => setIsMirrored((prev) => !prev)}
            countdownEnabled={countdownEnabled}
            onCountdownToggle={() => setCountdownEnabled((prev) => !prev)}
            videoDevices={camera.videoDevices}
            audioDevices={camera.audioDevices}
            selectedVideoDevice={selectedVideoDevice}
            selectedAudioDevice={selectedAudioDevice}
            onVideoDeviceChange={handleVideoDeviceChange}
            onAudioDeviceChange={handleAudioDeviceChange}
            script={scriptStorage.script}
            onScriptChange={scriptStorage.setScript}
            onClearScript={scriptStorage.clearScript}
            wordCount={scriptStorage.wordCount}
            progress={scriptStorage.progress}
            onLoadInspiration={scriptStorage.loadInspiration}
            isMobile={isMobile}
            isOpen={isInspectorOpen}
            onClose={handleToggleInspector}
          />
        )}
      </div>

      <ExportModal
        isVisible={isDrawerVisible}
        videoUrl={recorder.videoUrl}
        audioUrl={recorder.audioUrl}
        recordingResult={recorder.recordingResult}
        onClose={handleCloseDrawer}
        onPracticeAgain={handlePracticeAgain}
        onShare={share}
        showToast={showToast}
        isAuthenticated={!!session?.user}
        onAuthRequired={handleAuthRequired}
      />

      <SupportModal
        isOpen={isSupportModalOpen}
        onClose={() => setIsSupportModalOpen(false)}
        showToast={showToast}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />

      <Toast message={toast?.message ?? null} />
    </>
  );
}
