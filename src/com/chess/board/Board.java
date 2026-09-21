package com.chess.board;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import com.chess.board.Piece.Side;

/** Immutable position; legality is independent of the graphical interface. */
public final class Board {
    public static final String START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    private static final int[][] KNIGHT = {{-2,-1},{-2,1},{-1,-2},{-1,2},{1,-2},{1,2},{2,-1},{2,1}};
    private static final int[][] DIAGONAL = {{-1,-1},{-1,1},{1,-1},{1,1}};
    private static final int[][] STRAIGHT = {{-1,0},{1,0},{0,-1},{0,1}};
    private final char[] squares;
    private final Side turn;
    private final int rights; // White king/queen side: 1/2. Black: 4/8.
    private final int enPassant;
    private final int halfmove;
    private final int fullmove;

    private Board(char[] squares, Side turn, int rights, int ep, int halfmove, int fullmove) {
        this.squares = squares; this.turn = turn; this.rights = rights;
        this.enPassant = ep; this.halfmove = halfmove; this.fullmove = fullmove;
    }
    public static Board initial() { return fromFen(START_FEN); }
    public Side turn() { return turn; }
    public int halfmoveClock() { return halfmove; }
    public int fullmoveNumber() { return fullmove; }
    public char pieceChar(int sq) { return squares[sq]; }
    public Piece pieceAt(int sq) { return Piece.fromFen(squares[sq]); }
    public Tile tileAt(int sq) { return Tile.at(sq, pieceAt(sq)); }
    public int enPassantSquare() { return enPassant; }
    public static boolean isSide(char p, Side side) {
        return p != '.' && (Character.isUpperCase(p) == (side == Side.WHITE));
    }
    private static boolean inside(int r, int c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
    public int kingSquare(Side side) {
        char king = side == Side.WHITE ? 'K' : 'k';
        for (int i = 0; i < 64; i++) if (squares[i] == king) return i;
        throw new IllegalStateException("Position has no " + side.label() + " king");
    }
    public boolean inCheck(Side side) { return attacked(kingSquare(side), side.opposite()); }
    public boolean attacked(int square, Side by) {
        int r = square / 8, c = square % 8;
        int pawnRow = r + (by == Side.WHITE ? 1 : -1);
        for (int dc : new int[]{-1, 1}) if (inside(pawnRow, c + dc)) {
            char p = squares[pawnRow * 8 + c + dc];
            if (Character.toLowerCase(p) == 'p' && isSide(p, by)) return true;
        }
        for (int[] d : KNIGHT) if (inside(r+d[0], c+d[1])) {
            char p = squares[(r+d[0])*8+c+d[1]];
            if (Character.toLowerCase(p) == 'n' && isSide(p, by)) return true;
        }
        for (int dr = -1; dr <= 1; dr++) for (int dc = -1; dc <= 1; dc++) {
            if ((dr != 0 || dc != 0) && inside(r+dr,c+dc)) {
                char p = squares[(r+dr)*8+c+dc];
                if (Character.toLowerCase(p) == 'k' && isSide(p, by)) return true;
            }
        }
        return rayAttacked(r,c,by,DIAGONAL,'b') || rayAttacked(r,c,by,STRAIGHT,'r');
    }
    private boolean rayAttacked(int r, int c, Side by, int[][] directions, char type) {
        for (int[] d : directions) {
            int nr=r+d[0], nc=c+d[1];
            while (inside(nr,nc)) {
                char p=squares[nr*8+nc];
                if (p != '.') {
                    if (isSide(p,by) && (Character.toLowerCase(p)==type || Character.toLowerCase(p)=='q')) return true;
                    break;
                }
                nr+=d[0]; nc+=d[1];
            }
        }
        return false;
    }
    public List<Move> legalMoves() {
        List<Move> legal = new ArrayList<>();
        for (Move move : pseudoMoves()) if (!applyUnchecked(move).inCheck(turn)) legal.add(move);
        return legal;
    }
    public List<Move> legalMovesFrom(int square) {
        return legalMoves().stream().filter(m -> m.from() == square).toList();
    }
    public Board play(Move move) {
        if (!legalMoves().contains(move)) throw new IllegalArgumentException("Illegal move: " + move.uci());
        return applyUnchecked(move);
    }
    private List<Move> pseudoMoves() {
        List<Move> moves = new ArrayList<>();
        for (int from = 0; from < 64; from++) {
            char p = squares[from];
            if (!isSide(p,turn)) continue;
            int r=from/8,c=from%8;
            switch (Character.toLowerCase(p)) {
                case 'p' -> pawnMoves(from,r,c,moves);
                case 'n' -> jumpMoves(from,r,c,KNIGHT,moves);
                case 'b' -> slidingMoves(from,r,c,DIAGONAL,moves);
                case 'r' -> slidingMoves(from,r,c,STRAIGHT,moves);
                case 'q' -> { slidingMoves(from,r,c,DIAGONAL,moves); slidingMoves(from,r,c,STRAIGHT,moves); }
                case 'k' -> {
                    for (int dr=-1;dr<=1;dr++) for (int dc=-1;dc<=1;dc++)
                        if ((dr!=0 || dc!=0) && inside(r+dr,c+dc)) addTarget(from,(r+dr)*8+c+dc,moves);
                    castleMoves(from,moves);
                }
                default -> throw new IllegalStateException("Unknown piece");
            }
        }
        return moves;
    }
    private void addTarget(int from, int to, List<Move> moves) {
        char target=squares[to];
        if (!isSide(target,turn) && Character.toLowerCase(target)!='k') moves.add(new Move(from,to));
    }
    private void pawnMoves(int from,int r,int c,List<Move> moves) {
        int dr=turn==Side.WHITE?-1:1, next=r+dr;
        if (!inside(next,c)) return;
        if (squares[next*8+c]=='.') {
            addPawn(from,next*8+c,moves);
            if (r==(turn==Side.WHITE?6:1) && squares[(r+2*dr)*8+c]=='.')
                moves.add(new Move(from,(r+2*dr)*8+c));
        }
        for (int dc : new int[]{-1,1}) if (inside(next,c+dc)) {
            int to=next*8+c+dc;
            char target=squares[to];
            boolean capture=isSide(target,turn.opposite()) && Character.toLowerCase(target)!='k';
            boolean ep=to==enPassant && target=='.' &&
                squares[r*8+c+dc]==(turn==Side.WHITE?'p':'P');
            if (capture || ep) addPawn(from,to,moves);
        }
    }
    private void addPawn(int from,int to,List<Move> moves) {
        if (to/8==0 || to/8==7) for (char p : new char[]{'q','r','b','n'}) moves.add(new Move(from,to,p));
        else moves.add(new Move(from,to));
    }
    private void jumpMoves(int from,int r,int c,int[][] offsets,List<Move> moves) {
        for (int[] d : offsets) if (inside(r+d[0],c+d[1])) addTarget(from,(r+d[0])*8+c+d[1],moves);
    }
    private void slidingMoves(int from,int r,int c,int[][] dirs,List<Move> moves) {
        for (int[] d : dirs) {
            int nr=r+d[0],nc=c+d[1];
            while (inside(nr,nc)) {
                int to=nr*8+nc;
                addTarget(from,to,moves);
                if (squares[to]!='.') break;
                nr+=d[0];nc+=d[1];
            }
        }
    }
    private void castleMoves(int from,List<Move> moves) {
        int home=turn==Side.WHITE?60:4, kingBit=turn==Side.WHITE?1:4, queenBit=kingBit*2;
        char rook=turn==Side.WHITE?'R':'r';
        if (from!=home || inCheck(turn)) return;
        if ((rights&kingBit)!=0 && squares[home+3]==rook && squares[home+1]=='.' && squares[home+2]=='.'
            && !attacked(home+1,turn.opposite()) && !attacked(home+2,turn.opposite())) moves.add(new Move(home,home+2));
        if ((rights&queenBit)!=0 && squares[home-4]==rook && squares[home-1]=='.' && squares[home-2]=='.'
            && squares[home-3]=='.' && !attacked(home-1,turn.opposite()) && !attacked(home-2,turn.opposite()))
            moves.add(new Move(home,home-2));
    }
    public boolean isCapture(Move move) {
        return squares[move.to()]!='.' || (Character.toLowerCase(squares[move.from()])=='p'
            && move.to()==enPassant && move.from()%8!=move.to()%8);
    }
    /** Search/perft only: callers must obtain moves from legalMoves(). */
    public Board applyUnchecked(Move move) {
        char[] next=squares.clone();
        int from=move.from(),to=move.to(),newRights=rights,newEp=-1;
        char p=next[from]; boolean pawn=Character.toLowerCase(p)=='p',capture=isCapture(move);
        if (pawn && to==enPassant && next[to]=='.' && from%8!=to%8) next[to+(turn==Side.WHITE?8:-8)]='.';
        next[from]='.'; next[to]=move.promotion()=='\0'?p:(turn==Side.WHITE?Character.toUpperCase(move.promotion()):move.promotion());
        if (Character.toLowerCase(p)=='k') {
            newRights &= turn==Side.WHITE?~3:~12;
            if (Math.abs(to-from)==2) {
                int rookFrom=to>from?from+3:from-4,rookTo=to>from?from+1:from-1;
                next[rookTo]=next[rookFrom];next[rookFrom]='.';
            }
        }
        for (int sq : new int[]{from,to}) {
            if (sq==63) newRights&=~1;
            if (sq==56) newRights&=~2;
            if (sq==7) newRights&=~4;
            if (sq==0) newRights&=~8;
        }
        if (pawn && Math.abs(to-from)==16) newEp=(to+from)/2;
        return new Board(next,turn.opposite(),newRights,newEp,pawn||capture?0:halfmove+1,fullmove+(turn==Side.BLACK?1:0));
    }
    /** Repetition includes an en passant target only when a legal capture exists. */
    public String repetitionKey() {
        String[] parts=toFen().split(" ");
        if (enPassant!=-1 && legalMoves().stream().noneMatch(m -> m.to()==enPassant &&
                Character.toLowerCase(squares[m.from()])=='p' && m.from()%8!=m.to()%8)) parts[3]="-";
        return String.join(" ",Arrays.copyOf(parts,4));
    }
    /** Detect common dead-material positions, without assuming K+NN versus K is dead. */
    public boolean insufficientMaterial() {
        int minors=0,knights=0,bishopColor=-1;
        for (int sq=0;sq<64;sq++) {
            char p=Character.toLowerCase(squares[sq]);
            if (p=='.' || p=='k') continue;
            if (p!='b' && p!='n') return false;
            minors++;
            if (p=='n') knights++;
            else {
                int color=(sq/8+sq%8)%2;
                if (bishopColor==-1) bishopColor=color;
                else if (bishopColor!=color) bishopColor=2;
            }
        }
        return minors<=1 || (knights==0 && bishopColor!=2);
    }
    public String toFen() {
        StringBuilder s=new StringBuilder();
        for (int r=0;r<8;r++) {
            int empty=0;
            for (int c=0;c<8;c++) {
                char p=squares[r*8+c];
                if (p=='.') empty++;
                else { if (empty>0) s.append(empty); empty=0; s.append(p); }
            }
            if (empty>0) s.append(empty);
            if (r<7) s.append('/');
        }
        s.append(turn==Side.WHITE?" w ":" b ");
        if (rights==0) s.append('-');
        else { if ((rights&1)!=0)s.append('K'); if ((rights&2)!=0)s.append('Q'); if ((rights&4)!=0)s.append('k'); if ((rights&8)!=0)s.append('q'); }
        return s.append(' ').append(enPassant==-1?"-":Move.squareName(enPassant)).append(' ').append(halfmove).append(' ').append(fullmove).toString();
    }
    public static Board fromFen(String fen) {
        String[] p=fen.trim().split("\\s+");
        if (p.length!=6) throw new IllegalArgumentException("FEN must contain six fields");
        char[] board=new char[64]; Arrays.fill(board,'.');
        String[] rows=p[0].split("/");
        if (rows.length!=8) throw new IllegalArgumentException("FEN must contain eight ranks");
        int whiteKing=0,blackKing=0;
        for (int r=0;r<8;r++) {
            int c=0;
            for (char ch : rows[r].toCharArray()) {
                if (ch>='1' && ch<='8') c+=ch-'0';
                else {
                    if (c>=8 || "prnbqkPRNBQK".indexOf(ch)<0) throw new IllegalArgumentException("Invalid FEN piece");
                    if ((r==0 || r==7) && Character.toLowerCase(ch)=='p') throw new IllegalArgumentException("Pawn on promotion rank");
                    board[r*8+c++]=ch;
                    if(ch=='K')whiteKing++; if(ch=='k')blackKing++;
                }
            }
            if(c!=8)throw new IllegalArgumentException("Invalid FEN rank width");
        }
        if (whiteKing!=1 || blackKing!=1) throw new IllegalArgumentException("Exactly one king of each color is required");
        if (!p[1].equals("w") && !p[1].equals("b")) throw new IllegalArgumentException("Invalid side to move");
        if (!p[2].matches("-|K?Q?k?q?") || p[2].isEmpty()) throw new IllegalArgumentException("Invalid castling rights");
        int rights=0; if(p[2].contains("K"))rights|=1;if(p[2].contains("Q"))rights|=2;if(p[2].contains("k"))rights|=4;if(p[2].contains("q"))rights|=8;
        int ep=p[3].equals("-")?-1:Move.square(p[3]);
        if (ep!=-1 && (ep/8!=(p[1].equals("w")?2:5) || board[ep]!='.')) throw new IllegalArgumentException("Invalid en passant target");
        int half=Integer.parseInt(p[4]),full=Integer.parseInt(p[5]);
        if (half<0 || full<1) throw new IllegalArgumentException("Invalid move counters");
        return new Board(board,p[1].equals("w")?Side.WHITE:Side.BLACK,rights,ep,half,full);
    }
}
