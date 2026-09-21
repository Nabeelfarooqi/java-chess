import javax.tools.ToolProvider;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.jar.*;

/** Offline build launcher: java Build.java [run|test|build]. Requires JDK 17+. */
public class Build {
    public static void main(String[] args) throws Exception {
        String command=args.length==0?"run":args[0];
        if(!Set.of("run","test","build").contains(command))throw new IllegalArgumentException("Use run, test, or build");
        compile(Path.of("src"),Path.of("build/classes"),null);
        switch(command) {
            case "run" -> launch(List.of("-cp","build/classes","com.chess.ChessApplication"));
            case "test" -> {
                compile(Path.of("test"),Path.of("build/test-classes"),"build/classes");
                launch(List.of("-Xmx512m","-Djava.awt.headless=true","-cp","build/classes"+File.pathSeparator+"build/test-classes","com.chess.ChessTests"));
            }
            case "build" -> {
                Manifest manifest=new Manifest();manifest.getMainAttributes().put(Attributes.Name.MANIFEST_VERSION,"1.0");
                manifest.getMainAttributes().put(Attributes.Name.MAIN_CLASS,"com.chess.ChessApplication");
                Path classes=Path.of("build/classes"),jar=Path.of("build/java-chess.jar");
                try(JarOutputStream out=new JarOutputStream(Files.newOutputStream(jar),manifest);var paths=Files.walk(classes)) {
                    for(Path file:paths.filter(Files::isRegularFile).sorted().toList()) {
                        out.putNextEntry(new JarEntry(classes.relativize(file).toString().replace(File.separatorChar,'/')));
                        Files.copy(file,out);out.closeEntry();
                    }
                }
                System.out.println("Built "+jar+" — launch with: java -jar "+jar);
            }
        }
    }
    private static void compile(Path source,Path output,String classpath) throws IOException {
        var compiler=ToolProvider.getSystemJavaCompiler();
        if(compiler==null)throw new IllegalStateException("A full JDK 17 or newer is required, not a JRE. Set IntelliJ's Project SDK or install a JDK.");
        if(Files.exists(output))try(var paths=Files.walk(output)){for(Path p:paths.sorted(Comparator.reverseOrder()).toList())Files.delete(p);}
        Files.createDirectories(output);
        List<String> options=new ArrayList<>(List.of("--release","17","-encoding","UTF-8","-d",output.toString()));
        if(classpath!=null){options.add("-cp");options.add(classpath);}
        try(var paths=Files.walk(source)){options.addAll(paths.filter(p->p.toString().endsWith(".java")).sorted().map(Path::toString).toList());}
        if(compiler.run(null,System.out,System.err,options.toArray(String[]::new))!=0)throw new IllegalStateException("Compilation failed");
    }
    private static void launch(List<String> arguments) throws IOException,InterruptedException {
        String executable=System.getProperty("os.name").toLowerCase().contains("win")?"java.exe":"java";
        List<String> command=new ArrayList<>();command.add(Path.of(System.getProperty("java.home"),"bin",executable).toString());command.addAll(arguments);
        int result=new ProcessBuilder(command).inheritIO().start().waitFor();if(result!=0)System.exit(result);
    }
}
