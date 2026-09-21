package com.chess.ai;

import com.chess.board.*;
import com.chess.board.Piece.Side;
import java.util.*;
import java.util.function.BooleanSupplier;

/** Small built-in opponent: iterative deepening, alpha-beta, and capture search. */
public final class ComputerPlayer {
    public enum Level {
        EASY("Easy",1,250), NORMAL("Normal",3,1200), HARD("Hard",4,2500);
        final int depth,millis;final String label;
        Level(String label,int depth,int millis){this.label=label;this.depth=depth;this.millis=millis;}
        @Override public String toString(){return label;}
    }
    private static final int MATE=100000,INF=1000000;
    private long deadline;
    private BooleanSupplier cancelled;
    private long nodes;
    private final Map<String,Integer> counts=new HashMap<>();
    private static final class Stop extends RuntimeException {
        private Stop(){super(null,null,false,false);}
    }
    public Move choose(Board board,Map<String,Integer> history,Level level,BooleanSupplier cancelled) {
        this.cancelled=cancelled;deadline=System.nanoTime()+level.millis*1_000_000L;nodes=0;
        counts.clear();counts.putAll(history);
        List<Move> legal=ordered(board,board.legalMoves());
        if(legal.isEmpty())return null;
        Move best=legal.get(0);
        for(int depth=1;depth<=level.depth;depth++) {
            try {
                Move iterationBest=best;int scoreBest=-INF,alpha=-INF;
                List<Move> candidates=new ArrayList<>(legal);candidates.remove(best);candidates.add(0,best);
                for(Move move:candidates) {
                    checkTime();Board next=board.applyUnchecked(move);String key=next.repetitionKey();enter(key);
                    int score;
                    try { score=-search(next,depth-1,-INF,-alpha,1); } finally { leave(key); }
                    if(score>scoreBest){scoreBest=score;iterationBest=move;}
                    alpha=Math.max(alpha,score);
                }
                best=iterationBest;
                if(scoreBest>MATE-100)break;
            } catch(Stop e){break;}
        }
        return cancelled.getAsBoolean()?null:best;
    }
    private void enter(String key){counts.merge(key,1,Integer::sum);}
    private void leave(String key){counts.compute(key,(k,n)->n==null||n<=1?null:n-1);}
    private void checkTime() {
        if(cancelled.getAsBoolean() || Thread.currentThread().isInterrupted() || System.nanoTime()>=deadline)throw new Stop();
    }
    private int search(Board board,int depth,int alpha,int beta,int ply) {
        nodes++;checkTime();
        List<Move> legal=board.legalMoves();
        if(legal.isEmpty())return board.inCheck(board.turn())?-MATE+ply:0;
        if(board.insufficientMaterial() || board.halfmoveClock()>=100 || counts.getOrDefault(board.repetitionKey(),0)>=3)return 0;
        if(depth<=0)return quiet(board,legal,alpha,beta,ply,4);
        int best=-INF;
        for(Move move:ordered(board,legal)) {
            Board next=board.applyUnchecked(move);String key=next.repetitionKey();enter(key);
            int score;
            try { score=-search(next,depth-1,-beta,-alpha,ply+1); } finally { leave(key); }
            best=Math.max(best,score);alpha=Math.max(alpha,score);
            if(alpha>=beta)break;
        }
        return best;
    }
    private int quiet(Board board,List<Move> legal,int alpha,int beta,int ply,int remaining) {
        checkTime();
        boolean check=board.inCheck(board.turn());
        int stand=evaluate(board);
        if(remaining<=0)return stand;
        if(!check){if(stand>=beta)return stand;alpha=Math.max(alpha,stand);}
        for(Move move:ordered(board,legal)) {
            if(!check && !board.isCapture(move) && move.promotion()=='\0')continue;
            Board next=board.applyUnchecked(move);String key=next.repetitionKey();enter(key);
            int score;
            try {
                List<Move> replies=next.legalMoves();
                if(replies.isEmpty())score=next.inCheck(next.turn())?MATE-ply-1:0;
                else if(next.insufficientMaterial() || next.halfmoveClock()>=100 || counts.getOrDefault(key,0)>=3)score=0;
                else score=-quiet(next,replies,-beta,-alpha,ply+1,remaining-1);
            } finally {leave(key);}
            if(score>=beta)return score;
            alpha=Math.max(alpha,score);
        }
        return alpha;
    }
    private List<Move> ordered(Board board,List<Move> moves) {
        List<Move> result=new ArrayList<>(moves);
        result.sort(Comparator.comparingInt((Move m)->priority(board,m)).reversed());return result;
    }
    private int priority(Board board,Move move) {
        Piece attacker=board.pieceAt(move.from()),victim=board.pieceAt(move.to());
        return (board.isCapture(move)?10*(victim==null?100:victim.type().value)-attacker.type().value:0)
            +(move.promotion()=='\0'?0:Piece.fromFen(move.promotion()).type().value);
    }
    private int evaluate(Board board) {
        int total=0;
        for(int sq=0;sq<64;sq++) {
            Piece p=board.pieceAt(sq);if(p==null)continue;
            int advance=p.side()==Side.WHITE?6-sq/8:sq/8-1;
            int center=7-Math.abs(2*(sq%8)-7)-Math.abs(2*(sq/8)-7);
            int bonus=switch(p.type()) {
                case PAWN -> advance*9;
                case KNIGHT -> center*9;
                case BISHOP -> center*5;
                case ROOK -> advance*2;
                case QUEEN -> center*2;
                case KING -> 0;
            };
            total+=(p.side()==Side.WHITE?1:-1)*(p.type().value+bonus);
        }
        return board.turn()==Side.WHITE?total:-total;
    }
}
