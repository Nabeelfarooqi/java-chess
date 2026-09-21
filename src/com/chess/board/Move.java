package com.chess.board;

/** Promotion is q/r/b/n, or '\0' for an ordinary move. */
public record Move(int from, int to, char promotion) {
    public Move {
        if (from < 0 || from >= 64 || to < 0 || to >= 64 || from == to)
            throw new IllegalArgumentException("Invalid move squares");
        if (promotion != '\0' && "qrbn".indexOf(promotion) < 0)
            throw new IllegalArgumentException("Invalid promotion");
    }
    public Move(int from, int to) { this(from, to, '\0'); }
    public String uci() { return squareName(from) + squareName(to) + (promotion == '\0' ? "" : promotion); }
    public static String squareName(int square) { return "" + (char) ('a' + square % 8) + (8 - square / 8); }
    public static int square(String name) {
        if (name == null || !name.matches("[a-h][1-8]")) throw new IllegalArgumentException("Invalid square: " + name);
        return (8 - (name.charAt(1) - '0')) * 8 + name.charAt(0) - 'a';
    }
    public static Move fromUci(String text) {
        if (text == null || !text.matches("[a-h][1-8][a-h][1-8][qrbn]?"))
            throw new IllegalArgumentException("Invalid move: " + text);
        return new Move(square(text.substring(0, 2)), square(text.substring(2, 4)), text.length() == 5 ? text.charAt(4) : '\0');
    }
}
