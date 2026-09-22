'use client';
import { useState } from 'react';
import { CharacterPortrait } from './character-art';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LockKeyhole, ArrowRight, ShieldCheck, Crown } from 'lucide-react';
export function Entry({ onEnter, busy, error }: {
    onEnter: (pin: string) => void;
    busy: boolean;
    error: string;
}) { const [code, setCode] = useState(''); return <main className="entry"><header className="brand"><span className="brand-mark">♞</span> RIVAL ROOM <span className="private-badge"><LockKeyhole size={12}/> INVITE ONLY</span></header><div className="entry-grid"><section><p className="eyebrow">YOUR PRIVATE CHESS CLUB</p><h1>Good friends.<br /><em>Great rivals.</em></h1><p className="intro">Pick your rival. Play the clock. Keep your own record.</p><form className="gate" onSubmit={e => { e.preventDefault(); onEnter(code); }}><div className="gate-title"><LockKeyhole size={18}/><h2>Take your seat.</h2></div><label htmlFor="code">Your personal access code</label><div className="code-row"><Input id="code" type="password" inputMode="numeric" placeholder="Your personal code" maxLength={12} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}/><Button type="submit" disabled={busy || ![8, 12].includes(code.length)}>{busy ? 'Opening…' : 'Enter room'} <ArrowRight size={16}/></Button></div>{error && <p className="error" role="alert">{error}</p>}<p className="muted">Your code brings up your name and scores. No sign-up.</p></form><div className="entry-points"><span><ShieldCheck size={16}/> Private by invitation</span><span><Crown size={16}/> Every result counts</span></div></section><div className="character-poster" aria-label="Walan and Gud characters"><div className="duel-character" data-character="walan"><CharacterPortrait player="one"/><strong>Walan</strong></div><span className="duel-vs">VS</span><div className="duel-character" data-character="gud"><CharacterPortrait player="two"/><strong>Gud</strong></div><p>Your PIN. Your character. Your rivalry.</p></div></div><footer>RIVAL ROOM <span>Small circle. Long-running rivalry.</span></footer></main>; }
