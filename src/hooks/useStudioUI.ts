'use client';

import { useState, useCallback } from 'react';
import { executePendingDownload } from '@/lib/auth-guard';

export function useStudioUI() {
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);

  const handleAuthRequired = useCallback(() => {
    setIsAuthModalOpen(true);
  }, []);

  const handleAuthSuccess = useCallback(() => {
    executePendingDownload();
  }, []);

  const handlePricingClick = useCallback(() => {
    setIsPricingModalOpen(true);
  }, []);

  return {
    isDrawerVisible,
    setIsDrawerVisible,
    isAuthModalOpen,
    setIsAuthModalOpen,
    isPricingModalOpen,
    setIsPricingModalOpen,
    handleAuthRequired,
    handleAuthSuccess,
    handlePricingClick,
  };
}
