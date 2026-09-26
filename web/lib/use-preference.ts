'use client';
import { useCallback, useSyncExternalStore } from 'react';

const memory = new Map<string, string>();
const changed = 'rival-preference-change';
type PreferenceKey = 'rival-board-theme' | 'rival-sounds';
// The server snapshot stays deterministic; hydration then reads browser storage.
// Only appearance/audio preferences belong here, never a PIN or game history.
export function usePreference(key: PreferenceKey, fallback: string) {
    const subscribe = useCallback((notify: () => void) => {
        const storage = (event: StorageEvent) => { if (event.key === null || event.key === key) { memory.delete(key); notify(); } };
        window.addEventListener('storage', storage); window.addEventListener(changed, notify);
        return () => { window.removeEventListener('storage', storage); window.removeEventListener(changed, notify); };
    }, [key]);
    const snapshot = useCallback(() => {
        if (memory.has(key)) return memory.get(key)!;
        try { return localStorage.getItem(key) ?? fallback; }
        catch { return fallback; }
    }, [key, fallback]);
    const value = useSyncExternalStore(subscribe, snapshot, () => fallback);
    const setValue = useCallback((next: string) => {
        try { localStorage.setItem(key, next); memory.delete(key); }
        catch { memory.set(key, next); }
        window.dispatchEvent(new Event(changed));
    }, [key]);
    return [value, setValue] as const;
}
