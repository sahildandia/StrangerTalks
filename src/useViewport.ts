import { useEffect } from 'react';

// The visible viewport shrinks when a phone keyboard opens. Size the shell to
// that space instead of making the document taller than the WebView.
export function useViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      if (viewport && viewport.scale !== 1) return;
      const height = Math.min(window.innerHeight, viewport?.height ?? window.innerHeight);
      document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
    };
    update();
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      viewport?.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--app-height');
    };
  }, []);
}
