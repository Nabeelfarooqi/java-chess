package com.chess.ui;

import com.chess.ai.ComputerPlayer;
import com.chess.board.*;
import com.chess.board.Piece.Side;
import com.chess.game.ChessGame;
import javax.swing.*;
import javax.swing.border.EmptyBorder;
import javax.swing.filechooser.FileNameExtensionFilter;
import java.awt.*;
import java.io.IOException;
import java.nio.file.*;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutionException;

/** Swing controller. Search runs in a cancellable worker on an immutable snapshot. */
public final class GamePanel extends JPanel {
    private static final Color BG=new Color(18,26,39),PANEL=new Color(27,38,54),TEXT=new Color(239,243,247),MUTED=new Color(154,168,185),ACCENT=new Color(137,205,171);
    private ChessGame game=new ChessGame();
    private boolean versusComputer=true,flipped=false,busy=false;
    private Side human=Side.WHITE;
    private ComputerPlayer.Level level=ComputerPlayer.Level.NORMAL;
    private int selected=-1;
    private long revision;
    private SwingWorker<ComputerPlayer.Decision,Void> worker;
    private SwingWorker<ChessGame,Void> loadWorker;
    private SwingWorker<Void,Void> saveWorker;
    private long fileRevision;
    public interface FileOperations {
        ChessGame load(Path path) throws IOException;
        void save(ChessGame snapshot,Path path,boolean pgn) throws IOException;
    }
    private final FileOperations files;
    private final BoardView boardView=new BoardView(this::squareClicked);
    private final JLabel status=new JLabel(),opponent=new JLabel(),material=new JLabel(),hint=new JLabel();
    private final DefaultListModel<String> moves=new DefaultListModel<>();
    private final JList<String> moveList=new JList<>(moves);
    private final JButton undo=new JButton("Take back"),resign=new JButton("Resign"),claim=new JButton("Claim draw"),agree=new JButton("Agree draw");
    private final JButton save=new JButton("Save game"),export=new JButton("Export PGN"),cancelFile=new JButton("Cancel file");
    private final JProgressBar progress=new JProgressBar();

    public GamePanel() {
        this(new FileOperations(){
            public ChessGame load(Path path) throws IOException{return ChessGame.load(path);}
            public void save(ChessGame snapshot,Path path,boolean pgn) throws IOException{if(pgn)snapshot.exportPgn(path);else snapshot.save(path);}
        });
    }
    public GamePanel(FileOperations files) {
        super(new BorderLayout(22,12));setBackground(BG);setBorder(new EmptyBorder(22,22,18,22));
        this.files=java.util.Objects.requireNonNull(files);
        JPanel heading=new JPanel(new BorderLayout());heading.setOpaque(false);
        JLabel title=new JLabel("JAVA CHESS");title.setForeground(TEXT);title.setFont(new Font(Font.SANS_SERIF,Font.BOLD,25));heading.add(title,BorderLayout.WEST);
        JLabel subtitle=new JLabel("Think ahead.  Make your move.");subtitle.setForeground(MUTED);heading.add(subtitle,BorderLayout.EAST);add(heading,BorderLayout.NORTH);
        boardView.setBackground(BG);add(boardView,BorderLayout.CENTER);
        JPanel side=new JPanel(new BorderLayout(0,16));side.setPreferredSize(new Dimension(285,600));side.setOpaque(false);
        JPanel gameInfo=new JPanel();gameInfo.setLayout(new BoxLayout(gameInfo,BoxLayout.Y_AXIS));gameInfo.setOpaque(false);
        JLabel tag=new JLabel("THE GAME");tag.setForeground(ACCENT);tag.setFont(new Font(Font.SANS_SERIF,Font.BOLD,11));gameInfo.add(tag);gameInfo.add(Box.createVerticalStrut(12));
        status.setForeground(TEXT);status.setFont(new Font(Font.SANS_SERIF,Font.BOLD,17));gameInfo.add(status);gameInfo.add(Box.createVerticalStrut(8));
        opponent.setForeground(MUTED);opponent.setFont(new Font(Font.SANS_SERIF,Font.PLAIN,12));gameInfo.add(opponent);gameInfo.add(Box.createVerticalStrut(8));
        material.setForeground(MUTED);gameInfo.add(material);gameInfo.add(Box.createVerticalStrut(14));
        progress.setIndeterminate(true);progress.setForeground(ACCENT);progress.setBackground(PANEL);progress.setMaximumSize(new Dimension(300,4));progress.setPreferredSize(new Dimension(285,4));gameInfo.add(progress);
        side.add(gameInfo,BorderLayout.NORTH);
        JPanel historyPanel=new JPanel(new BorderLayout(0,8));historyPanel.setOpaque(false);
        JLabel historyTitle=new JLabel("MOVE HISTORY     WHITE / BLACK");historyTitle.setFont(new Font(Font.SANS_SERIF,Font.BOLD,11));historyTitle.setForeground(MUTED);historyPanel.add(historyTitle,BorderLayout.NORTH);
        moveList.setBackground(PANEL);moveList.setForeground(TEXT);moveList.setFont(new Font(Font.MONOSPACED,Font.PLAIN,15));moveList.setFixedCellHeight(33);moveList.setBorder(new EmptyBorder(6,10,6,10));moveList.setSelectionBackground(new Color(48,70,80));
        JScrollPane scroll=new JScrollPane(moveList);scroll.setBorder(BorderFactory.createEmptyBorder());scroll.getViewport().setBackground(PANEL);historyPanel.add(scroll);side.add(historyPanel);
        JPanel bottom=new JPanel();bottom.setLayout(new BoxLayout(bottom,BoxLayout.Y_AXIS));bottom.setOpaque(false);
        JPanel buttons=new JPanel(new GridLayout(0,2,8,8));buttons.setOpaque(false);
        addButton(buttons,new JButton("New game"),this::newGameDialog);addButton(buttons,undo,this::takeBack);
        addButton(buttons,new JButton("Flip board"),()->{flipped=!flipped;refresh();});addButton(buttons,save,this::saveGame);
        addButton(buttons,new JButton("Load game"),this::loadGame);addButton(buttons,export,this::exportPgn);
        addButton(buttons,claim,this::claimDraw);addButton(buttons,agree,this::agreeDraw);
        addButton(buttons,resign,this::resign);addButton(buttons,new JButton("How to play"),this::help);
        addButton(buttons,cancelFile,()->{cancelFileOperations();refresh();startComputer();});
        bottom.add(buttons);bottom.add(Box.createVerticalStrut(12));hint.setForeground(MUTED);hint.setFont(new Font(Font.SANS_SERIF,Font.PLAIN,11));bottom.add(hint);side.add(bottom,BorderLayout.SOUTH);add(side,BorderLayout.EAST);
        JLabel footer=new JLabel("Select a piece to see legal moves  ·  Arrow keys + Enter to move  ·  Esc to clear");footer.setForeground(MUTED);footer.setFont(new Font(Font.SANS_SERIF,Font.PLAIN,12));add(footer,BorderLayout.SOUTH);
        refresh();
    }
    private void addButton(JPanel parent,JButton button,Runnable action) {
        button.setFocusPainted(false);button.setBackground(PANEL);button.setForeground(TEXT);button.setFont(new Font(Font.SANS_SERIF,Font.PLAIN,12));button.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(new Color(57,73,91)),new EmptyBorder(10,5,10,5)));button.addActionListener(e->action.run());parent.add(button);
    }
    private boolean humanTurn(){return !versusComputer || game.board().turn()==human;}
    public void squareClicked(int square) {
        if(square<0){selected=-1;refresh();return;}
        if(busy || loadWorker!=null || game.isOver() || !humanTurn())return;
        Board b=game.board();
        if(selected==square){selected=-1;refresh();return;}
        if(selected>=0) {
            List<Move> candidates=b.legalMovesFrom(selected).stream().filter(m->m.to()==square).toList();
            if(!candidates.isEmpty()) {
                Move move=candidates.get(0);
                if(candidates.size()>1) {
                    String[] choices={"Queen","Rook","Bishop","Knight"};
                    int choice=JOptionPane.showOptionDialog(this,"Choose your promoted piece.","Pawn promotion",JOptionPane.DEFAULT_OPTION,JOptionPane.QUESTION_MESSAGE,null,choices,choices[0]);
                    if(choice<0)return;
                    char p="qrbn".charAt(choice);move=candidates.stream().filter(m->m.promotion()==p).findFirst().orElseThrow();
                }
                game.play(move);revision++;selected=-1;refresh();startComputer();return;
            }
        }
        selected=Board.isSide(b.pieceChar(square),b.turn())?square:-1;refresh();
    }
    private void startComputer() {
        if(!versusComputer || game.isOver() || humanTurn() || busy || loadWorker!=null)return;
        final Board snapshot=game.board();final Map<String,Integer> counts=game.repetitionCounts();final long generation=revision;
        final ComputerPlayer.Level strength=level;
        busy=true;refresh();
        worker=new SwingWorker<>() {
            @Override protected ComputerPlayer.Decision doInBackground(){return new ComputerPlayer().decide(snapshot,counts,strength,this::isCancelled);}
            @Override protected void done() {
                if(generation!=revision || isCancelled())return;
                busy=false;worker=null;
                try {
                    ComputerPlayer.Decision decision=get();
                    if(decision!=null && !game.isOver()) {
                        if(decision instanceof ComputerPlayer.Play play)game.play(play.move());
                        else if(decision instanceof ComputerPlayer.Claim draw) {
                            if(draw.intended()==null)game.claimDraw();else game.claimDraw(draw.intended());
                        }
                        revision++;
                    }
                }
                catch(CancellationException ignored){ }
                catch(InterruptedException e){Thread.currentThread().interrupt();}
                catch(ExecutionException | RuntimeException e){showError("The computer could not finish its move. Take back or start a new game.\n"+e.getMessage());}
                refresh();
            }
        };
        worker.execute();
    }
    public void cancelComputer(){revision++;if(worker!=null)worker.cancel(true);worker=null;busy=false;cancelLoad();}
    private void cancelLoad(){if(loadWorker!=null)loadWorker.cancel(true);loadWorker=null;}
    public void cancelFileOperations(){if(loadWorker!=null)revision++;fileRevision++;cancelLoad();if(saveWorker!=null)saveWorker.cancel(true);saveWorker=null;}
    private void refresh() {
        Board b=game.board();List<ChessGame.PlayedMove> log=game.history();
        List<Move> legal=selected<0?List.of():b.legalMovesFrom(selected);
        boardView.showPosition(b,selected,legal,log.isEmpty()?null:log.get(log.size()-1).move(),flipped);
        status.setText("<html>"+(loadWorker!=null?"Loading saved game…":busy?"Computer thinking…":game.status())+"</html>");
        status.setForeground(game.isOver()?ACCENT:TEXT);
        opponent.setText(versusComputer?"You: "+human.label()+"  ·  Computer: "+level:"Local two-player game");
        int white=0,black=0;
        for(int sq=0;sq<64;sq++){Piece p=b.pieceAt(sq);if(p!=null && p.type()!=Piece.Type.KING){if(p.side()==Side.WHITE)white+=p.type().value;else black+=p.type().value;}}
        material.setText(white==black?"Material is even":String.format("%s +%.1f material",white>black?"White":"Black",Math.abs(white-black)/100.0));
        moves.clear();
        for(int i=0;i<log.size();) {
            ChessGame.PlayedMove move=log.get(i++);String row;
            if(move.before().turn()==Side.WHITE) {
                row=String.format("%2d.  %-9s",move.before().fullmoveNumber(),move.notation());
                if(i<log.size() && log.get(i).before().turn()==Side.BLACK)row+=log.get(i++).notation();
            } else row=String.format("%2d.  %-9s%s",move.before().fullmoveNumber(),"…",move.notation());
            moves.addElement(row);
        }
        if(!moves.isEmpty())moveList.ensureIndexIsVisible(moves.size()-1);
        undo.setEnabled(game.plyCount()>0);resign.setEnabled(loadWorker==null&&!game.isOver());agree.setEnabled(loadWorker==null&&!game.isOver()&&!versusComputer);
        claim.setEnabled(!busy&&loadWorker==null&&!game.isOver()&&humanTurn()&&(game.canClaimDraw()||!game.drawClaimMoves().isEmpty()));
        save.setEnabled(saveWorker==null);export.setEnabled(saveWorker==null);cancelFile.setVisible(loadWorker!=null||saveWorker!=null);
        progress.setVisible(busy||loadWorker!=null||saveWorker!=null);hint.setText(saveWorker!=null?"Writing saved snapshot…":game.isOver()?"Result: "+game.result():"Move "+b.fullmoveNumber()+"  ·  "+(versusComputer?"Practice mode":"Pass and play"));
    }
    private boolean confirmReplace() {
        return game.plyCount()==0 || JOptionPane.showConfirmDialog(this,"Replace the current game? Save it first if you want to keep it.","Replace game",JOptionPane.YES_NO_OPTION)==JOptionPane.YES_OPTION;
    }
    public void newGameDialog() {
        JComboBox<String> mode=new JComboBox<>(new String[]{"Play computer","Two players"});mode.setSelectedIndex(versusComputer?0:1);
        JComboBox<String> color=new JComboBox<>(new String[]{"White","Black"});color.setSelectedIndex(human==Side.WHITE?0:1);
        JComboBox<ComputerPlayer.Level> difficulty=new JComboBox<>(ComputerPlayer.Level.values());difficulty.setSelectedItem(level);
        JPanel form=new JPanel(new GridLayout(0,2,12,12));form.add(new JLabel("Mode"));form.add(mode);form.add(new JLabel("Your pieces"));form.add(color);form.add(new JLabel("Computer level"));form.add(difficulty);
        mode.addActionListener(e->{color.setEnabled(mode.getSelectedIndex()==0);difficulty.setEnabled(mode.getSelectedIndex()==0);});color.setEnabled(versusComputer);difficulty.setEnabled(versusComputer);
        if(JOptionPane.showConfirmDialog(this,form,"New game",JOptionPane.OK_CANCEL_OPTION,JOptionPane.PLAIN_MESSAGE)!=JOptionPane.OK_OPTION || !confirmReplace())return;
        startNewGame(mode.getSelectedIndex()==0,color.getSelectedIndex()==0?Side.WHITE:Side.BLACK,(ComputerPlayer.Level)difficulty.getSelectedItem());
    }
    public void takeBack() {
        cancelComputer();
        game.undo();
        if(versusComputer)while(game.plyCount()>0 && game.board().turn()!=human)game.undo();
        selected=-1;refresh();startComputer();
    }
    private void resign() {
        if(loadWorker!=null || game.isOver())return;
        final ChessGame confirmedGame=game;
        Side side=versusComputer?human:game.board().turn();
        if(JOptionPane.showConfirmDialog(this,side.label()+" resigns this game?","Resign",JOptionPane.YES_NO_OPTION)!=JOptionPane.YES_OPTION)return;
        if(game!=confirmedGame || loadWorker!=null || game.isOver())return;
        cancelComputer();game.resign(side);selected=-1;refresh();
    }
    private void agreeDraw() {
        if(loadWorker!=null || versusComputer || game.isOver())return;
        final ChessGame confirmedGame=game;
        if(JOptionPane.showConfirmDialog(this,"Do both players agree to a draw?","Draw by agreement",JOptionPane.YES_NO_OPTION)!=JOptionPane.YES_OPTION)return;
        if(game!=confirmedGame || loadWorker!=null || versusComputer || game.isOver())return;
        cancelComputer();game.agreeDraw();selected=-1;refresh();
    }
    private void claimDraw() {
        if(busy || loadWorker!=null || game.isOver())return;
        if(game.canClaimDraw())game.claimDraw();
        else {
            List<Move> options=game.drawClaimMoves();if(options.isEmpty())return;
            String[] labels=options.stream().map(game::notation).toArray(String[]::new);
            String choice=(String)JOptionPane.showInputDialog(this,"Choose the intended move that permits a draw claim.\nThe game ends before that move is played.","Claim draw",JOptionPane.QUESTION_MESSAGE,null,labels,labels[0]);
            if(choice==null)return;
            for(int i=0;i<labels.length;i++)if(labels[i].equals(choice)){game.claimDraw(options.get(i));break;}
        }
        selected=-1;refresh();
    }
    private JFileChooser chooser(String extension,String description) {
        JFileChooser chooser=new JFileChooser();chooser.setFileFilter(new FileNameExtensionFilter(description,extension));return chooser;
    }
    private Path savePath(String ext,String description) {
        JFileChooser chooser=chooser(ext,description);chooser.setSelectedFile(new java.io.File("chess-game."+ext));
        if(chooser.showSaveDialog(this)!=JFileChooser.APPROVE_OPTION)return null;
        Path p=chooser.getSelectedFile().toPath();if(!p.toString().toLowerCase().endsWith("."+ext))p=Path.of(p+"."+ext);
        if(Files.exists(p) && JOptionPane.showConfirmDialog(this,"Replace "+p.getFileName()+"?","Overwrite file",JOptionPane.YES_NO_OPTION)!=JOptionPane.YES_OPTION)return null;
        return p;
    }
    private void saveGame() {
        Path path=savePath("chess","Java Chess saved game");if(path==null)return;
        saveTo(path,false);
    }
    private void loadGame() {
        JFileChooser chooser=chooser("chess","Java Chess saved game");if(chooser.showOpenDialog(this)!=JFileChooser.APPROVE_OPTION)return;
        if(confirmReplace())loadFrom(chooser.getSelectedFile().toPath());
    }
    private void exportPgn() {
        Path path=savePath("pgn","Portable Game Notation");if(path==null)return;
        saveTo(path,true);
    }
    /** Starts an already-confirmed load; file work never runs on Swing's event thread. */
    public void loadFrom(Path path) {
        cancelComputer();final long generation=revision;
        loadWorker=new SwingWorker<>() {
            protected ChessGame doInBackground() throws IOException{return files.load(path);}
            protected void done(){
                if(isCancelled()||generation!=revision)return;
                loadWorker=null;
                try{game=get();revision++;selected=-1;}
                catch(CancellationException ignored){ }
                catch(InterruptedException e){Thread.currentThread().interrupt();}
                catch(ExecutionException e){showError("Could not load game: "+e.getCause().getMessage());}
                refresh();startComputer();
            }
        };
        refresh();loadWorker.execute();
    }
    /** Saves a detached snapshot; further moves cannot change the file being written. */
    public void saveTo(Path path,boolean pgn) {
        if(saveWorker!=null)return;
        final ChessGame snapshot=game.snapshot();final long generation=++fileRevision;
        saveWorker=new SwingWorker<>() {
            protected Void doInBackground() throws IOException{files.save(snapshot,path,pgn);return null;}
            protected void done(){
                if(isCancelled()||generation!=fileRevision)return;
                saveWorker=null;refresh();
                try{get();hint.setText((pgn?"Exported ":"Saved ")+path.getFileName());}
                catch(CancellationException ignored){ }
                catch(InterruptedException e){Thread.currentThread().interrupt();}
                catch(ExecutionException e){showError("Could not save file: "+e.getCause().getMessage());}
            }
        };
        refresh();saveWorker.execute();
    }
    private void help() {
        JOptionPane.showMessageDialog(this,"Select a piece, then a highlighted square.\n\n"+
            "• White moves first. You cannot leave your king in check.\n"+
            "• Castle by moving the king two squares toward its rook.\n"+
            "• En passant is available only immediately after the pawn's double move.\n"+
            "• On promotion, choose queen, rook, bishop, or knight.\n"+
            "• Claim draw supports threefold repetition and the 50-move rule.\n"+
            "• Fivefold repetition and the 75-move rule end the game automatically.\n"+
            "• Save/load uses .chess files. Export PGN shares move notation.\n"+
            "• New game switches opponent, your color, and computer difficulty.\n\n"+
            "This is an untimed practice game. The built-in computer is a basic opponent.","How to play",JOptionPane.INFORMATION_MESSAGE);
    }
    private void showError(String text){if(GraphicsEnvironment.isHeadless()){hint.setText(text);return;}JOptionPane.showMessageDialog(this,text,"Java Chess",JOptionPane.ERROR_MESSAGE);}
    // Expose the current board and game for other desktop integrations.
    public BoardView boardView(){return boardView;}
    public ChessGame game(){return game;}
    public boolean isThinking(){return busy;}
    public boolean isLoading(){return loadWorker!=null;}
    public boolean isSaving(){return saveWorker!=null;}
    public void startNewGame(boolean computer, Side playerSide, ComputerPlayer.Level strength) {
        cancelComputer();versusComputer=computer;human=playerSide;level=strength;
        game=new ChessGame();selected=-1;flipped=computer&&human==Side.BLACK;refresh();startComputer();
    }
}
