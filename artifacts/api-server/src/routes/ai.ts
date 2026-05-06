import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const router: IRouter = Router();

// In-memory file store per session (keyed by a simple session concept)
const fileStore = new Map<string, { path: string; content: string }[]>();

// POST /api/ai/chat — streaming AI chat with code context (SSE)
router.post("/chat", async (req, res) => {
  const { messages, code, language } = req.body as {
    messages: { role: "user" | "assistant"; content: string }[];
    code?: string;
    language?: string;
  };

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: "messages array required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const systemPrompt = `You are QuaroAI, an expert coding assistant embedded in a live code editor. You help developers write, debug, and understand code.

${code ? `Current code in editor (${language || "unknown"}):\n\`\`\`${language || ""}\n${code}\n\`\`\`` : ""}

Guidelines:
- Be concise and direct
- When providing code fixes or improvements, wrap them in triple backtick code blocks with the language
- When you spot errors in the code, explain them clearly and provide the fix
- If asked to rewrite code, output the complete corrected version in a code block`;

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "AI error";
    res.write(`data: ${JSON.stringify({ error: msg, done: true })}\n\n`);
    res.end();
  }
});

// POST /api/ai/run — generate code from a natural language prompt
router.post("/run", async (req, res) => {
  const { prompt, files, language } = req.body as {
    prompt: string;
    files?: { path: string; content: string }[];
    language?: string;
  };

  if (!prompt) {
    res.status(400).json({ error: "prompt required" });
    return;
  }

  const lang = language || "javascript";

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 8192,
      messages: [
        {
          role: "system",
          content: `You are QuaroAI, an expert coding assistant. When given a task, respond with JSON in this exact format:
{
  "explanation": "Brief explanation of what you built",
  "code": "The complete code solution",
  "language": "${lang}",
  "files": [{"path": "main.${lang === "python" ? "py" : "js"}", "content": "full file content"}],
  "commands": []
}
Always output valid JSON only. No markdown, no extra text.`,
        },
        {
          role: "user",
          content: `Task: ${prompt}\nLanguage: ${lang}\n${files?.length ? `Existing files: ${JSON.stringify(files)}` : ""}`,
        },
      ],
      stream: false,
    });

    const raw = response.choices[0]?.message?.content ?? "{}";

    let parsed: {
      explanation?: string;
      code?: string;
      language?: string;
      files?: { path: string; content: string }[];
      commands?: string[];
    };

    try {
      parsed = JSON.parse(raw);
    } catch {
      // fallback: extract code block
      const codeMatch = raw.match(/```[\w]*\n([\s\S]*?)```/);
      parsed = {
        explanation: "Here is the generated code.",
        code: codeMatch ? codeMatch[1] : raw,
        files: [],
        commands: [],
      };
    }

    res.json({
      explanation: parsed.explanation ?? "Done.",
      code: parsed.code ?? "",
      language: parsed.language ?? lang,
      files: parsed.files ?? [],
      commands: parsed.commands ?? [],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "AI error";
    res.status(500).json({ error: msg });
  }
});

// POST /api/ai/exec — execute code safely with child_process
router.post("/exec", async (req, res) => {
  const { code, language, command } = req.body as {
    code?: string;
    language?: string;
    command?: string;
  };

  const TIMEOUT_MS = 10000;

  try {
    let stdout = "";
    let stderr = "";

    if (command) {
      // Execute a shell command (restricted)
      const result = await execAsync(command, { timeout: TIMEOUT_MS });
      stdout = result.stdout;
      stderr = result.stderr;
    } else if (code) {
      const lang = (language || "javascript").toLowerCase();

      if (lang === "javascript" || lang === "js") {
        // Wrap code so console.log output is captured
        const wrapped = `(async () => { ${code} })().catch(e => { process.stderr.write(e.message); process.exit(1); })`;
        const escaped = wrapped.replace(/'/g, `'\\''`);
        const result = await execAsync(`node -e '${escaped}'`, {
          timeout: TIMEOUT_MS,
        });
        stdout = result.stdout;
        stderr = result.stderr;
      } else if (lang === "python" || lang === "py") {
        const escaped = code.replace(/'/g, `'\\''`);
        const result = await execAsync(`python3 -c '${escaped}'`, {
          timeout: TIMEOUT_MS,
        });
        stdout = result.stdout;
        stderr = result.stderr;
      } else {
        res.json({ stdout: "", stderr: `Language "${lang}" not supported for execution.`, exitCode: 1 });
        return;
      }
    } else {
      res.status(400).json({ error: "code or command required" });
      return;
    }

    res.json({ stdout, stderr, exitCode: 0 });
  } catch (err: unknown) {
    // child_process throws on non-zero exit
    if (err && typeof err === "object" && "stdout" in err && "stderr" in err) {
      const e = err as { stdout: string; stderr: string; code: number };
      res.json({ stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.code ?? 1 });
    } else {
      const msg = err instanceof Error ? err.message : "Execution error";
      res.json({ stdout: "", stderr: msg, exitCode: 1 });
    }
  }
});

// POST /api/ai/apply — store applied files in memory
router.post("/apply", async (req, res) => {
  const { files, sessionId } = req.body as {
    files: { path: string; content: string }[];
    sessionId?: string;
  };

  const key = sessionId ?? "default";
  fileStore.set(key, files ?? []);

  res.json({ ok: true, count: files?.length ?? 0 });
});

export default router;
