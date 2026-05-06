import { useState, useRef, useEffect, useCallback } from "react";
import Editor from "@monaco-editor/react";
import axios from "axios";
import JSZip from "jszip";
import { saveAs } from "file-saver";

const API = "";
type Message = { role: "user" | "assistant"; content: string };
type FileEntry = { path: string; content: string };
type OutputLine = { type: "stdout" | "stderr" | "info" | "error"; text: string };
type Tab = "editor" | "ai" | "agent";

type AgentEvent =
  | { type: "start"; task: string }
  | { type: "thought"; content: string }
  | { type: "tool_call"; name: string; args: Record<string, string> }
  | { type: "tool_result"; name: string; output: string }
  | { type: "write_file"; path: string; content: string }
  | { type: "delete_file"; path: string }
  | { type: "done"; content: string }
  | { type: "error"; content: string };

const STARTER_CODE: Record<string, string> = {
  javascript: `// Welcome to QuaroAI ⚡\n// Edit code here, run it, or ask the AI for help\n\nfunction greet(name) {\n  return \`Hello, \${name}!\`;\n}\n\nconsole.log(greet("World"));\n`,
  python: `# Welcome to QuaroAI ⚡\n# Edit code here, run it, or ask the AI for help\n\ndef greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("World"))\n`,
  typescript: `// Welcome to QuaroAI ⚡\nfunction greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\nconsole.log(greet("World"));\n`,
  html: `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8"><title>QuaroAI</title></head>\n<body><h1>Hello, World!</h1></body>\n</html>\n`,
};
const EXT: Record<string, string> = {
  javascript: "js", typescript: "ts", python: "py", html: "html", css: "css", json: "json", markdown: "md",
};
const PROMPT_GROUPS = [
  { label: "Understand", icon: "📖", prompts: ["Explain this code", "What edge cases am I missing?"] },
  { label: "Fix", icon: "🔧", prompts: ["Fix any bugs", "Add error handling"] },
  { label: "Improve", icon: "✨", prompts: ["How can I improve this?", "Optimize for performance"] },
  { label: "Transform", icon: "🔄", prompts: ["Convert this to TypeScript", "Refactor to use async/await"] },
  { label: "Document", icon: "📝", prompts: ["Add comments to this code", "Add unit tests for this"] },
];
const TOOL_META: Record<string, { icon: string; label: string; color: string }> = {
  read_file: { icon: "📖", label: "Reading", color: "text-blue-400" },
  write_file: { icon: "✏️", label: "Writing", color: "text-green-400" },
  list_files: { icon: "📁", label: "Listing files", color: "text-gray-400" },
  execute_code: { icon: "▶", label: "Executing", color: "text-yellow-400" },
  run_shell: { icon: "⚡", label: "Running command", color: "text-orange-400" },
  delete_file: { icon: "🗑️", label: "Deleting", color: "text-red-400" },
};

function extractFirstCode(text: string): string | null {
  const m = text.match(/```(?:\w*)\n?([\s\S]*?)```/);
  return m ? m[1].trim() : null;
}

function renderMarkdown(text: string): JSX.Element[] {
  const parts: JSX.Element[] = [];
  text.split(/(```[\s\S]*?```)/g).forEach((block, i) => {
    if (block.startsWith("```")) {
      const m = block.match(/```(\w*)\n?([\s\S]*?)```/);
      const lang = m?.[1] || "";
      const code = (m?.[2] ?? block.slice(3, -3)).trim();
      parts.push(
        <pre key={i} className="bg-gray-900 border border-gray-700 rounded p-3 my-2 overflow-x-auto text-xs font-mono text-green-300 whitespace-pre-wrap">
          {lang && <div className="text-gray-500 text-[10px] mb-1 uppercase">{lang}</div>}
          {code}
        </pre>
      );
    } else {
      parts.push(<span key={i}>{block.split("\n").map((l, j, a) => <span key={j}>{l}{j < a.length - 1 && <br />}</span>)}</span>);
    }
  });
  return parts;
}

function GitHubModal({ onClose, files, code, language }: { onClose: () => void; files: FileEntry[]; code: string; language: string }) {
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
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Push failed" });
      setStatus("error");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-96 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-sm text-white">Push to GitHub</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg">×</button>
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
            <div><label className="text-xs text-gray-400 mb-1 block">GitHub Token (PAT)</label>
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_xxxxxxxxxxxx"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs focus:outline-none focus:border-blue-500" /></div>
            <div><label className="text-xs text-gray-400 mb-1 block">Repository (owner/repo)</label>
              <input value={repoFull} onChange={(e) => setRepoFull(e.target.value)} placeholder="username/my-repo"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs focus:outline-none focus:border-blue-500" /></div>
            <div><label className="text-xs text-gray-400 mb-1 block">Commit message</label>
              <input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs focus:outline-none focus:border-blue-500" /></div>
            <div className="text-xs text-gray-600">{allFiles.length} file(s) will be pushed</div>
            {status === "error" && <div className="text-xs text-red-400">{result.error}</div>}
            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 rounded py-2 text-xs">Cancel</button>
              <button onClick={push} disabled={status === "pushing" || !token || !repoFull}
                className="flex-1 bg-gray-800 border border-gray-600 hover:bg-gray-700 disabled:opacity-40 rounded py-2 text-xs font-semibold flex items-center justify-center gap-1.5">
                {status === "pushing" ? "Pushing…" : "Push to GitHub"}
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

  // Agent state
  const [agentTask, setAgentTask] = useState("");
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [expandedResults, setExpandedResults] = useState<Set<number>>(new Set());

  const chatEndRef = useRef<HTMLDivElement>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);
  const agentEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, chatLoading]);
  useEffect(() => { outputEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [output]);
  useEffect(() => { agentEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [agentEvents]);

  const addOutput = (lines: OutputLine[]) => setOutput((p) => [...p, ...lines]);

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
    } catch (err) {
      addOutput([{ type: "error", text: "❌ " + (err instanceof Error ? err.message : "Execution failed") }]);
    }
    setRunning(false);
  }, [code, language, running]);

  const sendChat = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? chatInput).trim();
    if (!text || chatLoading) return;
    setChatInput("");
    const newMsgs: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMsgs);
    setChatLoading(true);
    try {
      const response = await fetch(`${API}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMsgs, code, language }),
      });
      if (!response.body) throw new Error("No stream");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      setMessages((p) => [...p, { role: "assistant", content: "" }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split("\n").filter((l) => l.startsWith("data: "))) {
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.content) {
              assistantText += parsed.content;
              setMessages((p) => { const u = [...p]; u[u.length - 1] = { role: "assistant", content: assistantText }; return u; });
            }
          } catch {}
        }
      }
    } catch (err) {
      setMessages((p) => [...p, { role: "assistant", content: `❌ ${err instanceof Error ? err.message : "AI error"}` }]);
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
      const { explanation, code: newCode, files: newFiles } = res.data;
      if (explanation) addOutput([{ type: "info", text: "🧠 " + explanation }]);
      if (newCode) { setCode(newCode); addOutput([{ type: "info", text: "📝 Code updated in editor" }]); }
      if (newFiles?.length) { setFiles(newFiles); addOutput([{ type: "info", text: `📁 ${newFiles.length} file(s) applied` }]); }
    } catch (err) {
      addOutput([{ type: "error", text: "❌ " + (err instanceof Error ? err.message : "Error") }]);
    }
    setAiLoading(false);
  }, [aiPrompt, aiLoading, language, files]);

  const downloadZip = useCallback(async () => {
    const zip = new JSZip();
    const mainName = `main.${EXT[language] ?? "js"}`;
    zip.file(mainName, code);
    files.forEach((f) => { if (f.path !== mainName) zip.file(f.path, f.content); });
    saveAs(await zip.generateAsync({ type: "blob" }), "quaro-project.zip");
  }, [code, language, files]);

  const autoPush = useCallback(async () => {
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

  const runAgent = useCallback(async () => {
    const task = agentTask.trim();
    if (!task || agentRunning) return;
    setAgentRunning(true);
    setAgentEvents([]);
    setExpandedResults(new Set());

    try {
      const response = await fetch(`${API}/api/agent/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, code, language, files }),
      });
      if (!response.body) throw new Error("No stream");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event: AgentEvent = JSON.parse(line.slice(6));
            setAgentEvents((p) => [...p, event]);
            // When agent writes a file, update the editor
            if (event.type === "write_file") {
              const mainExt = EXT[language] ?? "js";
              const mainPath = `main.${mainExt}`;
              if (event.path === mainPath) {
                setCode(event.content);
              } else {
                setFiles((prev) => {
                  const idx = prev.findIndex((f) => f.path === event.path);
                  if (idx >= 0) { const u = [...prev]; u[idx] = { path: event.path, content: event.content }; return u; }
                  return [...prev, { path: event.path, content: event.content }];
                });
              }
            }
          } catch {}
        }
      }
    } catch (err) {
      setAgentEvents((p) => [...p, { type: "error", content: err instanceof Error ? err.message : "Agent failed" }]);
    }
    setAgentRunning(false);
  }, [agentTask, agentRunning, code, language, files]);

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang);
    if (STARTER_CODE[lang]) setCode(STARTER_CODE[lang]);
  };

  const loadFile = (f: FileEntry) => { setActiveFile(f.path); setCode(f.content); };

  const agentDone = agentEvents.some((e) => e.type === "done" || e.type === "error");
  const filesWritten = agentEvents.filter((e) => e.type === "write_file").length;

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 text-sm overflow-hidden">
      {showGitHub && <GitHubModal onClose={() => setShowGitHub(false)} files={files} code={code} language={language} />}

      {/* ── TOP BAR ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 bg-gray-900 shrink-0">
        <span className="font-bold text-base tracking-tight shrink-0">⚡ QuaroAI</span>
        {activeTab === "editor" && (
          <>
            <select value={language} onChange={(e) => handleLanguageChange(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none shrink-0">
              {["javascript","typescript","python","html","css","json","markdown"].map((l) => (
                <option key={l} value={l}>{l.charAt(0).toUpperCase()+l.slice(1)}</option>
              ))}
            </select>
            <button onClick={runCode} disabled={running}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-40 px-3 py-1.5 rounded text-xs font-semibold shrink-0">
              {running ? "Running…" : "▶ Run"}
            </button>
            <div className="flex-1" />
            <button onClick={downloadZip} title="Download ZIP"
              className="bg-gray-700 hover:bg-gray-600 px-2.5 py-1.5 rounded text-xs font-semibold shrink-0 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              ZIP
            </button>
            <button onClick={() => setShowGitHub(true)} className="bg-gray-700 hover:bg-gray-600 px-2.5 py-1.5 rounded text-xs font-semibold shrink-0 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              GitHub
            </button>
          </>
        )}
        {activeTab === "ai" && (
          <>
            <div className="flex-1" />
            <button onClick={autoPush} disabled={autoPushStatus === "pushing"}
              className={`px-2.5 py-1.5 rounded text-xs font-semibold shrink-0 flex items-center gap-1 transition-colors ${autoPushStatus === "done" ? "bg-green-700" : autoPushStatus === "error" ? "bg-red-700" : "bg-gray-700 hover:bg-gray-600"}`}>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              {autoPushStatus === "pushing" ? "Saving…" : autoPushStatus === "done" ? "Saved ✓" : autoPushStatus === "error" ? "Failed" : "Save to GitHub"}
            </button>
          </>
        )}
        {activeTab === "agent" && (
          <>
            <span className="text-[10px] bg-purple-900 text-purple-300 px-2 py-0.5 rounded-full border border-purple-700 font-semibold shrink-0">AUTONOMOUS</span>
            <div className="flex-1" />
            {filesWritten > 0 && (
              <span className="text-[10px] text-green-400 shrink-0">{filesWritten} file{filesWritten !== 1 ? "s" : ""} updated</span>
            )}
            {agentDone && (
              <button onClick={() => { setAgentEvents([]); setAgentTask(""); }}
                className="bg-gray-700 hover:bg-gray-600 px-2.5 py-1.5 rounded text-xs font-semibold shrink-0">
                New Task
              </button>
            )}
          </>
        )}
      </div>

      {/* ── CONTENT ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* EDITOR TAB */}
        {activeTab === "editor" && (
          <>
            <div className="w-40 border-r border-gray-800 bg-gray-900 flex flex-col shrink-0">
              <div className="px-3 py-2 text-[10px] text-gray-500 uppercase tracking-wider font-semibold border-b border-gray-800">Explorer</div>
              <div className="flex-1 overflow-y-auto py-1">
                <div onClick={() => setActiveFile(null)}
                  className={`px-3 py-1.5 text-xs cursor-pointer truncate flex items-center gap-1.5 ${activeFile === null ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-800"}`}>
                  <span className="text-blue-400 text-[10px] font-bold uppercase">{EXT[language] ?? "js"}</span>
                  main.{EXT[language] ?? "js"}
                </div>
                {files.map((f) => (
                  <div key={f.path} onClick={() => loadFile(f)}
                    className={`px-3 py-1.5 text-xs cursor-pointer truncate flex items-center gap-1.5 ${activeFile === f.path ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-800"}`}>
                    <span className="text-yellow-400 text-[10px]">F</span>{f.path}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-hidden">
                <Editor
                  height="100%"
                  language={["python","typescript","html","css","json","markdown"].includes(language) ? language : "javascript"}
                  value={code}
                  onChange={(val) => setCode(val ?? "")}
                  theme="vs-dark"
                  options={{ fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on", lineNumbers: "on", renderLineHighlight: "all", padding: { top: 12 }, tabSize: 2, automaticLayout: true, fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                />
              </div>
              <div className="h-40 flex flex-col bg-black border-t border-gray-800 shrink-0">
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 bg-gray-900 shrink-0">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Output</span>
                  <div className="flex-1" />
                  <button onClick={() => setOutput([])} className="text-[10px] text-gray-600 hover:text-gray-400">Clear</button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-0.5 font-mono">
                  {output.length === 0 ? <span className="text-gray-600 text-xs">Press ▶ Run to execute your code.</span>
                    : output.map((line, i) => (
                      <div key={i} className={`text-xs leading-relaxed ${line.type === "stderr" || line.type === "error" ? "text-red-400" : line.type === "info" ? "text-blue-400" : "text-green-300"}`}>{line.text}</div>
                    ))}
                  <div ref={outputEndRef} />
                </div>
              </div>
            </div>
          </>
        )}

        {/* AI ASSISTANT TAB */}
        {activeTab === "ai" && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 bg-gray-900 shrink-0">
              <p className="text-[10px] text-gray-500 mb-2 uppercase tracking-wider font-semibold">Generate code with AI</p>
              <div className="flex gap-2">
                <input className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs placeholder-gray-500 focus:outline-none focus:border-purple-500"
                  placeholder="Describe what you want to build…" value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && generateWithAI()} disabled={aiLoading} />
                <button onClick={generateWithAI} disabled={aiLoading || !aiPrompt.trim()}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 px-4 py-2 rounded-lg text-xs font-semibold shrink-0">
                  {aiLoading ? "…" : "Generate"}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
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
                            <button key={prompt} onClick={() => sendChat(prompt)}
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
              {messages.length > 0 && (
                <div className="p-4 space-y-3">
                  <button onClick={() => setMessages([])} className="text-[10px] text-gray-600 hover:text-gray-400 mb-1">← Back to prompts</button>
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
                          <button onClick={() => { setCode(extracted); addOutput([{ type: "info", text: "✏️ Code applied to editor" }]); setActiveTab("editor"); }}
                            className="text-[10px] bg-purple-700 hover:bg-purple-600 text-white rounded-lg px-3 py-1.5 transition-colors font-semibold">
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
            <div className="border-t border-gray-800 p-3 shrink-0 bg-gray-950">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse shrink-0" />
                <textarea rows={2}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs placeholder-gray-500 focus:outline-none focus:border-purple-500 resize-none"
                  placeholder="Ask the AI about your code… (Enter to send)"
                  value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                  disabled={chatLoading} />
                <button onClick={() => sendChat()} disabled={chatLoading || !chatInput.trim()}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 px-3 py-3 rounded-lg text-xs font-semibold shrink-0">↑</button>
              </div>
            </div>
          </div>
        )}

        {/* AGENT TAB */}
        {activeTab === "agent" && (
          <div className="flex flex-col flex-1 overflow-hidden">

            {/* Task input */}
            {agentEvents.length === 0 && (
              <div className="p-4 border-b border-gray-800 bg-gray-900 shrink-0">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                  <span className="text-xs font-semibold text-gray-200">QuaroAI Agent</span>
                  <span className="text-[10px] text-gray-500">— Reads, writes, runs, and fixes code autonomously</span>
                </div>
                <textarea
                  rows={4}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm placeholder-gray-500 focus:outline-none focus:border-purple-500 resize-none"
                  placeholder={`Describe any task, e.g.:\n• "Fix all the bugs in my code"\n• "Build a REST API with Express"\n• "Refactor this to TypeScript with proper types"\n• "Add input validation and error handling"`}
                  value={agentTask}
                  onChange={(e) => setAgentTask(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) runAgent(); }}
                />
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[10px] text-gray-600">Agent sees your current editor code · Cmd+Enter to run</span>
                  <button onClick={runAgent} disabled={agentRunning || !agentTask.trim()}
                    className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 px-5 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-2">
                    <span>{agentRunning ? "Running…" : "⚡ Run Agent"}</span>
                    {agentRunning && <span className="animate-spin text-xs">◌</span>}
                  </button>
                </div>

                {/* Example tasks */}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {[
                    "Fix all bugs in my code and test it",
                    "Add full error handling and validation",
                    "Refactor to be more readable and efficient",
                    "Write unit tests for every function",
                    "Add TypeScript types throughout",
                    "Build a complete REST API with Express",
                  ].map((t) => (
                    <button key={t} onClick={() => setAgentTask(t)}
                      className="text-left text-[11px] text-gray-400 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-purple-600 rounded-lg px-3 py-2.5 transition-all leading-relaxed">
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Live activity feed */}
            {agentEvents.length > 0 && (
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {agentEvents.map((event, i) => {
                  if (event.type === "start") return (
                    <div key={i} className="bg-gray-800 border border-gray-700 rounded-xl p-3 flex items-start gap-3">
                      <span className="text-purple-400 mt-0.5">⚡</span>
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase font-semibold mb-0.5">Task started</div>
                        <div className="text-xs text-gray-200">{event.task}</div>
                      </div>
                    </div>
                  );

                  if (event.type === "thought") return (
                    <div key={i} className="flex items-start gap-2 pl-1">
                      <span className="text-purple-400 text-xs mt-0.5 shrink-0">🧠</span>
                      <div className="text-xs text-gray-400 leading-relaxed italic">{event.content}</div>
                    </div>
                  );

                  if (event.type === "tool_call") {
                    const meta = TOOL_META[event.name] ?? { icon: "🔧", label: event.name, color: "text-gray-400" };
                    const argStr = Object.entries(event.args).map(([k, v]) => `${k}: ${String(v).slice(0, 60)}${String(v).length > 60 ? "…" : ""}`).join(" · ");
                    return (
                      <div key={i} className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 flex items-center gap-2">
                        <span className={`${meta.color} shrink-0 text-sm`}>{meta.icon}</span>
                        <div className="min-w-0">
                          <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
                          {argStr && <span className="text-[10px] text-gray-500 ml-2 truncate">{argStr}</span>}
                        </div>
                        <div className="ml-auto shrink-0 flex gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-bounce" />
                          <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-bounce" style={{ animationDelay: "0.15s" }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-bounce" style={{ animationDelay: "0.3s" }} />
                        </div>
                      </div>
                    );
                  }

                  if (event.type === "tool_result") {
                    const isExpanded = expandedResults.has(i);
                    const preview = event.output.slice(0, 120);
                    const hasMore = event.output.length > 120;
                    const isError = event.output.toLowerCase().includes("error") || event.output.toLowerCase().includes("stderr");
                    return (
                      <div key={i} className={`rounded-lg px-3 py-2 border ${isError ? "bg-red-950/30 border-red-900" : "bg-green-950/20 border-green-900/40"}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className={`text-[10px] font-mono leading-relaxed ${isError ? "text-red-300" : "text-green-300"}`}>
                            {isExpanded ? event.output : preview}{!isExpanded && hasMore ? "…" : ""}
                          </div>
                          {hasMore && (
                            <button onClick={() => setExpandedResults((s) => { const n = new Set(s); isExpanded ? n.delete(i) : n.add(i); return n; })}
                              className="text-[9px] text-gray-600 hover:text-gray-400 shrink-0 whitespace-nowrap">
                              {isExpanded ? "less" : "more"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  }

                  if (event.type === "write_file") return (
                    <div key={i} className="bg-blue-950/30 border border-blue-900/50 rounded-lg px-3 py-2 flex items-center gap-2">
                      <span className="text-blue-400 text-sm shrink-0">✏️</span>
                      <div>
                        <span className="text-xs text-blue-300 font-semibold">Updated </span>
                        <span className="text-xs text-blue-400 font-mono">{event.path}</span>
                        <span className="text-[10px] text-gray-500 ml-2">→ editor updated</span>
                      </div>
                    </div>
                  );

                  if (event.type === "delete_file") return (
                    <div key={i} className="bg-red-950/20 border border-red-900/40 rounded-lg px-3 py-2 flex items-center gap-2">
                      <span className="text-red-400 text-sm shrink-0">🗑️</span>
                      <span className="text-xs text-red-300 font-mono">Deleted {event.path}</span>
                    </div>
                  );

                  if (event.type === "done") return (
                    <div key={i} className="bg-green-950/30 border border-green-700/60 rounded-xl p-4 mt-2">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-green-400 text-lg">✅</span>
                        <span className="text-xs font-bold text-green-300">Task Complete</span>
                      </div>
                      <div className="text-xs text-gray-300 leading-relaxed">{renderMarkdown(event.content)}</div>
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => setActiveTab("editor")}
                          className="bg-green-700 hover:bg-green-600 px-3 py-1.5 rounded text-xs font-semibold">
                          View in Editor
                        </button>
                        <button onClick={() => { setAgentEvents([]); setAgentTask(""); }}
                          className="bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded text-xs font-semibold">
                          New Task
                        </button>
                      </div>
                    </div>
                  );

                  if (event.type === "error") return (
                    <div key={i} className="bg-red-950/40 border border-red-700/60 rounded-xl p-4 mt-2">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-red-400">❌</span>
                        <span className="text-xs font-bold text-red-300">Agent Error</span>
                      </div>
                      <div className="text-xs text-red-300 font-mono leading-relaxed">{event.content}</div>
                      <button onClick={() => { setAgentEvents([]); }}
                        className="mt-3 bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded text-xs font-semibold">
                        Try Again
                      </button>
                    </div>
                  );

                  return null;
                })}

                {/* Live spinner while running */}
                {agentRunning && (
                  <div className="flex items-center gap-2 px-3 py-2 text-purple-400">
                    <span className="animate-spin text-sm">◌</span>
                    <span className="text-xs text-gray-500 animate-pulse">Agent working…</span>
                  </div>
                )}
                <div ref={agentEndRef} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── BOTTOM TAB BAR ── */}
      <div className="flex border-t border-gray-800 bg-gray-900 shrink-0">
        {([
          { id: "editor", label: "Editor", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg> },
          { id: "ai", label: "AI Assistant", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg> },
          { id: "agent", label: "Agent", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>, badge: agentRunning },
        ] as const).map(({ id, label, icon, badge }) => (
          <button key={id} onClick={() => setActiveTab(id as Tab)}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition-colors relative ${activeTab === id ? "text-white border-t-2 border-purple-500" : "text-gray-500 hover:text-gray-300"}`}>
            {icon}
            {label}
            {badge && <span className="absolute top-1.5 right-1/4 w-2 h-2 rounded-full bg-purple-500 animate-pulse" />}
          </button>
        ))}
      </div>
    </div>
  );
}
