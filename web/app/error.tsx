'use client';
import { Button } from '@/components/ui/button';

export default function RoomError({ reset }: { reset: () => void }) {
    return <main className="loading-room"><section role="alert"><h1>The room could not be displayed.</h1><p>Your saved game and server clocks are unchanged. Reopen the room to reconnect.</p><div className="dialog-actions"><Button variant="outline" onClick={reset}>Try again</Button><Button onClick={() => window.location.reload()}>Reload room</Button></div></section></main>;
}
