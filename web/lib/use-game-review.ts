'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Move } from 'chess.js';
import { ReviewEngine } from './review-engine';
import type { Evaluation } from './review';
import { reviewRows, toUci } from './review-workspace';
import { loadReviewAssets, type EngineAsset, type EngineMode } from './review-assets';

type Snapshot = { evaluations: (Evaluation | undefined)[]; alternatives: Record<number, Evaluation[]> };
type Task = 'review' | 'position' | 'variation';
const cache = new Map<string, Snapshot>();

export function useGameReview(gameId: string, moves: Move[], enabled: boolean, mode: EngineMode) {
    const key = mode + ':' + gameId + ':' + moves.map(toUci).join(' ');
    const [snapshot, setSnapshot] = useState<Snapshot>(() => cache.get(key) || { evaluations: [], alternatives: {} });
    const current = useRef(snapshot), generation = useRef(0), engine = useRef<ReviewEngine | null>(null);
    const asset = useRef<EngineAsset | null>(null), download = useRef<AbortController | null>(null);
    const [loading, setLoading] = useState<number | null>(null);
    const [task, setTask] = useState<Task | null>(null), [progress, setProgress] = useState({ done: 0, total: 0 }), [error, setError] = useState('');
    const stop = useCallback(() => { generation.current++; download.current?.abort(); engine.current?.close(); engine.current = null; setTask(null); setLoading(null); }, []);
    const publish = useCallback((next: Snapshot) => {
        current.current = next; setSnapshot(next); cache.delete(key); cache.set(key, next);
        if (cache.size > 12) cache.delete(cache.keys().next().value!);
    }, [key]);
    const operate = useCallback(async (kind: Task, work: (worker: ReviewEngine, alive: () => boolean) => Promise<void>) => {
        stop(); setError(''); setTask(kind);
        const run = generation.current; let worker: ReviewEngine | null = null;
        const alive = () => run === generation.current;
        try {
            if (!asset.current) {
                const controller = new AbortController(); download.current = controller;
                if (mode === 'full') setLoading(0);
                const loaded = await loadReviewAssets(mode, controller.signal, value => { if (alive()) setLoading(value); });
                if (!alive()) { loaded.dispose(); return; }
                asset.current = loaded; setLoading(null);
            }
            worker = new ReviewEngine(asset.current.url); engine.current = worker; await worker.init();
            if (alive()) await work(worker, alive);
        } catch (e) { if (alive()) setError((e as Error).message); }
        finally { worker?.close(); if (alive()) { engine.current = null; setTask(null); setLoading(null); } }
    }, [stop, mode]);
    const fullReview = useCallback((ms = 250, resume = false) => {
        if (!enabled || !moves.length) return;
        const uci = moves.map(toUci);
        void operate('review', async (worker, alive) => {
            const positions = Array.from({ length: moves.length + 1 }, (_, index) => index).filter(index => !resume || !current.current.evaluations[index]);
            setProgress({ done: 0, total: positions.length });
            for (const [done, index] of positions.entries()) {
                const fen = index ? moves[index - 1].after : moves[0].before;
                const evaluation = await worker.analyze(uci.slice(0, index), fen, ms);
                if (!alive()) return;
                const evaluations = [...current.current.evaluations], alternatives = { ...current.current.alternatives };
                evaluations[index] = evaluation; delete alternatives[index];
                publish({ evaluations, alternatives }); setProgress({ done: done + 1, total: positions.length });
            }
        });
    }, [enabled, moves, operate, publish]);
    const deepen = (index: number) => {
        if (!enabled || !moves[index]) return;
        void operate('position', async (worker, alive) => {
            const prefix = moves.slice(0, index).map(toUci);
            const candidates = await worker.analyzeLines(prefix, moves[index].before, 2000, 3);
            if (!alive()) return;
            const after = await worker.analyze([...prefix, toUci(moves[index])], moves[index].after, 1500);
            if (!alive()) return;
            const evaluations = [...current.current.evaluations], alternatives = { ...current.current.alternatives, [index]: candidates };
            evaluations[index] = candidates[0]; evaluations[index + 1] = after; delete alternatives[index + 1];
            publish({ evaluations, alternatives });
        });
    };
    const analyzeVariation = (uci: string[], fen: string, onDone: (value: Evaluation) => void) => {
        if (!enabled) return;
        void operate('variation', async (worker, alive) => { const value = await worker.analyze(uci, fen, 1500); if (alive()) onDone(value); });
    };
    const dispose = useCallback(() => {
        generation.current++; download.current?.abort(); engine.current?.close(); engine.current = null;
        asset.current?.dispose(); asset.current = null;
    }, []);
    useEffect(() => {
        if (moves.length && moves.some((_, i) => !current.current.evaluations[i] || !current.current.evaluations[i + 1])) fullReview(250, true);
        return dispose;
    }, [fullReview, moves, dispose]);
    const rows = useMemo(() => reviewRows(moves, snapshot.evaluations), [moves, snapshot.evaluations]);
    return { ...snapshot, rows, task, loading, progress, error, stop, fullReview, deepen, analyzeVariation };
}
