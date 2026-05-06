import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type {
  ChatCompletionTool,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

const execAsync = promisify(exec);
const router: IRouter = Router();

// Per-session workspace: path -> content
const workspaceStore = new Map<string, Map<string, string>>();

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the content of a file from the code workspace",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path, e.g. 'main.js'" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create or update a file in the workspace. Updates the editor in real-time. Always write the complete file content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path, e.g. 'main.js'" },
          content: {
            type: "string",
            description: "Complete file content to write",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List all files currently in the workspace",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "execute_code",
      description:
        "Execute code and return stdout/stderr. Use this to test, validate, and debug code. If it fails, fix it and run again.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Code to execute" },
          language: {
            type: "string",
            enum: ["javascript", "python"],
            description: "Programming language",
          },
        },
        required: ["code", "language"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_shell",
      description:
        "Run a shell command. Use for installing packages (npm install, pip install), checking node/python versions, listing directories, etc.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Shell command to run",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file from the workspace",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to delete" },
        },
        required: ["path"],
      },
    },
  },
];

async function executeTool(
  name: string,
  args: Record<string, string>,
  workspace: Map<string, string>
): Promise<{ result: string; event?: object }> {
  switch (name) {
    case "read_file": {
      const content = workspace.get(args.path);
      if (content === undefined)
        return {
          result: `File '${args.path}' not found. Available: ${Array.from(workspace.keys()).join(", ") || "none"}`,
        };
      return { result: content };
    }

    case "write_file": {
      workspace.set(args.path, args.content);
      return {
        result: `Wrote ${args.content.length} chars to '${args.path}'`,
        event: { type: "write_file", path: args.path, content: args.content },
      };
    }

    case "list_files": {
      const files = Array.from(workspace.keys());
      return {
        result: files.length > 0 ? files.join("\n") : "Workspace is empty",
      };
    }

    case "delete_file": {
      const existed = workspace.delete(args.path);
      return {
        result: existed ? `Deleted '${args.path}'` : `File '${args.path}' not found`,
        event: existed ? { type: "delete_file", path: args.path } : undefined,
      };
    }

    case "execute_code": {
      try {
        const lang = (args.language || "javascript").toLowerCase();
        if (lang === "javascript" || lang === "js") {
          const wrapped = `(async () => { ${args.code} })().catch(e => { process.stderr.write(String(e)); process.exit(1); })`;
          const escaped = wrapped.replace(/'/g, `'\\''`);
          const r = await execAsync(`node -e '${escaped}'`, { timeout: 10000 });
          const out = [r.stdout && `STDOUT:\n${r.stdout}`, r.stderr && `STDERR:\n${r.stderr}`].filter(Boolean).join("\n");
          return { result: out || "✓ No output" };
        } else if (lang === "python" || lang === "py") {
          const escaped = args.code.replace(/'/g, `'\\''`);
          const r = await execAsync(`python3 -c '${escaped}'`, { timeout: 10000 });
          const out = [r.stdout && `STDOUT:\n${r.stdout}`, r.stderr && `STDERR:\n${r.stderr}`].filter(Boolean).join("\n");
          return { result: out || "✓ No output" };
        }
        return { result: `Language '${args.language}' not supported for execution` };
      } catch (err: unknown) {
        if (err && typeof err === "object" && "stdout" in err && "stderr" in err) {
          const e = err as { stdout: string; stderr: string };
          return { result: `STDOUT:\n${e.stdout}\nSTDERR:\n${e.stderr}` };
        }
        return { result: `Error: ${err instanceof Error ? err.message : "Execution failed"}` };
      }
    }

    case "run_shell": {
      try {
        const r = await execAsync(args.command, { timeout: 30000 });
        const out = [r.stdout && `STDOUT:\n${r.stdout}`, r.stderr && `STDERR:\n${r.stderr}`].filter(Boolean).join("\n");
        return { result: out || "✓ Command completed with no output" };
      } catch (err: unknown) {
        if (err && typeof err === "object" && "stdout" in err && "stderr" in err) {
          const e = err as { stdout: string; stderr: string };
          return { result: `STDOUT:\n${e.stdout}\nSTDERR:\n${e.stderr}` };
        }
        return { result: `Error: ${err instanceof Error ? err.message : "Command failed"}` };
      }
    }

    default:
      return { result: `Unknown tool: ${name}` };
  }
}

// POST /api/agent/run — autonomous agent with tool calling (SSE)
router.post("/run", async (req, res) => {
  const { task, files, code, language, sessionId } = req.body as {
    task: string;
    files?: { path: string; content: string }[];
    code?: string;
    language?: string;
    sessionId?: string;
  };

  if (!task?.trim()) {
    res.status(400).json({ error: "task required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (event: object) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Build workspace from editor state
  const wsKey = sessionId ?? "default";
  const workspace = new Map<string, string>();
  workspaceStore.set(wsKey, workspace);

  const ext = { javascript: "js", python: "py", typescript: "ts", html: "html", css: "css", json: "json" }[language ?? "javascript"] ?? "js";
  if (code?.trim()) workspace.set(`main.${ext}`, code);
  if (files?.length) for (const f of files) workspace.set(f.path, f.content);

  const filesList = Array.from(workspace.keys()).join(", ") || "none yet";

  const systemPrompt = `You are QuaroAI Agent — an autonomous, expert full-stack coding AI embedded in a live code editor.

## Your Capabilities
You have FULL access to a live workspace via tools. You can:
- Read and write files (write_file updates the Monaco editor in real-time)
- Execute JavaScript and Python code to test and validate your work  
- Run shell commands to install packages, check versions, explore directories
- Delete files you no longer need
- Loop with multiple tool calls until the task is FULLY complete

## Current Workspace
Files: ${filesList}
Language: ${language ?? "javascript"}

## How to Work
1. **Understand first**: Read relevant files before making changes
2. **Think step by step**: Break complex tasks into smaller actions
3. **Validate your work**: After writing code, ALWAYS execute it to confirm it works
4. **Fix errors autonomously**: If execution fails, analyze the error, fix the code, run again
5. **Be thorough**: Don't stop at partial solutions — complete the entire task
6. **Write real code**: No placeholders, no TODOs — fully working production code only

## On Completion
Summarize what you built, what changed, and any important notes for the developer.`;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: task },
  ];

  send({ type: "start", task });

  const MAX_ITERATIONS = 20;
  let iter = 0;

  try {
    while (iter < MAX_ITERATIONS) {
      iter++;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        stream: false,
        max_tokens: 4096,
      });

      const choice = response.choices[0];
      const msg = choice.message;
      messages.push(msg);

      // Stream any reasoning/text the AI outputs
      if (msg.content) {
        send({ type: "thought", content: msg.content });
      }

      // Agent is done — no more tool calls
      if (choice.finish_reason === "stop" || !msg.tool_calls?.length) {
        send({ type: "done", content: msg.content ?? "✅ Task complete." });
        break;
      }

      // Execute each tool call
      for (const toolCall of msg.tool_calls) {
        const toolName = toolCall.function.name;
        let toolArgs: Record<string, string> = {};
        try {
          toolArgs = JSON.parse(toolCall.function.arguments);
        } catch {}

        // Notify frontend of tool call
        send({ type: "tool_call", name: toolName, args: toolArgs });

        // Run the tool
        const { result, event } = await executeTool(toolName, toolArgs, workspace);

        // Emit any extra events (write_file, delete_file) to update the editor
        if (event) send(event);

        // Emit result
        send({ type: "tool_result", name: toolName, output: result.slice(0, 3000) });

        // Feed result back to model
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    }

    if (iter >= MAX_ITERATIONS) {
      send({ type: "done", content: "⚠️ Reached maximum steps. Task may need more iterations." });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Agent error";
    send({ type: "error", content: msg });
  }

  res.end();
});

export default router;
