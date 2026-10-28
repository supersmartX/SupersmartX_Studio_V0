'use client';

import { useState, useEffect, useRef, useCallback, TouchEvent } from 'react';

/**
 * How many mounted modals are currently holding the scroll lock (see the
 * body-overflow effect below). Module-level so it survives across instances.
 */
let openModalCount = 0;

/**
 * True when the touch landed inside content that is scrolled away from its top
 * (or inside an ancestor of such content). Walking up from the touch target
 * mirrors how the gesture actually behaves: the user's finger is usually on the
 * panel's padding, not on the scroll container itself.
 */
function isScrolledUp(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node) {
    if (node.scrollTop > 0) return true;
    node = node.parentElement;
  }
  return false;
}

export function useModalAnimation(isOpen: boolean, onClose: () => void) {
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(isOpen);
  const touchStartY = useRef(0);
  const touchDeltaY = useRef(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
    } else if (shouldRender && !closeTimerRef.current) {
      setIsClosing(true);
      closeTimerRef.current = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
        closeTimerRef.current = null;
        onCloseRef.current();
      }, 150);
    }
  }, [isOpen, shouldRender]);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setShouldRender(false);
      setIsClosing(false);
      onCloseRef.current();
    }, 150);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Scroll-lock refcount. Two dialogs can be mounted at once (the library's
  // upgrade prompt sits over the library's own dialog), and the inner one used
  // to clear `body.overflow` on close while the outer was still open — so the
  // page behind started scrolling under a live modal. Only the last unlock
  // restores the page.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!shouldRender) return;
    openModalCount += 1;
    if (openModalCount === 1) document.body.style.overflow = 'hidden';
    return () => {
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) document.body.style.overflow = '';
    };
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

  const handleTouchEnd = (e: TouchEvent) => {
    // A swipe-down that starts inside scrolled content is a scroll, not a
    // dismiss request. Without this, dragging down one tick in a long dialog
    // threw the whole sheet away and lost whatever the user had typed.
    if (touchDeltaY.current > 100 && !isScrolledUp(e.target)) {
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
