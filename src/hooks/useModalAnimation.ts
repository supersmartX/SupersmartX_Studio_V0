'use client';

import { useState, useEffect, useRef, TouchEvent } from 'react';

export function useModalAnimation(isOpen: boolean, onClose: () => void) {
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(isOpen);
  const touchStartY = useRef(0);
  const touchDeltaY = useRef(0);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
    }
  }, [isOpen]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setShouldRender(false);
      setIsClosing(false);
      onClose();
    }, 150);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (shouldRender) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [shouldRender]);

  const handleTouchStart = (e: TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchDeltaY.current = 0;
  };

  const handleTouchMove = (e: TouchEvent) => {
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) {
      touchDeltaY.current = delta;
    }
  };

  const handleTouchEnd = () => {
    if (touchDeltaY.current > 100) {
      handleClose();
    }
    touchDeltaY.current = 0;
  };

  return {
    isClosing,
    shouldRender,
    handleClose,
    swipeHandlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  };
}
