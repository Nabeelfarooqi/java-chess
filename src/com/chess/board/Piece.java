package com.chess.board;

/** Immutable piece. Uppercase FEN letters are White, lowercase are Black. */
public record Piece(Type type, Side side) {
    public enum Side {
        WHITE, BLACK;
        public Side opposite() { return this == WHITE ? BLACK : WHITE; }
        public String label() { return this == WHITE ? "White" : "Black"; }
    }
    public enum Type {
        PAWN('p', 100), KNIGHT('n', 320), BISHOP('b', 330), ROOK('r', 500), QUEEN('q', 900), KING('k', 20000);
        public final char letter;
        public final int value;
        Type(char letter, int value) { this.letter = letter; this.value = value; }
    }
    public char fen() { return side == Side.WHITE ? Character.toUpperCase(type.letter) : type.letter; }
    public static Piece fromFen(char c) {
        if (c == '.') return null;
        for (Type t : Type.values()) if (t.letter == Character.toLowerCase(c))
            return new Piece(t, Character.isUpperCase(c) ? Side.WHITE : Side.BLACK);
        throw new IllegalArgumentException("Unknown piece: " + c);
    }
    public String name() { return side.label() + " " + type.name().toLowerCase(); }
}
