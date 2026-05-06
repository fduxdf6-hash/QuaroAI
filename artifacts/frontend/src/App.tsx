import { useState, useRef, useEffect, useCallback } from "react";
import Editor from "@monaco-editor/react";
import axios from "axios";

const API = "";

type Message = { role: "user" | "assistant"; content: string };
type FileEntry = { path: string; content: string };
type OutputLine = { type: "stdout" | "stderr" | "info" | "error"; text: string };

const STARTER_CODE: Record<string, string> = {
  javascript: `// Welcome to QuaroAI ⚡
// Edit code here, run it, or ask the AI for help

function greet(name) {
  return \`Hello, \${name}!\`;
}

console.log(greet("World"));
`,
  python: `# Welcome to QuaroAI ⚡
# Edit code here, run it, or ask the AI for help

def greet(name):
    return f"Hello, {name}!"

print(greet("World"))
`,
  typescript: `// Welcome to QuaroAI ⚡
// Edit code here, run it, or ask the AI for help

function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

console.log(greet("World"));
`,
};

function renderMarkdown(text: string) {
  // Simple markdown-like rendering for chat
  const parts: JSX.Element[] = [];
  const blocks = text.split(/(```[\s\S]*?```)/g);
  blocks.forEach((block, i) => {
    if (block.startsWith("```")) {
      const match = block.match(/```(\w*)\n?([\s\S]*?)```/);
      const lang = match?.[1] || "";
      const code = match?.[2] ?? block.slice(3, -3);
      parts.push(
        <pre key={i} className="bg-gray-900 border border-gray-700 rounded p-3 my-2 overflow-x-auto text-xs font-mono text-green-300">
          {lang && <div className="text-gray-500 text-xs mb-1">{lang}</div>}
          {code.trim()}
        </pre>
      );
    } else {
      const lines = block.split("\n");
      parts.push(
        <span key={i}>
          {lines.map((line, j) => (
            <span key={j}>
              {line}
              {j < lines.length - 1 && <br />}
            </span>
          ))}
        </span>
      );
    }
  });
  return parts;
}

export default function App() {
  const [language, setLanguage] = useState("javascript");
  const [code, setCode] = useState(STARTER_CODE["javascript"]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [running, setRunning] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [activePanel, setActivePanel] = useState<"output" | "chat">("chat");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  const addOutput = (lines: OutputLine[]) => setOutput((prev) => [...prev, ...lines]);

  const runCode = useCallback(async () => {
    if (!code.trim() || running) return;
    setRunning(true);
    setActivePanel("output");
    setOutput([{ type: "info", text: `▶ Running ${language}...` }]);

    try {
      const res = await axios.post(`${API}/api/ai/exec`, { code, language });
      const { stdout, stderr } = res.data;
      if (stdout) addOutput(stdout.split("\n").filter(Boolean).map((t: string) => ({ type: "stdout" as const, text: t })));
      if (stderr) addOutput(stderr.split("\n").filter(Boolean).map((t: string) => ({ type: "stderr" as const, text: t })));
      if (!stdout && !stderr) addOutput([{ type: "info", text: "✓ Executed with no output." }]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Execution failed";
      addOutput([{ type: "error", text: "❌ " + msg }]);
    }
    setRunning(false);
  }, [code, language, running]);

  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    setChatInput("");
    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setChatLoading(true);

    try {
      const response = await fetch(`${API}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, code, language }),
      });

      if (!response.body) throw new Error("No stream");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));
        for (const line of lines) {
          const json = line.slice(6);
          try {
            const parsed = JSON.parse(json);
            if (parsed.content) {
              assistantText += parsed.content;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: assistantText };
                return updated;
              });
            }
          } catch {}
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "AI error";
      setMessages((prev) => [...prev, { role: "assistant", content: `❌ ${msg}` }]);
    }
    setChatLoading(false);
  }, [chatInput, chatLoading, messages, code, language]);

  const generateWithAI = useCallback(async () => {
    const prompt = aiPrompt.trim();
    if (!prompt || aiLoading) return;
    setAiPrompt("");
    setAiLoading(true);
    addOutput([{ type: "info", text: `🤖 Generating: "${prompt}"` }]);
    setActivePanel("output");

    try {
      const res = await axios.post(`${API}/api/ai/run`, { prompt, language, files });
      const { explanation, code: newCode, files: newFiles, commands } = res.data;

      if (explanation) addOutput([{ type: "info", text: "🧠 " + explanation }]);
      if (newCode) {
        setCode(newCode);
        addOutput([{ type: "info", text: "📝 Code updated in editor" }]);
      }
      if (newFiles?.length) {
        await axios.post(`${API}/api/ai/apply`, { files: newFiles });
        setFiles(newFiles);
        addOutput([{ type: "info", text: `📁 ${newFiles.length} file(s) applied` }]);
      }
      for (const cmd of commands ?? []) {
        addOutput([{ type: "info", text: `⚡ Running: ${cmd}` }]);
        const exec = await axios.post(`${API}/api/ai/exec`, { command: cmd });
        if (exec.data.stdout) addOutput([{ type: "stdout", text: exec.data.stdout }]);
        if (exec.data.stderr) addOutput([{ type: "stderr", text: exec.data.stderr }]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error";
      addOutput([{ type: "error", text: "❌ " + msg }]);
    }
    setAiLoading(false);
  }, [aiPrompt, aiLoading, language, files]);

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang);
    if (STARTER_CODE[lang]) setCode(STARTER_CODE[lang]);
  };

  const loadFile = (f: FileEntry) => {
    setActiveFile(f.path);
    setCode(f.content);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 font-mono text-sm overflow-hidden">
      {/* ── TOP BAR ── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 bg-gray-900 shrink-0">
        <span className="font-bold text-base tracking-tight">⚡ QuaroAI</span>
        <div className="flex-1" />
        {/* AI Generate bar */}
        <input
          className="w-64 bg-gray-800 border border-gray-700 rounded px-3 py-1 text-xs placeholder-gray-500 focus:outline-none focus:border-blue-500"
          placeholder="Ask AI to generate code..."
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generateWithAI()}
          disabled={aiLoading}
        />
        <button
          onClick={generateWithAI}
          disabled={aiLoading || !aiPrompt.trim()}
          className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 px-3 py-1 rounded text-xs font-semibold transition-colors"
        >
          {aiLoading ? "Generating…" : "Generate"}
        </button>
        <div className="w-px h-5 bg-gray-700" />
        <select
          value={language}
          onChange={(e) => handleLanguageChange(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs focus:outline-none"
        >
          <option value="javascript">JavaScript</option>
          <option value="typescript">TypeScript</option>
          <option value="python">Python</option>
          <option value="html">HTML</option>
          <option value="css">CSS</option>
          <option value="json">JSON</option>
          <option value="markdown">Markdown</option>
        </select>
        <button
          onClick={runCode}
          disabled={running}
          className="bg-green-600 hover:bg-green-700 disabled:opacity-40 px-4 py-1 rounded text-xs font-semibold transition-colors flex items-center gap-1.5"
        >
          {running ? "▶ Running…" : "▶ Run"}
        </button>
      </div>

      {/* ── MAIN BODY ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: File tree */}
        <div className="w-44 border-r border-gray-800 bg-gray-900 flex flex-col shrink-0">
          <div className="px-3 py-2 text-xs text-gray-500 uppercase tracking-wider font-semibold">Files</div>
          <div className="flex-1 overflow-y-auto">
            {/* Current editor pseudo-file */}
            <div
              className={`px-3 py-1.5 text-xs cursor-pointer truncate ${activeFile === null ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-800"}`}
              onClick={() => setActiveFile(null)}
            >
              📄 {language === "python" ? "main.py" : language === "html" ? "index.html" : "main." + (language === "typescript" ? "ts" : "js")}
            </div>
            {files.map((f) => (
              <div
                key={f.path}
                onClick={() => loadFile(f)}
                className={`px-3 py-1.5 text-xs cursor-pointer truncate ${activeFile === f.path ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-800"}`}
              >
                📄 {f.path}
              </div>
            ))}
          </div>
        </div>

        {/* CENTER: Editor + Output */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Editor */}
          <div className="flex-1 overflow-hidden">
            <Editor
              height="100%"
              language={language === "python" ? "python" : language === "typescript" ? "typescript" : language === "html" ? "html" : language === "css" ? "css" : language === "json" ? "json" : language === "markdown" ? "markdown" : "javascript"}
              value={code}
              onChange={(val) => setCode(val ?? "")}
              theme="vs-dark"
              options={{
                fontSize: 13,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                lineNumbers: "on",
                renderLineHighlight: "all",
                padding: { top: 12 },
                tabSize: 2,
                automaticLayout: true,
              }}
            />
          </div>

          {/* Output / Terminal panel */}
          <div className="h-44 border-t border-gray-800 flex flex-col bg-black shrink-0">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 bg-gray-900 shrink-0">
              <button
                onClick={() => setActivePanel("output")}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${activePanel === "output" ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}
              >
                Output
              </button>
              <button
                onClick={() => setActivePanel("chat")}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${activePanel === "chat" ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}
              >
                AI Chat
              </button>
              <div className="flex-1" />
              {activePanel === "output" && (
                <button
                  onClick={() => setOutput([])}
                  className="text-xs text-gray-600 hover:text-gray-400"
                >
                  Clear
                </button>
              )}
            </div>

            {activePanel === "output" && (
              <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
                {output.length === 0 && (
                  <span className="text-gray-600 text-xs">Press ▶ Run to execute your code.</span>
                )}
                {output.map((line, i) => (
                  <div key={i} className={`text-xs font-mono leading-relaxed ${
                    line.type === "stderr" ? "text-red-400" :
                    line.type === "error" ? "text-red-500" :
                    line.type === "info" ? "text-blue-400" :
                    "text-green-300"
                  }`}>
                    {line.text}
                  </div>
                ))}
                <div ref={outputEndRef} />
              </div>
            )}

            {activePanel === "chat" && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {messages.length === 0 && (
                    <div className="text-gray-600 text-xs">
                      Ask the AI about your code — it can see what's in the editor.
                    </div>
                  )}
                  {messages.map((m, i) => (
                    <div
                      key={i}
                      className={`text-xs leading-relaxed ${m.role === "user" ? "text-yellow-300" : "text-gray-200"}`}
                    >
                      <span className={`font-bold mr-1 ${m.role === "user" ? "text-yellow-500" : "text-purple-400"}`}>
                        {m.role === "user" ? "You:" : "AI:"}
                      </span>
                      {m.role === "assistant" ? renderMarkdown(m.content) : m.content}
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="text-xs text-purple-400 animate-pulse">AI is thinking…</div>
                  )}
                  <div ref={chatEndRef} />
                </div>
                <div className="flex gap-2 px-3 pb-2 pt-1 border-t border-gray-800 shrink-0">
                  <input
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs placeholder-gray-500 focus:outline-none focus:border-purple-500"
                    placeholder="Ask about your code…"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendChat()}
                    disabled={chatLoading}
                  />
                  <button
                    onClick={sendChat}
                    disabled={chatLoading || !chatInput.trim()}
                    className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 px-3 py-1 rounded text-xs font-semibold transition-colors"
                  >
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
