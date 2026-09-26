package com.chess.game;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;

/** Write a sibling temporary file completely before replacing a saved artifact. */
public final class AtomicFiles {
    private AtomicFiles() { }
    @FunctionalInterface public interface WriterAction { void write(Writer writer) throws IOException; }
    public static void write(Path path, String text) throws IOException { write(path, writer -> writer.write(text)); }
    public static void write(Path path, WriterAction action) throws IOException {
        Path target=path.toAbsolutePath(),temp=Files.createTempFile(target.getParent(),".chess-save-",".tmp");
        try {
            try(Writer writer=Files.newBufferedWriter(temp,StandardCharsets.UTF_8)){action.write(writer);}
            if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("File operation cancelled");
            try { Files.move(temp,target,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE); }
            catch(AtomicMoveNotSupportedException e){Files.move(temp,target,StandardCopyOption.REPLACE_EXISTING);}
        } finally { Files.deleteIfExists(temp); }
    }
}
