import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

declare global {
  interface Window {
    __MOCKLIFY_VERSION__?: string;
  }
}

/** Extension version injected into the webview HTML by WebViewManager. */
export function extensionVersion(): string {
  return window.__MOCKLIFY_VERSION__ || '';
}
