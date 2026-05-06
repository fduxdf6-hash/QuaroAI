import { Router, type IRouter } from "express";
import { Octokit } from "@octokit/rest";

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
    // Get default branch
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const branch = repoData.default_branch;

    // Get latest commit SHA
    const { data: refData } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    const latestCommitSha = refData.object.sha;

    // Get base tree SHA
    const { data: commitData } = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: latestCommitSha,
    });
    const baseTreeSha = commitData.tree.sha;

    // Create blobs for each file
    const treeItems = await Promise.all(
      files.map(async (file) => {
        const { data: blob } = await octokit.git.createBlob({
          owner,
          repo,
          content: Buffer.from(file.content).toString("base64"),
          encoding: "base64",
        });
        return {
          path: file.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: blob.sha,
        };
      })
    );

    // Create new tree
    const { data: newTree } = await octokit.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: treeItems,
    });

    // Create commit
    const { data: newCommit } = await octokit.git.createCommit({
      owner,
      repo,
      message: commitMessage,
      tree: newTree.sha,
      parents: [latestCommitSha],
    });

    // Update ref
    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
    });

    res.json({
      ok: true,
      commitSha: newCommit.sha,
      url: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "GitHub push failed";
    res.status(500).json({ error: msg });
  }
});

export default router;
