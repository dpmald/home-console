'use client';
import { useEffect } from 'react';

declare global {
  interface Window {
    /**
     * Fully Kiosk Browser JavaScript Interface (`Enable JavaScript Interface` = ON).
     * Docs: https://www.fully-kiosk.com/en/#configuration-javascript
     */
    fully?: {
      turnScreenOn?: () => void;
      turnScreenOff?: (keepAlive?: boolean) => void;
      setScreenBrightness?: (level: number) => void;
      getScreenBrightness?: () => number;
      textToSpeech?: (text: string, locale?: string) => void;
      stopTextToSpeech?: () => void;
      playSound?: (url: string, loop?: boolean) => void;
      stopSound?: () => void;
      vibrate?: (millis: number) => void;
      startApplication?: (packageName: string, action?: string, url?: string) => void;
      bringToForeground?: (millis?: number) => void;
      clearCache?: () => void;
      loadStartUrl?: () => void;
      getDeviceName?: () => string;
      getBatteryLevel?: () => number;
    };
    onFullyMotion?: () => void;
    onFullyScreenOn?: () => void;
  }
}

export const isFullyKiosk = () => typeof window !== 'undefined' && typeof window.fully !== 'undefined';

/** Wake the Cozyla 24" panel (e.g. when a timer finishes or an urgent alert arrives). */
export function wakeCozylaScreen() {
  try {
    window.fully?.turnScreenOn?.();
    window.fully?.bringToForeground?.();
  } catch {}
}

/** Speak a short alert over the Cozyla's dual 5W speakers via Android TTS if Fully Kiosk is present. */
export function speakOnCozyla(text: string) {
  try {
    if (window.fully?.textToSpeech) {
      window.fully.textToSpeech(text);
      return true;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      return true;
    }
  } catch {}
  return false;
}

/**
 * Silently wakes the native Android Spotify app in the background on the Cozyla
 * so it registers with Spotify Connect, then immediately brings Fully Kiosk
 * Browser back to the foreground so the user never leaves the dashboard.
 */
export function wakeSpotifyOnCozyla() {
  try {
    if (window.fully?.startApplication) {
      window.fully.startApplication('com.spotify.music');
      window.fully.bringToForeground?.(650);
      setTimeout(() => window.fully?.bringToForeground?.(), 700);
      return true;
    }
  } catch {}
  return false;
}

/**
 * Cozyla Calendar+ 24" + Fully Kiosk Browser lifecycle hook.
 */
export function useCozylaKiosk(onWakeRefresh: () => void) {
  useEffect(() => {
    let wakeLock: any = null;
    const acquireWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch {}
    };
    acquireWakeLock();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        acquireWakeLock();
        onWakeRefresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    window.onFullyMotion = () => {
      window.fully?.turnScreenOn?.();
      onWakeRefresh();
    };
    window.onFullyScreenOn = () => {
      onWakeRefresh();
    };

    const syncBrightness = () => {
      if (!window.fully?.setScreenBrightness) return;
      const h = new Date().getHours();
      const night = h >= 22 || h < 6;
      try {
        window.fully.setScreenBrightness(night ? 25 : 210);
      } catch {}
    };
    syncBrightness();
    const brightnessTimer = setInterval(syncBrightness, 15 * 60_000);

    const preventContext = (e: Event) => e.preventDefault();
    window.addEventListener('contextmenu', preventContext);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('contextmenu', preventContext);
      clearInterval(brightnessTimer);
      try {
        wakeLock?.release?.();
      } catch {}
    };
  }, [onWakeRefresh]);
}
