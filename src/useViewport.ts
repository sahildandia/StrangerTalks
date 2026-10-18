import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

// The visible viewport shrinks when a phone keyboard opens. Size the shell to
// that space instead of making the document taller than the WebView.
export function useViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const native = Capacitor.isNativePlatform();
    document.documentElement.classList.toggle('native-insets', native);
    const update = () => {
      if (viewport && viewport.scale !== 1) return;
      // Android's adjustResize already reports the available WebView height in
      // innerHeight. Some WebViews report a second, smaller visualViewport
      // height when the IME opens, which double-shrinks the app and leaves a
      // blank panel above the keyboard.
      const height = native ? window.innerHeight : Math.min(window.innerHeight, viewport?.height ?? window.innerHeight);
      document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
    };
    let focusTimer = 0;
    const keepFocusedInputVisible = () => {
      if (!native) return;
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused.matches('input,textarea,select')) {
          let scroller = focused.parentElement;
          while (scroller && scroller !== document.body) {
            const overflowY = getComputedStyle(scroller).overflowY;
            if (scroller.scrollHeight > scroller.clientHeight + 1 && (overflowY === 'auto' || overflowY === 'scroll')) break;
            scroller = scroller.parentElement;
          }
          if (!scroller || scroller === document.body) return;
          const viewport = scroller.getBoundingClientRect();
          const input = focused.getBoundingClientRect();
          if (input.bottom > viewport.bottom - 12) scroller.scrollTop += input.bottom - viewport.bottom + 12;
          else if (input.top < viewport.top + 12) scroller.scrollTop -= viewport.top + 12 - input.top;
        }
      }, 280);
    };
    update();
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update);
    document.addEventListener('focusin', keepFocusedInputVisible);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('resize', update);
      viewport?.removeEventListener('resize', update);
      document.removeEventListener('focusin', keepFocusedInputVisible);
      document.documentElement.style.removeProperty('--app-height');
      document.documentElement.classList.remove('native-insets');
    };
  }, []);
}
