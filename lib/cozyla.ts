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
      startIntent?: (url: string) => void;
      bringToForeground?: (millis?: number) => void;
      setClipboardText?: (text: string) => void;
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
 * Launches the on-board Google Gemini Android app (`com.google.android.apps.bard`)
 * on the Cozyla 24" console. If a contextual kitchen prompt is provided, copies it
 * to the system clipboard and passes it via Android intent extras so it is ready to
 * send or speak in Gemini Live.
 */
export function launchGeminiOnCozyla(prompt?: string) {
  if (typeof window === 'undefined') return;

  if (prompt) {
    try {
      window.fully?.setClipboardText?.(prompt);
    } catch {}
    try {
      navigator.clipboard?.writeText?.(prompt);
    } catch {}
  }

  try {
    // 1. Fully Kiosk JS Bridge (direct Android package launch or SEND intent)
    if (window.fully) {
      if (prompt && window.fully.startIntent) {
        const encoded = encodeURIComponent(prompt);
        window.fully.startIntent(
          `intent:#Intent;action=android.intent.action.SEND;type=text/plain;S.android.intent.extra.TEXT=${encoded};package=com.google.android.apps.bard;end`,
        );
        return;
      }
      if (window.fully.startApplication) {
        window.fully.startApplication('com.google.android.apps.bard');
        return;
      }
    }

    // 2. Android Chrome / WebView Intent URI fallback (works even before JS Interface is toggled ON)
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid) {
      const fallback = encodeURIComponent('https://gemini.google.com/app');
      if (prompt) {
        const encoded = encodeURIComponent(prompt);
        window.location.href = `intent:#Intent;action=android.intent.action.SEND;type=text/plain;S.android.intent.extra.TEXT=${encoded};package=com.google.android.apps.bard;S.browser_fallback_url=${fallback};end`;
      } else {
        window.location.href = `intent:#Intent;package=com.google.android.apps.bard;S.browser_fallback_url=${fallback};end`;
      }
      return;
    }

    // 3. Desktop / laptop preview fallback
    window.open('https://gemini.google.com/app', '_blank', 'noopener,noreferrer');
  } catch {}
}

/**
 * Launches the Greenlight Android app (`me.greenlight`) on the Cozyla 24" console
 * via Fully Kiosk or Android Intent URI fallback.
 */
export function launchGreenlightOnCozyla() {
  if (typeof window === 'undefined') return;
  try {
    if (window.fully?.startApplication) {
      window.fully.startApplication('me.greenlight');
      return;
    }
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid) {
      const fallback = encodeURIComponent('https://greenlight.com');
      window.location.href = `intent:#Intent;package=me.greenlight;S.browser_fallback_url=${fallback};end`;
      return;
    }
    window.open('https://greenlight.com', '_blank', 'noopener,noreferrer');
  } catch {}
}

/**
 * Cozyla Calendar+ 24" + Fully Kiosk Browser lifecycle hook.
 */
export function useCozylaKiosk(onWakeRefresh: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled, onWakeRefresh]);
}
