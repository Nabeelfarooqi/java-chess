'use client';
import { Component, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export class FeatureBoundary extends Component<{ name: string; onDismiss: () => void; children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() {
        if (!this.state.failed) return this.props.children;
        return <section className="panel-section" role="alert">
            <h2>{this.props.name} could not open.</h2>
            <p>Your room is still available. Reload to fetch the latest version when your connection is ready.</p>
            <div className="dialog-actions"><Button variant="outline" onClick={this.props.onDismiss}>Back to game</Button><Button onClick={() => window.location.reload()}>Reload room</Button></div>
        </section>;
    }
}
