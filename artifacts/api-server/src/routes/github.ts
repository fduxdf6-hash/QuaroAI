import { Router, type IRouter } from "express";
import { Octokit } from "@octokit/rest";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const router: IRouter = Router();

// POST /api/github/push — commit and push files to a GitHub repo
router.post("/push", async (req, res) => {
  const { token, owner, repo, files, message } = req.body as {
    token: string;
    owner: string;
    repo: string;
    files: { path: string; content: string }[];
    message?: string;
  };

  if (!token || !owner || !repo || !files?.length) {
    res.status(400).json({ error: "token, owner, repo, and files are required" });
    return;
  }

  const octokit = new Octokit({ auth: token });
  const commitMessage = message || "Update from QuaroAI";

  try {
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const branch = repoData.default_branch;

    const { data: refData } = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const latestCommitSha = refData.object.sha;

    const { data: commitData } = await octokit.git.getCommit({ owner, repo, commit_sha: latestCommitSha });
    const baseTreeSha = commitData.tree.sha;

    const treeItems = await Promise.all(
      files.map(async (file) => {
        const { data: blob } = await octokit.git.createBlob({
          owner, repo,
          content: Buffer.from(file.content).toString("base64"),
          encoding: "base64",
        });
        return { path: file.path, mode: "100644" as const, type: "blob" as const, sha: blob.sha };
      })
    );

    const { data: newTree } = await octokit.git.createTree({ owner, repo, base_tree: baseTreeSha, tree: treeItems });

    const { data: newCommit } = await octokit.git.createCommit({
      owner, repo,
      message: commitMessage,
      tree: newTree.sha,
      parents: [latestCommitSha],
    });

    await octokit.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: newCommit.sha });

    res.json({ ok: true, commitSha: newCommit.sha, url: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}` });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "GitHub push failed" });
  }
});

// POST /api/github/autopush — push the whole Replit project using REPLIT_PUSH env var
router.post("/autopush", async (_req, res) => {
  const token = process.env.REPLIT_PUSH;
  if (!token) {
    res.status(400).json({ error: "REPLIT_PUSH secret not configured" });
    return;
  }

  try {
    const repoUrl = `https://fduxdf6-hash:${token}@github.com/fduxdf6-hash/QuaroAI.git`;
    const { stdout, stderr } = await execAsync(
      `cd /home/runner/workspace && git config user.email "quaro@replit.app" && git config user.name "QuaroAI" && git add -A && (git diff --cached --quiet || git commit -m "Auto-save from QuaroAI") && git push ${repoUrl} main`,
      { timeout: 30000 }
    );
    res.json({ ok: true, stdout, stderr });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Auto-push failed";
    res.status(500).json({ error: msg });
  }
});

export default router;
