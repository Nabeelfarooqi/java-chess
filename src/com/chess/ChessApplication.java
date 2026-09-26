package com.chess;

import com.chess.ui.GamePanel;
import javax.swing.*;
import java.awt.*;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;

public final class ChessApplication {
    private ChessApplication() { }
    public static void main(String[] args) {
        if(GraphicsEnvironment.isHeadless()) {
            System.err.println("Java Chess needs a desktop display. Run it in IntelliJ on Windows, macOS, or Linux.");return;
        }
        SwingUtilities.invokeLater(()->{
            JFrame frame=new JFrame("Java Chess — Nabeel Farooqi");GamePanel game=new GamePanel();
            frame.setDefaultCloseOperation(WindowConstants.DO_NOTHING_ON_CLOSE);
            frame.addWindowListener(new WindowAdapter(){@Override public void windowClosing(WindowEvent e){
                if(game.game().plyCount()>0 && !game.game().isOver() && JOptionPane.showConfirmDialog(frame,
                    "Close the game? Save it first if you want to resume later.","Close Java Chess",JOptionPane.YES_NO_OPTION)!=JOptionPane.YES_OPTION)return;
                if(game.isSaving() && JOptionPane.showConfirmDialog(frame,"A file is still being saved. Cancel that save and close?","Save in progress",JOptionPane.YES_NO_OPTION)!=JOptionPane.YES_OPTION)return;
                game.cancelComputer();game.cancelFileOperations();frame.dispose();
            }});
            frame.setContentPane(game);frame.setMinimumSize(new Dimension(880,650));frame.setSize(1050,800);frame.setLocationRelativeTo(null);frame.setVisible(true);
        });
    }
}
