'use client';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { clockMs, type Game } from '@/lib/game';
import { gameSound, soundNotes, type GameSound } from '@/lib/sounds';
import { usePreference } from '@/lib/use-preference';
export function useGameSounds(game:Game|null,me:string,offset:number) {
    const [stored,setStored]=usePreference('rival-sounds','');
    const {enabled,volume}=useMemo(()=>{try{const saved=JSON.parse(stored);return {enabled:saved.enabled!==false,volume:typeof saved.volume==='number'&&Number.isFinite(saved.volume)?Math.max(0,Math.min(1,saved.volume)):.35};}catch{return {enabled:true,volume:.35};}},[stored]);
    const context=useRef<AudioContext|null>(null),preferences=useRef({enabled,volume});
    const latest=useRef({game,me,offset});
    useEffect(()=>{preferences.current={enabled,volume};},[enabled,volume]);
    useEffect(()=>{latest.current={game,me,offset};},[game,me,offset]);
    const previous=useRef<Game|null>(null),warned=useRef('');
    const change=useCallback((next:{enabled:boolean;volume:number})=>{preferences.current=next;setStored(JSON.stringify(next));},[setStored]);
    const unlock=useCallback(()=>{
        const Audio=window.AudioContext||(window as unknown as {webkitAudioContext:typeof AudioContext}).webkitAudioContext;
        if(!Audio)return;
        if(!context.current)context.current=new Audio();
        if(context.current.state==='suspended')void context.current.resume().catch(()=>{});
    },[]);
    useEffect(()=>{const start=()=>unlock();window.addEventListener('pointerdown',start,{passive:true});window.addEventListener('keydown',start);return()=>{window.removeEventListener('pointerdown',start);window.removeEventListener('keydown',start);void context.current?.close().catch(()=>{});context.current=null;};},[unlock]);
    const play=useCallback((kind:GameSound)=>{
        const audio=context.current,{enabled,volume}=preferences.current;
        if(!audio||audio.state!=='running'||!enabled||!volume||document.hidden)return;
        soundNotes[kind].forEach((frequency,i)=>{const oscillator=audio.createOscillator(),gain=audio.createGain(),time=audio.currentTime+i*.1;oscillator.type='sine';oscillator.frequency.value=frequency;gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(volume*.18,time+.008);gain.gain.exponentialRampToValueAtTime(.0001,time+.12);oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(time);oscillator.stop(time+.13);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};});
    },[]);
    useEffect(()=>{const sound=gameSound(previous.current,game);previous.current=game;if(sound)play(sound);},[game,play]);
    useEffect(()=>{const timer=setInterval(()=>{const {game,me,offset}=latest.current;if(!game||game.status!=='active')return;const color=game.white===me?'w':'b';const remaining=clockMs(game,color,Date.now()+offset);if(remaining>0&&remaining<=10000&&warned.current!==game.id&&!document.hidden&&context.current?.state==='running'){warned.current=game.id;play('low');}},250);return()=>clearInterval(timer);},[play]);
    return {enabled,volume,change,test:()=>{unlock();void context.current?.resume().then(()=>play('move')).catch(()=>{});}};
}
