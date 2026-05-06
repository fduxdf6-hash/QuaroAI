import { useState, useRef, useEffect, useCallback } from "react";
import Editor from "@monaco-editor/react";
import axios from "axios";
import JSZip from "jszip";
import { saveAs } from "file-saver";

const API = "";

type Message = { role: "user" | "assistant"; content: string };
type FileEntry = { path: string; content: string };
type OutputLine = { type: "stdout" | "stderr" | "info" | "error"; text: string };
type Tab = "editor" | "ai";

const STARTER_CODE: Record<string, string> = {
  javascript: `// Welcome to QuaroAI ⚡\n// Edit code here, run it, or ask the AI for help\n\nfunction greet(name) {\n  return \`Hello, \${name}!\`;\n}\n\nconsole.log(greet("World"));\n`,
  python: `# Welcome to QuaroAI ⚡\n# Edit code here, run it, or ask the AI for help\n\ndef greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("World"))\n`,
  typescript: `// Welcome to QuaroAI ⚡\n// Edit code here, run it, or ask the AI for help\n\nfunction greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n\nconsole.log(greet("World"));\n`,
  html: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <title>QuaroAI</title>\n</head>\n<body>\n  <h1>Hello, World!</h1>\n</body>\n</html>\n`,
};

const EXT: Record<string, string> = {
  javascript: "js", typescript: "ts", python: "py", html: "html", css: "css", json: "json", markdown: "md",
};

const PROMPT_GROUPS = [
  {
    label: "Understand",
    icon: "📖",
    color: "blue",
    prompts: ["Explain this code", "What edge cases am I missing?"],
  },
  {
    label: "Fix",
    icon: "🔧",
    color: "red",
    prompts: ["Fix any bugs", "Add error handling"],
  },
  {
    label: "Improve",
    icon: "✨",
    color: "yellow",
    prompts: ["How can I improve this?", "Optimize for performance"],
  },
  {
    label: "Transform",
    icon: "🔄",
    color: "green",
    prompts: ["Convert this to TypeScript", "Refactor to use async/await"],
  },
  {
    label: "Document",
    icon: "📝",
    color: "purple",
    prompts: ["Add comments to this code", "Add unit tests for this"],
  },
];

function extractFirstCode(text: string): string | null {
  const match = text.match(/```(?:\w*)\n?([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

function renderMarkdown(text: string): JSX.Element[] {
  const parts: JSX.Element[] = [];
  const blocks = text.split(/(```[\s\S]*?```)/g);
  blocks.forEach((block, i) => {
    if (block.startsWith("```")) {
      const match = block.match(/```(\w*)\n?([\s\S]*?)```/);
      const lang = match?.[1] || "";
      const code = match?.[2] ?? block.slice(3, -3);
      parts.push(
        <pre key={i} className="bg-gray-900 border border-gray-700 rounded p-3 my-2 overflow-x-auto text-xs font-mono text-green-300 whitespace-pre-wrap">
          {lang && <div className="text-gray-500 text-[10px] mb-1 uppercase">{lang}</div>}
          {code.trim()}
        </pre>
      );
    } else {
      parts.push(
        <span key={i}>
          {block.split("\n").map((line, j, arr) => (
            <span key={j}>{line}{j < arr.length - 1 && <br />}</span>
          ))}
        </span>
      );
    }
  });
  return parts;
}

function GitHubModal({ onClose, files, code, language }: {
  onClose: () => void;
  files: FileEntry[];
  code: string;
  language: string;
}) {
  const [token, setToken] = useState("");
  const [repoFull, setRepoFull] = useState("");
  const [commitMsg, setCommitMsg] = useState("Update from QuaroAI");
  const [status, setStatus] = useState<"idle" | "pushing" | "done" | "error">("idle");
  const [result, setResult] = useState<{ url?: string; error?: string }>({});

  const mainFile: FileEntry = { path: `main.${EXT[language] ?? "js"}`, content: code };
  const allFiles = [mainFile, ...files.filter((f) => f.path !== mainFile.path)];

  async function push() {
    const [owner, repo] = repoFull.split("/");
    if (!token || !owner || !repo) return;
    setStatus("pushing");
    try {
      const res = await axios.post(`${API}/api/github/push`, { token, owner, repo, files: allFiles, message: commitMsg });
      setResult({ url: res.data.url });
      setStatus("done");
    } catch (err: unknown) {
      setResult({ error: err instanceof Error ? err.message : "Push failed" });
      setStatus("error");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-96 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-sm text-white">Push to GitHub</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">×</button>
        </div>
        {status === "done" ? (
          <div className="text-center py-4">
            <div className="text-green-400 text-2xl mb-2">✓</div>
            <p className="text-sm text-green-300 mb-1">Pushed successfully!</p>
            <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 text-xs underline break-all">{result.url}</a>
            <button onClick={onClose} className="mt-4 w-full bg-gray-700 hover:bg-gray-600 rounded py-2 text-xs">Close</button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">GitHub Token (PAT)</label>
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_xxxxxxxxxxxx"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Repository (owner/repo)</label>
              <input value={repoFull} onChange={(e) => setRepoFull(e.target.value)} placeholder="username/my-repo"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Commit message</label>
              <input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs focus:outline-none focus:border-blue-500" />
            </div>
            <div className="text-xs text-gray-600">{allFiles.length} file(s) will be pushed</div>
            {status === "error" && <div className="text-xs text-red-400">{result.error}</div>}
            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 rounded py-2 text-xs">Cancel</button>
              <button onClick={push} disabled={status === "pushing" || !token || !repoFull}
                className="flex-1 bg-gray-800 border border-gray-600 hover:bg-gray-700 disabled:opacity-40 rounded py-2 text-xs font-semibold flex items-center justify-center gap-1.5">
                {status === "pushing" ? "Pushing…" : (
                  <><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>Push to GitHub</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("editor");
  const [language, setLanguage] = useState("javascript");
  const [code, setCode] = useState(STARTER_CODE["javascript"]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [running, setRunning] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [showGitHub, setShowGitHub] = useState(false);
  const [autoPushStatus, setAutoPushStatus] = useState<"idle" | "pushing" | "done" | "error">("idle");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, chatLoading]);
  useEffect(() => { outputEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [output]);

  const addOutput = (lines: OutputLine[]) => setOutput((prev) => [...prev, ...lines]);

  const runCode = useCallback(async () => {
    if (!code.trim() || running) return;
    setRunning(true);
    setOutput([{ type: "info", text: `▶ Running ${language}…` }]);
    try {
      const res = await axios.post(`${API}/api/ai/exec`, { code, language });
      const { stdout, stderr } = res.data;
      if (stdout) addOutput(stdout.split("\n").filter(Boolean).map((t: string) => ({ type: "stdout" as const, text: t })));
      if (stderr) addOutput(stderr.split("\n").filter(Boolean).map((t: string) => ({ type: "stderr" as const, text: t })));
      if (!stdout && !stderr) addOutput([{ type: "info", text: "✓ No output." }]);
    } catch (err: unknown) {
      addOutput([{ type: "error", text: "❌ " + (err instanceof Error ? err.message : "Execution failed") }]);
    }
    setRunning(false);
  }, [code, language, running]);

  const sendChat = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? chatInput).trim();
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
        const lines = decoder.decode(value).split("\n").filter((l) => l.startsWith("data: "));
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line.slice(6));
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
      setMessages((prev) => [...prev, { role: "assistant", content: `❌ ${err instanceof Error ? err.message : "AI error"}` }]);
    }
    setChatLoading(false);
  }, [chatInput, chatLoading, messages, code, language]);

  const generateWithAI = useCallback(async () => {
    const prompt = aiPrompt.trim();
    if (!prompt || aiLoading) return;
    setAiPrompt("");
    setAiLoading(true);
    addOutput([{ type: "info", text: `🤖 Generating: "${prompt}"` }]);
    try {
      const res = await axios.post(`${API}/api/ai/run`, { prompt, language, files });
      const { explanation, code: newCode, files: newFiles, commands } = res.data;
      if (explanation) addOutput([{ type: "info", text: "🧠 " + explanation }]);
      if (newCode) { setCode(newCode); addOutput([{ type: "info", text: "📝 Code updated in editor" }]); }
      if (newFiles?.length) {
        await axios.post(`${API}/api/ai/apply`, { files: newFiles });
        setFiles(newFiles);
        addOutput([{ type: "info", text: `📁 ${newFiles.length} file(s) applied` }]);
      }
      for (const cmd of commands ?? []) {
        addOutput([{ type: "info", text: `⚡ ${cmd}` }]);
        const exec = await axios.post(`${API}/api/ai/exec`, { command: cmd });
        if (exec.data.stdout) addOutput([{ type: "stdout", text: exec.data.stdout }]);
        if (exec.data.stderr) addOutput([{ type: "stderr", text: exec.data.stderr }]);
      }
    } catch (err: unknown) {
      addOutput([{ type: "error", text: "❌ " + (err instanceof Error ? err.message : "Error") }]);
    }
    setAiLoading(false);
  }, [aiPrompt, aiLoading, language, files]);

  const downloadZip = useCallback(async () => {
    const zip = new JSZip();
    const mainName = `main.${EXT[language] ?? "js"}`;
    zip.file(mainName, code);
    files.forEach((f) => { if (f.path !== mainName) zip.file(f.path, f.content); });
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, "quaro-project.zip");
  }, [code, language, files]);

  const autoPushToGitHub = useCallback(async () => {
    setAutoPushStatus("pushing");
    try {
      await axios.post(`${API}/api/github/autopush`);
      setAutoPushStatus("done");
      setTimeout(() => setAutoPushStatus("idle"), 3000);
    } catch {
      setAutoPushStatus("error");
      setTimeout(() => setAutoPushStatus("idle"), 3000);
    }
  }, []);

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang);
    if (STARTER_CODE[lang]) setCode(STARTER_CODE[lang]);
  };

  const loadFile = (f: FileEntry) => { setActiveFile(f.path); setCode(f.content); };

  const handlePromptClick = (prompt: string) => {
    setChatInput(prompt);
    sendChat(prompt);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 text-sm overflow-hidden">
      {showGitHub && <GitHubModal onClose={() => setShowGitHub(false)} files={files} code={code} language={language} />}

      {/* ── TOP BAR ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 bg-gray-900 shrink-0">
        <span className="font-bold text-base tracking-tight mr-1 shrink-0">⚡ QuaroAI</span>

        {activeTab === "editor" ? (
          <>
            <select value={language} onChange={(e) => handleLanguageChange(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none shrink-0">
              <option value="javascript">JavaScript</option>
              <option value="typescript">TypeScript</option>
              <option value="python">Python</option>
              <option value="html">HTML</option>
              <option value="css">CSS</option>
              <option value="json">JSON</option>
              <option value="markdown">Markdown</option>
            </select>
            <button onClick={runCode} disabled={running}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-40 px-3 py-1.5 rounded text-xs font-semibold transition-colors shrink-0">
              {running ? "Running…" : "▶ Run"}
            </button>
            <div className="flex-1" />
            <button onClick={downloadZip} title="Download ZIP"
              className="bg-gray-700 hover:bg-gray-600 px-2.5 py-1.5 rounded text-xs font-semibold transition-colors shrink-0 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              ZIP
            </button>
          </>
        ) : (
          <>
            <div className="flex-1" />
            {/* Auto-push to GitHub */}
            <button onClick={autoPushToGitHub} disabled={autoPushStatus === "pushing"}
              className={`px-2.5 py-1.5 rounded text-xs font-semibold transition-colors shrink-0 flex items-center gap-1.5
                ${autoPushStatus === "done" ? "bg-green-700 text-white" : autoPushStatus === "error" ? "bg-red-700 text-white" : "bg-gray-700 hover:bg-gray-600"}`}>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
              {autoPushStatus === "pushing" ? "Saving…" : autoPushStatus === "done" ? "Saved ✓" : autoPushStatus === "error" ? "Failed" : "Save to GitHub"}
            </button>
          </>
        )}
      </div>

      {/* ── CONTENT ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── EDITOR TAB ── */}
        {activeTab === "editor" && (
          <>
            {/* File tree */}
            <div className="w-40 border-r border-gray-800 bg-gray-900 flex flex-col shrink-0">
              <div className="px-3 py-2 text-[10px] text-gray-500 uppercase tracking-wider font-semibold border-b border-gray-800">Explorer</div>
              <div className="flex-1 overflow-y-auto py-1">
                <div onClick={() => setActiveFile(null)}
                  className={`px-3 py-1.5 text-xs cursor-pointer truncate flex items-center gap-1.5 ${activeFile === null ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"}`}>
                  <span className="text-blue-400 text-[10px]">JS</span>
                  main.{EXT[language] ?? "js"}
                </div>
                {files.map((f) => (
                  <div key={f.path} onClick={() => loadFile(f)}
                    className={`px-3 py-1.5 text-xs cursor-pointer truncate flex items-center gap-1.5 ${activeFile === f.path ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"}`}>
                    <span className="text-yellow-400 text-[10px]">F</span>
                    {f.path}
                  </div>
                ))}
              </div>
            </div>

            {/* Monaco editor + output */}
            <div className="flex flex-col flex-1 overflow-hidden">
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
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  }}
                />
              </div>
              <div className="h-40 flex flex-col bg-black border-t border-gray-800 shrink-0">
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 bg-gray-900 shrink-0">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Output</span>
                  <div className="flex-1" />
                  <button onClick={() => setOutput([])} className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors">Clear</button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-0.5 font-mono">
                  {output.length === 0 ? (
                    <span className="text-gray-600 text-xs">Press ▶ Run to execute your code.</span>
                  ) : (
                    output.map((line, i) => (
                      <div key={i} className={`text-xs leading-relaxed ${line.type === "stderr" ? "text-red-400" : line.type === "error" ? "text-red-500" : line.type === "info" ? "text-blue-400" : "text-green-300"}`}>
                        {line.text}
                      </div>
                    ))
                  )}
                  <div ref={outputEndRef} />
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── AI TAB ── */}
        {activeTab === "ai" && (
          <div className="flex flex-col flex-1 overflow-hidden">

            {/* Generate bar */}
            <div className="px-4 py-3 border-b border-gray-800 bg-gray-900 shrink-0">
              <p className="text-[10px] text-gray-500 mb-2 uppercase tracking-wider font-semibold">Generate code with AI</p>
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs placeholder-gray-500 focus:outline-none focus:border-purple-500"
                  placeholder="Describe what you want to build…"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && generateWithAI()}
                  disabled={aiLoading}
                />
                <button onClick={generateWithAI} disabled={aiLoading || !aiPrompt.trim()}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 px-4 py-2 rounded-lg text-xs font-semibold transition-colors shrink-0">
                  {aiLoading ? "…" : "Generate"}
                </button>
              </div>
            </div>

            {/* Scrollable area: prompt grid + chat */}
            <div className="flex-1 overflow-y-auto">

              {/* Prompt groups — shown when no messages */}
              {messages.length === 0 && (
                <div className="p-4">
                  <p className="text-xs text-gray-500 text-center mb-4">Or choose a quick action for your current code</p>
                  <div className="space-y-4">
                    {PROMPT_GROUPS.map((group) => (
                      <div key={group.label}>
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-sm">{group.icon}</span>
                          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">{group.label}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {group.prompts.map((prompt) => (
                            <button key={prompt} onClick={() => handlePromptClick(prompt)}
                              className="text-left text-xs text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-purple-600 rounded-xl px-3 py-3 transition-all leading-relaxed">
                              {prompt}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Chat messages */}
              {messages.length > 0 && (
                <div className="p-4 space-y-3">
                  <button onClick={() => setMessages([])}
                    className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors mb-1">
                    ← Back to prompts
                  </button>
                  {messages.map((m, i) => {
                    const extracted = m.role === "assistant" ? extractFirstCode(m.content) : null;
                    return (
                      <div key={i} className={`flex flex-col gap-1 ${m.role === "user" ? "items-end" : "items-start"}`}>
                        <div className={`text-[10px] font-semibold ${m.role === "user" ? "text-yellow-500" : "text-purple-400"}`}>
                          {m.role === "user" ? "You" : "AI"}
                        </div>
                        <div className={`rounded-xl px-3 py-2 text-xs leading-relaxed max-w-full ${m.role === "user" ? "bg-purple-700 text-white rounded-tr-sm" : "bg-gray-800 text-gray-200 rounded-tl-sm"}`}>
                          {m.role === "assistant" ? renderMarkdown(m.content) : m.content}
                        </div>
                        {extracted && (
                          <button
                            onClick={() => { setCode(extracted); addOutput([{ type: "info", text: "✏️ Code applied to editor" }]); setActiveTab("editor"); }}
                            className="text-[10px] bg-purple-700 hover:bg-purple-600 text-white rounded-lg px-3 py-1.5 mt-0.5 transition-colors font-semibold">
                            ✏️ Apply to Editor
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {chatLoading && (
                    <div className="flex items-start">
                      <div className="bg-gray-800 rounded-xl rounded-tl-sm px-3 py-2 text-xs text-purple-400 flex items-center gap-1.5">
                        <span className="animate-bounce">●</span>
                        <span className="animate-bounce" style={{ animationDelay: "0.15s" }}>●</span>
                        <span className="animate-bounce" style={{ animationDelay: "0.3s" }}>●</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>

            {/* Chat input */}
            <div className="border-t border-gray-800 p-3 shrink-0 bg-gray-950">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse shrink-0" />
                <textarea
                  rows={2}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs placeholder-gray-500 focus:outline-none focus:border-purple-500 resize-none"
                  placeholder="Ask the AI about your code… (Enter to send)"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                  disabled={chatLoading}
                />
                <button onClick={() => sendChat()} disabled={chatLoading || !chatInput.trim()}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 px-3 py-3 rounded-lg text-xs font-semibold transition-colors shrink-0">
                  ↑
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── BOTTOM TAB BAR ── */}
      <div className="flex border-t border-gray-800 bg-gray-900 shrink-0">
        <button
          onClick={() => setActiveTab("editor")}
          className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition-colors ${activeTab === "editor" ? "text-white border-t-2 border-purple-500" : "text-gray-500 hover:text-gray-300"}`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          Editor
        </button>
        <button
          onClick={() => setActiveTab("ai")}
          className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition-colors ${activeTab === "ai" ? "text-white border-t-2 border-purple-500" : "text-gray-500 hover:text-gray-300"}`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          AI Assistant
        </button>
      </div>
    </div>
  );
}
