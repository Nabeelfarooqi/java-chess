'use client';
import { useCallback, useEffect, useRef } from 'react';
import { requestJson } from './client-request';

export function useRequest() {
    const scope = useRef<AbortController | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        scope.current = controller;
        return () => controller.abort();
    }, []);
    return useCallback(<T,>(url: string, init: RequestInit = {}) => {
        const lifecycle = scope.current?.signal;
        return requestJson<T>(url, { ...init, signal: lifecycle && init.signal ? AbortSignal.any([lifecycle, init.signal]) : lifecycle || init.signal });
    }, []);
}
