'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { RecordingState } from '@/types';

interface RecordingResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  duration: number;
  hasAudio: boolean;
}

function getSupportedMimeType(): { mimeType: string; extension: string } {
  const types = [
    { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=h264', extension: 'mp4' },
  ];

  for (const type of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type.mimeType)) {
      return type;
    }
  }

  return { mimeType: 'video/webm', extension: 'webm' };
}

export function useRecorder(stream: MediaStream | null) {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [videoUrl, setVideoUrl] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [countdownText, setCountdownText] = useState('');
  const [recordingResult, setRecordingResult] = useState<RecordingResult | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const scrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkEndRef = useRef<(() => boolean) | null>(null);
  const startTimeRef = useRef<number>(0);
  const selectedMimeRef = useRef<{ mimeType: string; extension: string }>({ mimeType: 'video/webm', extension: 'webm' });
  const videoUrlRef = useRef('');
  const audioUrlRef = useRef('');

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording' || mediaRecorderRef.current?.state === 'paused') {
        mediaRecorderRef.current.stop();
      }
      if (audioRecorderRef.current?.state === 'recording') {
        audioRecorderRef.current.stop();
      }
      if (scrollIntervalRef.current) clearInterval(scrollIntervalRef.current);
      if (countIntervalRef.current) clearInterval(countIntervalRef.current);
      if (endCheckIntervalRef.current) clearInterval(endCheckIntervalRef.current);
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  const revokeUrls = useCallback(() => {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    videoUrlRef.current = '';
    setVideoUrl('');
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = '';
    setAudioUrl('');
  }, []);

  const clearCountdownInterval = useCallback(() => {
    if (countIntervalRef.current) {
      clearInterval(countIntervalRef.current);
      countIntervalRef.current = null;
    }
  }, []);

  const clearRecordingIntervals = useCallback(() => {
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
    if (endCheckIntervalRef.current) {
      clearInterval(endCheckIntervalRef.current);
      endCheckIntervalRef.current = null;
    }
  }, []);

  const stopAudioRecorder = useCallback(() => {
    if (audioRecorderRef.current?.state === 'recording') {
      audioRecorderRef.current.stop();
    }
    audioRecorderRef.current = null;
  }, []);

  const startRecording = useCallback(
    (scrollCallback: () => void, checkEndCallback: () => boolean) => {
      if (!stream) return;

      clearCountdownInterval();
      clearRecordingIntervals();
      stopAudioRecorder();
      revokeUrls();

      setRecordingState('countdown');
      setRecordingResult(null);
      let count = 3;

      countIntervalRef.current = setInterval(() => {
        setCountdownText(String(count));
        count--;
        if (count < 0) {
          clearCountdownInterval();
          setCountdownText('');

          try {
            const supported = getSupportedMimeType();
            selectedMimeRef.current = supported;

            const recorder = new MediaRecorder(stream, {
              mimeType: supported.mimeType,
            });

            chunksRef.current = [];
            startTimeRef.current = Date.now();

            recorder.ondataavailable = (e) => {
              if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            recorder.onerror = () => {
              clearRecordingIntervals();
              clearCountdownInterval();
              setRecordingState('idle');
              setCountdownText('');
            };

            recorder.onstop = () => {
              const duration = (Date.now() - startTimeRef.current) / 1000;
              const hasAudio = stream.getAudioTracks().length > 0;
              const blob = new Blob(chunksRef.current, { type: supported.mimeType });

              const result: RecordingResult = {
                blob,
                mimeType: supported.mimeType,
                extension: supported.extension,
                duration,
                hasAudio,
              };

              setRecordingResult(result);
              const newVideoUrl = URL.createObjectURL(blob);
              videoUrlRef.current = newVideoUrl;
              setVideoUrl(newVideoUrl);

              if (hasAudio) {
                const audioOnlyChunks: Blob[] = [];
                const audioTracks = stream.getAudioTracks().map(track => track.clone());
                const audioStream = new MediaStream(audioTracks);
                const audioMimeType = 'audio/webm;codecs=opus';
                const audioRecorder = new MediaRecorder(audioStream, {
                  mimeType: audioMimeType,
                });

                audioRecorderRef.current = audioRecorder;

                audioRecorder.ondataavailable = (e) => {
                  if (e.data.size > 0) audioOnlyChunks.push(e.data);
                };

                audioRecorder.onstop = () => {
                  if (audioOnlyChunks.length > 0) {
                    const audioBlob = new Blob(audioOnlyChunks, {
                      type: audioMimeType,
                    });
                    const newAudioUrl = URL.createObjectURL(audioBlob);
                    audioUrlRef.current = newAudioUrl;
                    setAudioUrl(newAudioUrl);
                  }
                  audioRecorderRef.current = null;
                };

                audioRecorder.start();
              }

              setRecordingState('completed');
            };

            recorder.start(100);
            mediaRecorderRef.current = recorder;
            setRecordingState('recording');

            scrollIntervalRef.current = setInterval(scrollCallback, 50);
            checkEndRef.current = checkEndCallback;

            endCheckIntervalRef.current = setInterval(() => {
              if (checkEndRef.current?.()) {
                recorder.stop();
                clearRecordingIntervals();
              }
            }, 200);
          } catch (err) {
            clearCountdownInterval();
            clearRecordingIntervals();
            stopAudioRecorder();
            revokeUrls();
            console.error('Recording failed:', err);
            setRecordingState('idle');
          }
        }
      }, 800);
    },
    [clearCountdownInterval, clearRecordingIntervals, stopAudioRecorder, stream, revokeUrls]
  );

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
      if (endCheckIntervalRef.current) {
        clearInterval(endCheckIntervalRef.current);
        endCheckIntervalRef.current = null;
      }
      setRecordingState('paused');
    }
  }, []);

  const resumeRecording = useCallback(
    (scrollCallback: () => void, checkEndCallback: () => boolean) => {
      if (mediaRecorderRef.current?.state === 'paused') {
        mediaRecorderRef.current.resume();
        scrollIntervalRef.current = setInterval(scrollCallback, 50);
        checkEndRef.current = checkEndCallback;
        setRecordingState('recording');
      }
    },
    []
  );

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording' || mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.stop();
    }
    clearRecordingIntervals();
    clearCountdownInterval();
    stopAudioRecorder();
  }, [clearCountdownInterval, clearRecordingIntervals, stopAudioRecorder]);

  const resetRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording' || mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.stop();
    }
    clearRecordingIntervals();
    clearCountdownInterval();
    stopAudioRecorder();
    revokeUrls();
    setRecordingState('idle');
    setRecordingResult(null);
  }, [clearCountdownInterval, clearRecordingIntervals, stopAudioRecorder, revokeUrls]);

  return {
    recordingState,
    videoUrl,
    audioUrl,
    countdownText,
    recordingResult,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    resetRecording,
  };
}