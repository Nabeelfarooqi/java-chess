package com.chess.ui;

import com.chess.board.*;
import com.chess.board.Piece.Side;
import javax.swing.*;
import java.awt.*;
import java.awt.event.*;
import java.awt.font.GlyphVector;
import java.awt.geom.*;
import java.util.List;
import java.util.function.IntConsumer;

/** Resizable vector board, with mouse and keyboard input and no image downloads. */
public final class BoardView extends JComponent {
    private Board board=Board.initial();
    private int selected=-1,focusSquare=52;
    private List<Move> targets=List.of();
    private Move lastMove;
    private boolean flipped;
    private final IntConsumer clicked;
    private final Font pieceFont;
    private static final Color LIGHT=new Color(235,237,218),DARK=new Color(105,143,120);
    public BoardView(IntConsumer clicked) {
        this.clicked=clicked;setPreferredSize(new Dimension(660,660));setMinimumSize(new Dimension(330,330));setFocusable(true);
        setToolTipText("Select a piece, then a destination. Arrow keys and Enter also work.");
        pieceFont=choosePieceFont();
        addMouseListener(new MouseAdapter(){@Override public void mousePressed(MouseEvent e){
            requestFocusInWindow();int sq=squareAt(e.getX(),e.getY());if(sq>=0){focusSquare=sq;clicked.accept(sq);repaint();}
        }});
        addFocusListener(new FocusAdapter(){public void focusGained(FocusEvent e){repaint();}public void focusLost(FocusEvent e){repaint();}});
        bind("LEFT",()->moveFocus(0,-1));bind("RIGHT",()->moveFocus(0,1));bind("UP",()->moveFocus(-1,0));bind("DOWN",()->moveFocus(1,0));
        bind("ENTER",()->clicked.accept(focusSquare));bind("SPACE",()->clicked.accept(focusSquare));bind("ESCAPE",()->clicked.accept(-1));
    }
    private Font choosePieceFont() {
        for(String name:new String[]{"Segoe UI Symbol","DejaVu Sans","Apple Symbols","Dialog"}) {
            Font f=new Font(name,Font.PLAIN,100);if(f.canDisplay('\u265a') && f.canDisplay('\u265f'))return f;
        }
        return new Font(Font.SERIF,Font.PLAIN,100);
    }
    private void bind(String key,Runnable action) {
        getInputMap(WHEN_FOCUSED).put(KeyStroke.getKeyStroke(key),key);
        getActionMap().put(key,new AbstractAction(){public void actionPerformed(ActionEvent e){action.run();}});
    }
    private void moveFocus(int dr,int dc) {
        if(flipped){dr=-dr;dc=-dc;}
        int r=Math.max(0,Math.min(7,focusSquare/8+dr)),c=Math.max(0,Math.min(7,focusSquare%8+dc));focusSquare=r*8+c;repaint();
    }
    public void showPosition(Board board,int selected,List<Move> targets,Move lastMove,boolean flipped) {
        this.board=board;this.selected=selected;this.targets=targets;this.lastMove=lastMove;this.flipped=flipped;repaint();
    }
    private int boardSize(){return Math.max(8,(Math.min(getWidth(),getHeight())-56)/8*8);}
    private int originX(){return (getWidth()-boardSize())/2;}
    private int originY(){return (getHeight()-boardSize())/2;}
    public int squareAt(int x,int y) {
        int size=boardSize(),ox=originX(),oy=originY();if(x<ox||y<oy||x>=ox+size||y>=oy+size)return -1;
        int index=((y-oy)/(size/8))*8+(x-ox)/(size/8);return flipped?63-index:index;
    }
    @Override protected void paintComponent(Graphics graphics) {
        super.paintComponent(graphics);Graphics2D g=(Graphics2D)graphics.create();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING,RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING,RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        int size=boardSize(),cell=size/8,ox=originX(),oy=originY();
        int check=board.inCheck(board.turn())?board.kingSquare(board.turn()):-1;
        g.setColor(new Color(0,0,0,50));g.fillRoundRect(ox-4,oy-1,size+8,size+8,12,12);
        for(int display=0;display<64;display++) {
            int sq=flipped?63-display:display,x=ox+(display%8)*cell,y=oy+(display/8)*cell;
            g.setColor(((sq/8+sq%8)%2==0)?LIGHT:DARK);g.fillRect(x,y,cell,cell);
            if(lastMove!=null && (sq==lastMove.from()||sq==lastMove.to())){g.setColor(new Color(237,212,92,105));g.fillRect(x,y,cell,cell);}
            if(sq==selected){g.setColor(new Color(246,224,111,180));g.fillRect(x,y,cell,cell);}
            if(sq==check){g.setColor(new Color(206,64,75,170));g.fillRect(x,y,cell,cell);}
            Piece p=board.pieceAt(sq);if(p!=null)paintPiece(g,p,x,y,cell);
            if(targets.stream().anyMatch(m->m.to()==sq)) {
                g.setColor(new Color(24,59,46,120));
                if(board.pieceAt(sq)!=null){g.setStroke(new BasicStroke(Math.max(3,cell/16f)));g.drawOval(x+5,y+5,cell-10,cell-10);}
                else{int dot=Math.max(10,cell/5);g.fillOval(x+(cell-dot)/2,y+(cell-dot)/2,dot,dot);}
            }
            if(hasFocus() && sq==focusSquare){g.setColor(new Color(28,62,52));g.setStroke(new BasicStroke(2));g.drawRect(x+3,y+3,cell-6,cell-6);}
        }
        g.setFont(new Font(Font.SANS_SERIF,Font.BOLD,12));g.setColor(new Color(154,168,185));
        for(int i=0;i<8;i++) {
            String file=String.valueOf((char)('a'+(flipped?7-i:i))),rank=String.valueOf(flipped?i+1:8-i);
            g.drawString(file,ox+i*cell+cell/2-4,oy+size+20);
            g.drawString(rank,ox-20,oy+i*cell+cell/2+4);
        }
        g.dispose();
    }
    private void paintPiece(Graphics2D g,Piece piece,int x,int y,int cell) {
        int offset=switch(piece.type()){case KING->0;case QUEEN->1;case ROOK->2;case BISHOP->3;case KNIGHT->4;case PAWN->5;};
        String glyph=String.valueOf((char)(0x265a+offset));
        Font font=pieceFont.deriveFont(cell*.82f);GlyphVector vector=font.createGlyphVector(g.getFontRenderContext(),glyph);
        Shape shape=vector.getOutline();Rectangle2D bounds=shape.getBounds2D();
        AffineTransform tr=AffineTransform.getTranslateInstance(x+(cell-bounds.getWidth())/2-bounds.getX(),y+(cell-bounds.getHeight())/2-bounds.getY()-1);
        shape=tr.createTransformedShape(shape);
        g.setColor(new Color(0,0,0,35));g.fill(AffineTransform.getTranslateInstance(1,3).createTransformedShape(shape));
        g.setColor(piece.side()==Side.WHITE?new Color(255,253,241):new Color(28,36,44));g.fill(shape);
        g.setStroke(new BasicStroke(Math.max(.9f,cell/65f),BasicStroke.CAP_ROUND,BasicStroke.JOIN_ROUND));
        g.setColor(piece.side()==Side.WHITE?new Color(61,69,66):new Color(6,12,18));g.draw(shape);
    }
}
