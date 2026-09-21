package com.chess.game;

import com.chess.board.Board;
import com.chess.board.Move;
import com.chess.board.Piece.Side;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.LocalDate;
import java.util.*;

/** Owns history and results. The UI and AI both use Board's legal moves. */
public final class ChessGame {
    public record PlayedMove(Move move, String notation, Board before, Board after) { }
    public enum End {
        NONE, CHECKMATE, STALEMATE, MATERIAL, FIVEFOLD, SEVENTY_FIVE,
        THREEFOLD, FIFTY_MOVE, AGREED, WHITE_RESIGNED, BLACK_RESIGNED
    }
    private final Board initial;
    private Board board;
    private final List<PlayedMove> history = new ArrayList<>();
    private final Map<String,Integer> repetitions = new HashMap<>();
    private End end = End.NONE;
    private Move intendedClaim;

    public ChessGame() { this(Board.initial()); }
    public ChessGame(Board initial) {
        this.initial=Objects.requireNonNull(initial);board=initial;
        repetitions.put(board.repetitionKey(),1);adjudicate();
    }
    public Board board() { return board; }
    public List<PlayedMove> history() { return List.copyOf(history); }
    public Map<String,Integer> repetitionCounts() { return Map.copyOf(repetitions); }
    public End end() { return end; }
    public boolean isOver() { return end!=End.NONE; }
    public int plyCount() { return history.size(); }
    public void play(Move move) {
        if(isOver())throw new IllegalStateException("The game is over");
        List<Move> legal=board.legalMoves();
        if(!legal.contains(move))throw new IllegalArgumentException("Illegal move: "+move.uci());
        Board next=board.applyUnchecked(move);
        String san=notation(board,move,next,legal);
        history.add(new PlayedMove(move,san,board,next));
        board=next;repetitions.merge(board.repetitionKey(),1,Integer::sum);adjudicate();
    }
    public boolean undo() {
        if(history.isEmpty()) { end=End.NONE;adjudicate();return false; }
        repetitions.compute(board.repetitionKey(),(key,n)->n==null||n<=1?null:n-1);
        board=history.remove(history.size()-1).before();end=End.NONE;adjudicate();return true;
    }
    private void adjudicate() {
        end=End.NONE;intendedClaim=null;
        if(board.legalMoves().isEmpty()) end=board.inCheck(board.turn())?End.CHECKMATE:End.STALEMATE;
        else if(board.insufficientMaterial())end=End.MATERIAL;
        else if(board.halfmoveClock()>=150)end=End.SEVENTY_FIVE;
        else if(repetitions.getOrDefault(board.repetitionKey(),0)>=5)end=End.FIVEFOLD;
    }
    public boolean canClaimDraw() {
        return !isOver() && (board.halfmoveClock()>=100 || repetitions.getOrDefault(board.repetitionKey(),0)>=3);
    }
    public List<Move> drawClaimMoves() {
        if(isOver())return List.of();
        return board.legalMoves().stream().filter(move->{
            Board next=board.applyUnchecked(move);
            return next.halfmoveClock()>=100 || repetitions.getOrDefault(next.repetitionKey(),0)>=2;
        }).toList();
    }
    public void claimDraw() {
        if(!canClaimDraw())throw new IllegalStateException("No draw can be claimed in this position");
        end=board.halfmoveClock()>=100?End.FIFTY_MOVE:End.THREEFOLD;
    }
    /** An intended legal move can justify a claim without being executed. */
    public void claimDraw(Move intended) {
        if(!drawClaimMoves().contains(intended))throw new IllegalArgumentException("That move does not permit a draw claim");
        Board next=board.applyUnchecked(intended);
        intendedClaim=intended;
        end=next.halfmoveClock()>=100?End.FIFTY_MOVE:End.THREEFOLD;
    }
    public void resign(Side side) {
        if(isOver())return;
        end=side==Side.WHITE?End.WHITE_RESIGNED:End.BLACK_RESIGNED;
    }
    public void agreeDraw() { if(!isOver())end=End.AGREED; }
    public String result() {
        return switch(end) {
            case NONE -> "*";
            case WHITE_RESIGNED -> "0-1";
            case BLACK_RESIGNED -> "1-0";
            case CHECKMATE -> board.turn()==Side.WHITE?"0-1":"1-0";
            default -> "1/2-1/2";
        };
    }
    public String status() {
        return switch(end) {
            case NONE -> board.turn().label()+" to move"+(board.inCheck(board.turn())?" — check":"");
            case CHECKMATE -> "Checkmate — "+board.turn().opposite().label()+" wins";
            case STALEMATE -> "Draw — stalemate";
            case MATERIAL -> "Draw — insufficient material";
            case FIVEFOLD -> "Draw — fivefold repetition";
            case SEVENTY_FIVE -> "Draw — 75-move rule";
            case THREEFOLD -> "Draw — threefold repetition claimed";
            case FIFTY_MOVE -> "Draw — 50-move rule claimed";
            case AGREED -> "Draw — by agreement";
            case WHITE_RESIGNED -> "Black wins — White resigned";
            case BLACK_RESIGNED -> "White wins — Black resigned";
        };
    }
    public static String notation(Board before,Move move,Board after,List<Move> legal) {
        char p=Character.toLowerCase(before.pieceChar(move.from()));
        StringBuilder s=new StringBuilder();
        if(p=='k' && Math.abs(move.to()-move.from())==2)s.append(move.to()>move.from()?"O-O":"O-O-O");
        else {
            boolean capture=before.isCapture(move);
            if(p!='p') {
                s.append(Character.toUpperCase(p));
                List<Move> alternatives=legal.stream().filter(m->m.to()==move.to() && m.from()!=move.from()
                    && Character.toLowerCase(before.pieceChar(m.from()))==p).toList();
                if(!alternatives.isEmpty()) {
                    boolean sameFile=alternatives.stream().anyMatch(m->m.from()%8==move.from()%8);
                    boolean sameRank=alternatives.stream().anyMatch(m->m.from()/8==move.from()/8);
                    if(!sameFile)s.append((char)('a'+move.from()%8));
                    else if(!sameRank)s.append(8-move.from()/8);
                    else s.append(Move.squareName(move.from()));
                }
            } else if(capture)s.append((char)('a'+move.from()%8));
            if(capture)s.append('x');
            s.append(Move.squareName(move.to()));
            if(move.promotion()!='\0')s.append('=').append(Character.toUpperCase(move.promotion()));
        }
        if(after.inCheck(after.turn()))s.append(after.legalMoves().isEmpty()?'#':'+');
        return s.toString();
    }
    public String notation(Move move) { return notation(board,move,board.play(move),board.legalMoves()); }
    public String pgn() {
        StringBuilder s=new StringBuilder("[Event \"Java Chess\"]\n[Site \"Local\"]\n[Date \"");
        s.append(LocalDate.now().toString().replace('-','.')).append("\"]\n[Round \"-\"]\n[White \"White\"]\n[Black \"Black\"]\n[Result \"")
            .append(result()).append("\"]\n");
        if(!initial.toFen().equals(Board.START_FEN))s.append("[SetUp \"1\"]\n[FEN \"").append(initial.toFen()).append("\"]\n");
        s.append('\n');
        for(int i=0;i<history.size();i++) {
            PlayedMove p=history.get(i);
            if(p.before().turn()==Side.WHITE)s.append(p.before().fullmoveNumber()).append(". ");
            else if(i==0)s.append(p.before().fullmoveNumber()).append("... ");
            s.append(p.notation()).append(' ');
        }
        return s.append(result()).append('\n').toString();
    }
    public void save(Path path) throws IOException {
        Properties p=new Properties();p.setProperty("format","java-chess-1");p.setProperty("initial",initial.toFen());
        p.setProperty("moves",String.join(" ",history.stream().map(m->m.move().uci()).toList()));
        p.setProperty("end",end.name());
        if(intendedClaim!=null)p.setProperty("claimMove",intendedClaim.uci());
        Path target=path.toAbsolutePath(),temp=Files.createTempFile(target.getParent(),".chess-save-",".tmp");
        try {
            try(Writer w=Files.newBufferedWriter(temp,StandardCharsets.UTF_8)){p.store(w,"Java Chess saved game");}
            try { Files.move(temp,target,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE); }
            catch(AtomicMoveNotSupportedException e){Files.move(temp,target,StandardCopyOption.REPLACE_EXISTING);}
        } finally { Files.deleteIfExists(temp); }
    }
    public static ChessGame load(Path path) throws IOException {
        if(Files.size(path)>1_000_000)throw new IOException("This save file is too large");
        Properties p=new Properties();try(Reader r=Files.newBufferedReader(path,StandardCharsets.UTF_8)){p.load(r);}
        try {
            if(!"java-chess-1".equals(p.getProperty("format")))throw new IllegalArgumentException("Unsupported save format");
            ChessGame game=new ChessGame(Board.fromFen(p.getProperty("initial","")));
            String moves=p.getProperty("moves","").trim();
            if(!moves.isEmpty())for(String m:moves.split("\\s+"))game.play(Move.fromUci(m));
            End stored=End.valueOf(p.getProperty("end","NONE"));
            if(stored!=game.end) {
                if(game.isOver())throw new IllegalArgumentException("Save result contradicts the final position");
                switch(stored) {
                    case WHITE_RESIGNED -> game.resign(Side.WHITE);
                    case BLACK_RESIGNED -> game.resign(Side.BLACK);
                    case AGREED -> game.agreeDraw();
                    case FIFTY_MOVE, THREEFOLD -> {
                        if(p.containsKey("claimMove"))game.claimDraw(Move.fromUci(p.getProperty("claimMove")));
                        else game.claimDraw();
                        if(game.end!=stored)throw new IllegalArgumentException("Invalid draw claim");
                    }
                    default -> throw new IllegalArgumentException("Invalid saved result");
                }
            }
            return game;
        } catch(RuntimeException e) { throw new IOException("Invalid chess save: "+e.getMessage(),e); }
    }
}
