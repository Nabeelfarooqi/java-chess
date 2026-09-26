package com.chess;

import com.chess.board.*;
import com.chess.board.Piece.Side;
import com.chess.game.ChessGame;
import com.chess.game.AtomicFiles;
import com.chess.ai.ComputerPlayer;
import com.chess.ui.GamePanel;
import javax.swing.*;
import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import java.time.LocalDate;

/** Dependency-free regression suite. Throws on failure; does not require -ea. */
public final class ChessTests {
    private static int checks;
    private static void equal(Object actual,Object expected,String label) {
        checks++;if(!Objects.equals(actual,expected))throw new AssertionError(label+": expected "+expected+", got "+actual);
    }
    private static void truth(boolean value,String label){equal(value,true,label);}
    private static void rejects(Runnable code,String label){checks++;try{code.run();}catch(IllegalArgumentException|IllegalStateException e){return;}throw new AssertionError(label);}
    private static boolean contains(Board b,String move){return b.legalMoves().contains(Move.fromUci(move));}
    private static long perft(Board b,int depth){if(depth==0)return 1;long n=0;for(Move m:b.legalMoves())n+=perft(b.applyUnchecked(m),depth-1);return n;}
    private static void play(ChessGame game,String...moves){for(String m:moves)game.play(Move.fromUci(m));}
    public static void main(String[] args) throws Exception {
        Board initial=Board.initial();equal(initial.toFen(),Board.START_FEN,"FEN round trip");
        equal(perft(initial,1),20L,"start perft 1");equal(perft(initial,2),400L,"start perft 2");
        equal(perft(initial,3),8902L,"start perft 3");equal(perft(initial,4),197281L,"start perft 4");
        Board kiwi=Board.fromFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
        equal(perft(kiwi,1),48L,"Kiwipete perft 1");equal(perft(kiwi,2),2039L,"Kiwipete perft 2");equal(perft(kiwi,3),97862L,"Kiwipete perft 3");
        Board endgame=Board.fromFen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1");
        equal(perft(endgame,1),14L,"endgame perft 1");equal(perft(endgame,2),191L,"endgame perft 2");equal(perft(endgame,3),2812L,"endgame perft 3");
        Board promotionPosition=Board.fromFen("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1");
        equal(perft(promotionPosition,1),6L,"promotion/check perft 1");equal(perft(promotionPosition,2),264L,"promotion/check perft 2");equal(perft(promotionPosition,3),9467L,"promotion/check perft 3");
        rejects(()->initial.play(Move.fromUci("e2e5")),"illegal pawn leap rejected");
        rejects(()->initial.play(Move.fromUci("e7e5")),"wrong turn rejected");
        truth(initial.tileAt(Move.square("a1")).isTileOccupied(),"original occupied tile works");
        truth(!initial.tileAt(Move.square("e4")).isTileOccupied(),"original empty tile works");
        Board pin=Board.fromFen("4r1k1/8/8/8/8/8/4R3/4K3 w - - 0 1");
        truth(!contains(pin,"e2d2"),"cannot expose king");
        Board kings=Board.fromFen("8/8/8/8/8/4k3/8/4K3 w - - 0 1");
        truth(!contains(kings,"e1e2"),"kings cannot become adjacent");
        Board castle=Board.fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
        truth(contains(castle,"e1g1")&&contains(castle,"e1c1"),"both castles available");
        Board castled=castle.play(Move.fromUci("e1g1"));equal(castled.pieceChar(61),'R',"castle moves rook");equal(castled.pieceChar(63),'.',"rook origin cleared");
        truth(!castled.toFen().split(" ")[2].contains("K"),"king move removes rights");
        Board attackedTransit=Board.fromFen("r3kr1r/8/8/8/8/8/8/R3K2R w KQ - 0 1");
        truth(!contains(attackedTransit,"e1g1"),"cannot castle through attack");
        Board checkedCastle=Board.fromFen("4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1");
        truth(!contains(checkedCastle,"e1g1")&&!contains(checkedCastle,"e1c1"),"cannot castle out of check");
        Board rookCaptured=castle.play(Move.fromUci("a1a8"));truth(!rookCaptured.toFen().split(" ")[2].contains("q"),"captured rook removes right");
        Board movedRook=castle.play(Move.fromUci("h1h2")).play(Move.fromUci("a8a7")).play(Move.fromUci("h2h1"));
        truth(!movedRook.toFen().split(" ")[2].contains("K"),"returning rook cannot restore castling");
        Board ep=Board.fromFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
        truth(contains(ep,"e5d6"),"en passant offered");Board captured=ep.play(Move.fromUci("e5d6"));
        equal(captured.pieceChar(Move.square("d5")),'.',"en passant removes bypassed pawn");equal(captured.pieceChar(Move.square("d6")),'P',"en passant landing");
        equal(ep.play(Move.fromUci("e1f1")).enPassantSquare(),-1,"en passant expires immediately");
        Board pinnedEp=Board.fromFen("4r1k1/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
        truth(!contains(pinnedEp,"e5d6"),"en passant cannot expose check");
        Board noEp=Board.fromFen("4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1");
        truth(!ep.repetitionKey().equals(noEp.repetitionKey()),"legal en passant changes repetition key");
        Board noPinnedEp=Board.fromFen("4r1k1/8/8/3pP3/8/8/8/4K3 w - - 0 1");
        equal(pinnedEp.repetitionKey(),noPinnedEp.repetitionKey(),"illegal en passant does not change repetition key");
        Board promote=Board.fromFen("7k/P7/8/8/8/8/8/7K w - - 0 1");
        equal(promote.legalMovesFrom(Move.square("a7")).size(),4,"four promotion choices");
        equal(promote.play(Move.fromUci("a7a8n")).pieceChar(0),'N',"underpromotion applied");
        rejects(()->promote.play(Move.fromUci("a7a8")),"promotion choice required");
        ChessGame mate=new ChessGame();play(mate,"f2f3","e7e5","g2g4","d8h4");
        equal(mate.end(),ChessGame.End.CHECKMATE,"Fool's mate");equal(mate.result(),"0-1","checkmate result");equal(mate.history().get(3).notation(),"Qh4#","mate SAN");
        rejects(()->mate.play(Move.fromUci("e2e4")),"cannot play after game over");mate.undo();truth(!mate.isOver(),"undo reopens game");
        ChessGame stale=new ChessGame(Board.fromFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"));equal(stale.end(),ChessGame.End.STALEMATE,"stalemate");
        truth(Board.fromFen("7k/8/8/8/8/8/8/7K w - - 0 1").insufficientMaterial(),"bare kings");
        truth(Board.fromFen("7k/8/8/8/8/8/8/5N1K w - - 0 1").insufficientMaterial(),"single knight");
        truth(!Board.fromFen("7k/8/8/8/8/8/8/4NN1K w - - 0 1").insufficientMaterial(),"two knights not automatically dead");
        ChessGame repeating=new ChessGame();String[] cycle={"g1f3","g8f6","f3g1","f6g8"};play(repeating,cycle);play(repeating,cycle);
        truth(repeating.canClaimDraw(),"threefold claim available");truth(!repeating.isOver(),"threefold is not automatic");
        repeating.claimDraw();equal(repeating.end(),ChessGame.End.THREEFOLD,"threefold claim");repeating.undo();truth(!repeating.isOver(),"undo claimed draw");
        for(int i=0;i<3;i++)play(repeating,i==0?new String[]{"f6g8"}:cycle);
        equal(repeating.end(),ChessGame.End.FIVEFOLD,"fivefold automatic");
        ChessGame fifty=new ChessGame(Board.fromFen("7k/8/8/8/8/8/R7/7K w - - 100 51"));truth(fifty.canClaimDraw(),"50-move claim available");fifty.claimDraw();equal(fifty.end(),ChessGame.End.FIFTY_MOVE,"50-move result");
        ChessGame seventyFive=new ChessGame(Board.fromFen("7k/8/8/8/8/8/R7/7K w - - 149 75"));play(seventyFive,"a2a3");equal(seventyFive.end(),ChessGame.End.SEVENTY_FIVE,"75 moves automatic");
        ChessGame matePriority=new ChessGame(Board.fromFen("7k/5K2/6Q1/8/8/8/8/8 w - - 149 75"));play(matePriority,"g6g7");equal(matePriority.end(),ChessGame.End.CHECKMATE,"mate precedes 75-move draw");
        ChessGame san=new ChessGame();play(san,"e2e4","d7d5","e4d5");equal(san.history().get(2).notation(),"exd5","pawn capture SAN");
        ChessGame ambiguity=new ChessGame(Board.fromFen("4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1"));play(ambiguity,"b1d2");equal(ambiguity.history().get(0).notation(),"Nbd2","SAN disambiguation");
        ChessGame castlingSan=new ChessGame(castle);play(castlingSan,"e1c1");equal(castlingSan.history().get(0).notation(),"O-O-O","castling SAN");
        Path temp=Files.createTempFile("java-chess-test-",".chess");
        try {
            san.save(temp);ChessGame loaded=ChessGame.load(temp);equal(loaded.board().toFen(),san.board().toFen(),"save/load board");equal(loaded.pgn(),san.pgn(),"save/load history");
            ChessGame intended=new ChessGame();play(intended,cycle);play(intended,"g1f3","g8f6","f3g1");
            truth(intended.drawClaimMoves().contains(Move.fromUci("f6g8")),"intended move claim available");
            intended.claimDraw(Move.fromUci("f6g8"));intended.save(temp);equal(ChessGame.load(temp).end(),ChessGame.End.THREEFOLD,"intended claim survives save/load");
            san.resign(Side.WHITE);san.save(temp);equal(ChessGame.load(temp).result(),"0-1","resignation survives save/load");
            Files.writeString(temp,"format=java-chess-1\ninitial="+Board.START_FEN+"\nmoves=e2e5\nend=NONE\n");
            checks++;try{ChessGame.load(temp);throw new AssertionError("illegal save accepted");}catch(java.io.IOException expected){ }
        } finally{Files.deleteIfExists(temp);}
        Move chosen=new ComputerPlayer().choose(initial,Map.of(initial.repetitionKey(),1),ComputerPlayer.Level.EASY,()->false);
        truth(initial.legalMoves().contains(chosen),"computer returns legal move");
        Board tactic=Board.fromFen("7k/5K2/6Q1/8/8/8/8/8 w - - 0 1");
        Move winning=new ComputerPlayer().choose(tactic,Map.of(tactic.repetitionKey(),1),ComputerPlayer.Level.NORMAL,()->false);
        Board finalBoard=tactic.play(winning);truth(finalBoard.inCheck(finalBoard.turn())&&finalBoard.legalMoves().isEmpty(),"computer finds mate in one");
        equal(new ComputerPlayer().choose(initial,Map.of(),ComputerPlayer.Level.HARD,()->true),null,"computer cancellation");
        persistenceChecks();
        computerClaimChecks();
        uiChecks(args.length>0?args[0]:null);
        asyncFileChecks();
        failedFileUiChecks();
        computerClaimUiChecks();
        System.out.println("PASS — "+checks+" checks, including 4 reference perft positions, special moves, draw rules, saves, AI, and Swing interactions.");
    }
    private static void persistenceChecks() throws Exception {
        Path path=Files.createTempFile("chess-io-",".chess");
        try {
            for(String invalid:new String[]{"format=\\uZZZZ", "format=\\u12", "format=java-chess-1\ninitial="+Board.START_FEN+"\nend=UNKNOWN", "format=java-chess-1\ninitial="+Board.START_FEN+"\ndate=not-a-date"}){
                Files.writeString(path,invalid);checks++;
                try{ChessGame.load(path);throw new AssertionError("Malformed save accepted");}catch(java.io.IOException expected){ }
            }
            Files.writeString(path,"format=java-chess-1\ninitial="+Board.START_FEN+"\nmoves=\nend=NONE");
            truth(ChessGame.load(path).pgn().contains("[Date \"????.??.??\"]"),"legacy save date remains unknown");
            ChessGame dated=new ChessGame(Board.initial(),LocalDate.of(2024,1,2));play(dated,"e2e4");
            ChessGame snapshot=dated.snapshot();play(dated,"e7e5");snapshot.save(path);
            ChessGame loaded=ChessGame.load(path);equal(loaded.plyCount(),1,"save snapshot detached from later moves");
            truth(loaded.pgn().contains("[Date \"2024.01.02\"]"),"original date survives save/load/export");
            Files.writeString(path,"original");checks++;
            try{AtomicFiles.write(path,writer->{writer.write("partial");throw new java.io.IOException("disk fault");});throw new AssertionError("write failure lost");}catch(java.io.IOException expected){ }
            equal(Files.readString(path),"original","failed atomic export keeps prior contents");
            loaded.exportPgn(path);equal(Files.readString(path),loaded.pgn(),"atomic PGN export");
        }finally{Files.deleteIfExists(path);}
    }
    private static void computerClaimChecks() {
        for(int halfmove:new int[]{99,100,149}){
            Board mate=Board.fromFen("7k/5K2/6Q1/8/8/8/8/8 w - - "+halfmove+" 75");
            ComputerPlayer.Decision decision=new ComputerPlayer().decide(mate,Map.of(mate.repetitionKey(),3),ComputerPlayer.Level.NORMAL,()->false);
            truth(decision instanceof ComputerPlayer.Play,"mate preferred to optional current/intended claim");
            Board after=mate.play(((ComputerPlayer.Play)decision).move());truth(after.inCheck(after.turn())&&after.legalMoves().isEmpty(),"selected move checkmates despite claim");
        }
        for(int halfmove:new int[]{99,100}) {
            Board losing=Board.fromFen("4q2k/8/8/8/8/8/R7/7K w - - "+halfmove+" 51");
            ComputerPlayer.Decision decision=new ComputerPlayer().decide(losing,Map.of(losing.repetitionKey(),1),ComputerPlayer.Level.NORMAL,()->false);
            truth(decision instanceof ComputerPlayer.Claim,"losing computer can select draw");
            ComputerPlayer.Claim claim=(ComputerPlayer.Claim)decision;
            equal(claim.intended()==null,halfmove==100,"typed claim distinguishes current and intended position");
            ChessGame game=new ChessGame(losing);if(claim.intended()==null)game.claimDraw();else game.claimDraw(claim.intended());
            equal(game.plyCount(),0,"intended AI claim never executes its move");equal(game.board().toFen(),losing.toFen(),"AI draw claim preserves position");
        }
        Board initial=Board.initial();
        equal(new ComputerPlayer().decide(initial,Map.of(initial.repetitionKey(),5),ComputerPlayer.Level.EASY,()->false),null,"AI stops at automatic fivefold draw");
        Board automatic=Board.fromFen("4q2k/8/8/8/8/8/R7/7K w - - 150 76");
        equal(new ComputerPlayer().decide(automatic,Map.of(),ComputerPlayer.Level.EASY,()->false),null,"AI stops at automatic 75-move draw");
    }
    private static void computerClaimUiChecks() throws Exception {
        Path path=Files.createTempFile("chess-ai-load-",".chess");GamePanel[] panel={null};
        try{
            SwingUtilities.invokeAndWait(()->{panel[0]=new GamePanel();panel[0].startNewGame(true,Side.BLACK,ComputerPlayer.Level.NORMAL);});
            for(boolean mate:new boolean[]{true,false}){
                new ChessGame(Board.fromFen(mate?"7k/5K2/6Q1/8/8/8/8/8 w - - 99 75":"4q2k/8/8/8/8/8/R7/7K w - - 99 51")).save(path);
                SwingUtilities.invokeAndWait(()->panel[0].loadFrom(path));
                awaitUi(()->panel[0].game().isOver()&&!panel[0].isLoading()&&!panel[0].isThinking(),"loaded AI turn finishes");
                SwingUtilities.invokeAndWait(()->{
                    equal(panel[0].game().end(),mate?ChessGame.End.CHECKMATE:ChessGame.End.FIFTY_MOVE,"UI applies play or claim decision");
                    equal(panel[0].game().plyCount(),mate?1:0,"UI intended claim does not add a ply");
                });
            }
        }finally{SwingUtilities.invokeAndWait(()->{if(panel[0]!=null){panel[0].cancelComputer();panel[0].cancelFileOperations();}});Files.deleteIfExists(path);}
    }
    private static void awaitUi(BooleanSupplier done,String label) throws Exception {
        long deadline=System.nanoTime()+5_000_000_000L;boolean[] finished={false};
        while(!finished[0]&&System.nanoTime()<deadline){SwingUtilities.invokeAndWait(()->finished[0]=done.getAsBoolean());if(!finished[0])Thread.sleep(20);}
        truth(finished[0],label);
    }
    private static void asyncFileChecks() throws Exception {
        CountDownLatch loadEntered=new CountDownLatch(1),releaseLoad=new CountDownLatch(1),saveEntered=new CountDownLatch(1),releaseSave=new CountDownLatch(1);
        ChessGame[] saved={null};boolean[] offThread={false,false};GamePanel[] panel={null};
        ChessGame loaded=new ChessGame();play(loaded,"d2d4");
        GamePanel.FileOperations io=new GamePanel.FileOperations(){
            public ChessGame load(Path path) throws java.io.IOException {
                offThread[0]=!SwingUtilities.isEventDispatchThread();loadEntered.countDown();
                // An uncooperative storage operation can finish after cancellation.
                boolean released=false;while(!released)try{releaseLoad.await();released=true;}catch(InterruptedException ignored){ }
                return loaded;
            }
            public void save(ChessGame snapshot,Path path,boolean pgn) throws java.io.IOException {
                offThread[1]=!SwingUtilities.isEventDispatchThread();saved[0]=snapshot;saveEntered.countDown();
                try{releaseSave.await();}catch(InterruptedException e){throw new java.io.InterruptedIOException("cancelled");}
            }
        };
        try {
            SwingUtilities.invokeAndWait(()->{GamePanel p=panel[0]=new GamePanel(io);p.startNewGame(false,Side.WHITE,ComputerPlayer.Level.EASY);p.squareClicked(Move.square("e2"));p.squareClicked(Move.square("e4"));p.saveTo(Path.of("synthetic.chess"),false);});
            truth(saveEntered.await(5,TimeUnit.SECONDS),"background save begins");
            SwingUtilities.invokeAndWait(()->{GamePanel p=panel[0];p.squareClicked(Move.square("e7"));p.squareClicked(Move.square("e5"));equal(p.game().plyCount(),2,"UI remains responsive during save");p.loadFrom(Path.of("synthetic.chess"));});
            truth(loadEntered.await(5,TimeUnit.SECONDS),"background load begins");
            SwingUtilities.invokeAndWait(()->{
                GamePanel p=panel[0];truth(p.isLoading(),"load progress reported");
                for(String label:new String[]{"Resign","Agree draw"}){
                    JButton action=findButton(p,label);truth(!action.isEnabled(),label+" cannot open a stale confirmation during load");action.doClick();
                }
                truth(!p.game().isOver(),"pending load cannot finish current game through disabled actions");
                p.startNewGame(false,Side.WHITE,ComputerPlayer.Level.EASY);equal(p.game().plyCount(),0,"new game can cancel slow load");
                truth(findButton(p,"Resign").isEnabled()&&findButton(p,"Agree draw").isEnabled(),"game actions recover after load cancellation");
            });
            releaseLoad.countDown();releaseSave.countDown();awaitUi(()->!panel[0].isSaving(),"background save finishes");
            SwingUtilities.invokeAndWait(()->equal(panel[0].game().plyCount(),0,"stale load cannot replace new game"));
            equal(saved[0].plyCount(),1,"background write owns the captured snapshot");truth(offThread[0]&&offThread[1],"file operations run off EDT");
        }finally{releaseLoad.countDown();releaseSave.countDown();SwingUtilities.invokeAndWait(()->{if(panel[0]!=null){panel[0].cancelComputer();panel[0].cancelFileOperations();}});}
    }
    private static void failedFileUiChecks() throws Exception {
        GamePanel[] panel={null};
        GamePanel.FileOperations failing=new GamePanel.FileOperations(){
            public ChessGame load(Path path) throws java.io.IOException{throw new java.io.IOException("invalid save");}
            public void save(ChessGame snapshot,Path path,boolean pgn) throws java.io.IOException{throw new java.io.IOException("disk unavailable");}
        };
        SwingUtilities.invokeAndWait(()->{
            GamePanel p=panel[0]=new GamePanel(failing);p.startNewGame(false,Side.WHITE,ComputerPlayer.Level.EASY);
            p.squareClicked(Move.square("e2"));p.squareClicked(Move.square("e4"));p.loadFrom(Path.of("bad.chess"));
        });
        awaitUi(()->!panel[0].isLoading(),"failed background load releases controls");
        SwingUtilities.invokeAndWait(()->{equal(panel[0].game().plyCount(),1,"failed background load preserves current game");panel[0].saveTo(Path.of("unavailable.pgn"),true);});
        awaitUi(()->!panel[0].isSaving(),"failed background save releases controls");
        SwingUtilities.invokeAndWait(()->{GamePanel p=panel[0];p.squareClicked(Move.square("e7"));p.squareClicked(Move.square("e5"));equal(p.game().plyCount(),2,"game remains playable after file errors");p.cancelComputer();p.cancelFileOperations();});
    }
    private static void layoutTree(Container c){c.doLayout();for(Component child:c.getComponents())if(child instanceof Container container)layoutTree(container);}
    private static JButton findButton(Container c,String text){
        for(Component child:c.getComponents()){
            if(child instanceof JButton button&&button.getText().equals(text))return button;
            if(child instanceof Container container){JButton found=findButton(container,text);if(found!=null)return found;}
        }
        return null;
    }
    private static void uiChecks(String render) throws Exception {
        GamePanel[] panel={null};
        SwingUtilities.invokeAndWait(()->{
            panel[0]=new GamePanel();GamePanel p=panel[0];p.startNewGame(false,Side.WHITE,ComputerPlayer.Level.NORMAL);
            p.setSize(1050,800);layoutTree(p);
            p.squareClicked(Move.square("e2"));p.squareClicked(Move.square("e4"));equal(p.game().plyCount(),1,"UI executes legal move");
            p.squareClicked(Move.square("e7"));p.squareClicked(Move.square("e4"));equal(p.game().plyCount(),1,"UI refuses illegal move");
            p.takeBack();equal(p.game().board().toFen(),Board.START_FEN,"UI takeback restores start");
            p.startNewGame(true,Side.WHITE,ComputerPlayer.Level.HARD);p.squareClicked(Move.square("e2"));p.squareClicked(Move.square("e4"));truth(p.isThinking(),"AI runs off event thread");
            p.startNewGame(false,Side.WHITE,ComputerPlayer.Level.NORMAL);truth(!p.isThinking(),"new game cancels search");
        });
        // Let the cancelled worker's done callback run, then verify it cannot mutate the new game.
        Thread.sleep(150);
        SwingUtilities.invokeAndWait(()->{
            GamePanel p=panel[0];equal(p.game().plyCount(),0,"stale AI cannot play into new game");
            for(String move:new String[]{"e2e4","e7e5","g1f3","b8c6","f1c4","g8f6"}){
                Move m=Move.fromUci(move);p.squareClicked(m.from());p.squareClicked(m.to());
            }
            p.squareClicked(Move.square("d2"));
            if(render!=null)try{
                BufferedImage image=new BufferedImage(1050,800,BufferedImage.TYPE_INT_RGB);Graphics2D g=image.createGraphics();p.paint(g);g.dispose();ImageIO.write(image,"png",Path.of(render).toFile());
            }catch(java.io.IOException e){throw new RuntimeException(e);}
            p.cancelComputer();
            p.startNewGame(true,Side.WHITE,ComputerPlayer.Level.EASY);
            p.squareClicked(Move.square("e2"));p.squareClicked(Move.square("e4"));
        });
        long deadline=System.nanoTime()+5_000_000_000L;
        boolean[] pending={true};
        while(pending[0] && System.nanoTime()<deadline) {
            Thread.sleep(30);
            SwingUtilities.invokeAndWait(()->pending[0]=panel[0].isThinking());
        }
        SwingUtilities.invokeAndWait(()->{
            GamePanel p=panel[0];truth(!p.isThinking(),"computer reply finishes");equal(p.game().plyCount(),2,"computer plays its reply on UI thread");
            p.takeBack();equal(p.game().plyCount(),0,"computer takeback restores human decision point");
            p.startNewGame(true,Side.BLACK,ComputerPlayer.Level.EASY);
        });
        deadline=System.nanoTime()+5_000_000_000L;pending[0]=true;
        while(pending[0] && System.nanoTime()<deadline) {
            Thread.sleep(30);
            SwingUtilities.invokeAndWait(()->pending[0]=panel[0].isThinking());
        }
        SwingUtilities.invokeAndWait(()->{
            GamePanel p=panel[0];equal(p.game().plyCount(),1,"computer opens when human chooses Black");
            equal(p.game().board().turn(),Side.BLACK,"human Black gets next turn");p.cancelComputer();
        });
    }
}
