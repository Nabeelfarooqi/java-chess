import type { Color } from 'chess.js';
import { capturedOrder, type materialSummary } from '@/lib/material';
import { pieceName } from '@/lib/board';

// These tiny SVG sprites are immutable local assets, not raster LCP images.
/* eslint-disable @next/next/no-img-element */

export function CapturedMaterial({ color, name, material }: { color: Color; name: string; material: ReturnType<typeof materialSummary> }) {
    const capturedColor = color === 'w' ? 'b' : 'w';
    const groups = capturedOrder.filter(type => material.captures[color][type] > 0);
    const lead = material.lead[color];
    const description = groups.map(type => `${material.captures[color][type]} ${pieceName[type]}${material.captures[color][type] > 1 ? 's' : ''}`).join(', ');
    return <div className="captured-material" role="img" aria-label={`${name} captured ${description || 'no pieces'}${lead ? `; ahead by ${lead} material points` : ''}`} title="Material: pawn 1 · knight/bishop 3 · rook 5 · queen 9">
        {groups.map(type => <span className="captured-group" key={type} aria-hidden="true">
            <img src={`/pieces/${capturedColor}${type.toUpperCase()}.svg`} width={20} height={20} alt="" draggable={false}/>
            {material.captures[color][type] > 1 && <span>×{material.captures[color][type]}</span>}
        </span>)}
        {lead > 0 && <b className="material-lead" aria-hidden="true">+{lead}</b>}
    </div>;
}
