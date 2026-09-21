package com.chess.board;

/** The original tile abstraction, now backed by an immutable Piece. a8 is 0. */
public abstract class Tile {
    private final int tileCoordinate;
    protected Tile(int coordinate) {
        if (coordinate < 0 || coordinate >= 64) throw new IllegalArgumentException("Square out of bounds");
        tileCoordinate = coordinate;
    }
    public int getTileCoordinate() { return tileCoordinate; }
    public abstract boolean isTileOccupied();
    public abstract Piece getPiece();
    public static Tile at(int coordinate, Piece piece) {
        return piece == null ? new EmptyTile(coordinate) : new OccupiedTile(coordinate, piece);
    }
    public static final class EmptyTile extends Tile {
        public EmptyTile(int coordinate) { super(coordinate); }
        @Override public boolean isTileOccupied() { return false; }
        @Override public Piece getPiece() { return null; }
    }
    public static final class OccupiedTile extends Tile {
        private final Piece pieceOnTile;
        public OccupiedTile(int coordinate, Piece piece) {
            super(coordinate);
            pieceOnTile = java.util.Objects.requireNonNull(piece);
        }
        @Override public boolean isTileOccupied() { return true; }
        @Override public Piece getPiece() { return pieceOnTile; }
    }
}
