'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
type InstallPrompt=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
let installPrompt:InstallPrompt|null=null;
export function AppSupport(){
    useEffect(()=>{
        const prompt=(event:Event)=>{event.preventDefault();installPrompt=event as InstallPrompt;};
        window.addEventListener('beforeinstallprompt',prompt);
        if('serviceWorker' in navigator)void navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{});
        return()=>window.removeEventListener('beforeinstallprompt',prompt);
    },[]);return null;
}
export function InstallApp(){
    const [help,setHelp]=useState(false),[installed,setInstalled]=useState(false);
    useEffect(()=>{const check=()=>setInstalled(window.matchMedia('(display-mode: standalone)').matches||!!(navigator as unknown as {standalone?:boolean}).standalone);check();window.addEventListener('appinstalled',check);return()=>window.removeEventListener('appinstalled',check);},[]);
    async function install(){if(installPrompt){const prompt=installPrompt;installPrompt=null;await prompt.prompt();const choice=await prompt.userChoice;if(choice.outcome==='accepted')setInstalled(true);}else setHelp(true);}
    return <><Button variant="outline" onClick={()=>void install()} disabled={installed}>{installed?'Added to home screen':'Add Rival Chess to home screen'}</Button><Dialog open={help} onOpenChange={setHelp}><DialogContent><DialogHeader><DialogTitle>Your own chess app</DialogTitle><DialogDescription>Open this site in Safari on iPhone, tap Share, then Add to Home Screen. On Android or desktop, use your browser’s Install app option.</DialogDescription></DialogHeader><p>Use the same link and your personal PIN. An internet connection is required to play.</p></DialogContent></Dialog></>;
}
