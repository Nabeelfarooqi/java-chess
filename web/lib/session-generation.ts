// GETs must not observe a cookie partway through login/logout. Results from
// before either edge of that transition cannot update the new room.
export class SessionGeneration {
    private generation = 0;
    private changing = false;
    get token() { return this.generation; }
    get readToken() { return this.changing ? null : this.generation; }
    accepts(token: number) { return token === this.generation; }
    invalidate() { this.generation++; }
    beginChange() { this.changing = true; this.invalidate(); }
    endChange() { this.changing = false; this.invalidate(); }
}
