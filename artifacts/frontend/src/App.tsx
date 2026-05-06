import { useState } from "react";
import axios from "axios";

const API = "";

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<{ path: string; content?: string }[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function runAI() {
    if (!prompt) return;

    setLoading(true);
    setLogs(["🚀 Running AI..."]);

    try {
      const res = await axios.post(`${API}/api/ai/run`, { prompt, files });
      const data = res.data;

      setLogs((prev) => [...prev, "🧠 " + data.explanation]);

      if (data.files?.length) {
        await axios.post(`${API}/api/ai/apply`, { files: data.files });
        setFiles(data.files);
        setLogs((prev) => [...prev, "📁 Files applied"]);
      }

      for (const cmd of data.commands || []) {
        const exec = await axios.post(`${API}/api/ai/exec`, { command: cmd });
        setLogs((prev) => [
          ...prev,
          `⚡ ${cmd}`,
          exec.data.stdout || exec.data.stderr,
        ]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setLogs((prev) => [...prev, "❌ Error: " + msg]);
    }

    setLoading(false);
  }

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
      {/* TOP BAR */}
      <div className="p-3 border-b border-gray-800 flex justify-between items-center">
        <h1 className="font-bold text-lg">⚡ Quaro AI</h1>
        <button
          onClick={runAI}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-1.5 rounded text-sm font-medium transition-colors"
        >
          {loading ? "Running..." : "Run"}
        </button>
      </div>

      {/* MAIN */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: FILES */}
        <div className="w-1/4 border-r border-gray-800 p-3 overflow-auto">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Files</h2>
          {files.length === 0 && (
            <p className="text-xs text-gray-600 italic">No files yet</p>
          )}
          {files.map((f, i) => (
            <div key={i} className="text-xs mb-2 text-gray-300">
              📄 {f.path}
            </div>
          ))}
        </div>

        {/* CENTER: EDITOR */}
        <div className="flex-1 p-3 flex flex-col">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Prompt</h2>
          <textarea
            className="flex-1 bg-gray-900 border border-gray-700 p-3 rounded text-sm resize-none focus:outline-none focus:border-blue-500 text-gray-100 placeholder-gray-600"
            placeholder="Type your idea... e.g. Build a REST API"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        {/* RIGHT: TERMINAL */}
        <div className="w-1/3 border-l border-gray-800 p-3 overflow-auto bg-black">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Terminal</h2>
          {logs.length === 0 && (
            <p className="text-xs text-gray-600 italic">Output will appear here</p>
          )}
          {logs.map((log, i) => (
            <div key={i} className="text-xs mb-1 font-mono text-green-400">
              {log}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
