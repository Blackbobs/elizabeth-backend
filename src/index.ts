import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";
import tmp from "tmp";
import path from "path";
import axios from "axios";
import fs from "fs-extra";
// import { HfInference } from "@huggingface/inference";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 8000;

async function  getHfInference() {
  const { HfInference } = await import("@huggingface/inference");
  return new HfInference(process.env.HUGGING_FACE_API_KEY);
}

// Initialize Hugging Face Inference
const hf = getHfInference();

// Store active temp directories for each repo
const tempDirs: Record<string, string> = {};

async function getOctokit() {
  const { Octokit } = await import("@octokit/rest");
  return new Octokit();
}

interface GithubFile {
  type: "file" | "dir" | "submodule" | "symlink";
  path: string;
  download_url?: string | null;
}

// Fetch repo details
async function getRepo(owner: string, repo: string) {
  try {
    const octokit = await getOctokit();
    return (await octokit.rest.repos.get({ owner, repo })).data;
  } catch (error) {
    console.error("Error fetching repo:", error);
    return null;
  }
}

// List branches of a repo
async function listBranches(owner: string, repo: string): Promise<string[]> {
  try {
    const octokit = await getOctokit();
    const { data } = await octokit.rest.repos.listBranches({ owner, repo });
    return data.map(branch => branch.name);
  } catch (error) {
    console.error("Error fetching branches:", error);
    return [];
  }
}

// Fetch all files from a repo and store them temporarily
async function getDirectoryFiles(
  owner: string,
  repo: string,
  path: string = "",
  branch: string = "main",
  tempDir: string
): Promise<string[]> {
  try {
    const octokit = await getOctokit();
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch });

    if (Array.isArray(data)) {
      const files = await Promise.all(
        data.map(async (item: GithubFile): Promise<string | string[]> => {
          if (item.type === "dir") {
            return getDirectoryFiles(owner, repo, item.path, branch, tempDir);
          } else if (item.download_url) {
            return downloadAndStoreFile(item.download_url, item.path, tempDir);
          }
          return [];
        })
      );
      return files.flat();
    } else if (data.download_url) {
      return [await downloadAndStoreFile(data.download_url, data.path, tempDir)];
    }
    return [];
  } catch (error) {
    console.error("Error fetching files:", error);
    return [];
  }
}

// Download and store file in temp dir
async function downloadAndStoreFile(url: string, filePath: string, tempDir: string): Promise<string> {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const localFilePath = path.join(tempDir, filePath);

    await fs.ensureDir(path.dirname(localFilePath));
    await fs.writeFile(localFilePath, response.data);
    console.log(`Stored: ${localFilePath}`);

    return localFilePath;
  } catch (error) {
    console.error(`Error downloading file: ${url}`, error);
    return "";
  }
}

// Analyze file content with Hugging Face
async function analyzeFileWithAI(fileContent: string, prompt: string): Promise<string> {
  try {
    const hfInstance = await hf;
    const response = await hfInstance.textGeneration({
      model: "bigcode/starcoder",
      inputs: `${prompt}\n\n${fileContent}`,
      parameters: {
        max_length: 800,
        temperature: 0.3, 
      },
    });
    return response.generated_text;
  } catch (error) {
    console.error("Error analyzing file with Hugging Face:", error);
    return "Failed to analyze file content.";
  }
}

app.get("/", (req: Request, res: Response) => {
  res.send("Welcome to Express & TypeScript Server");
});

// List Branches
app.get("/branches/:owner/:repo", async (req: Request, res: Response) => {
  const { owner, repo } = req.params;
  const branches = await listBranches(owner, repo);
  res.json({ branches: branches.length > 0 ? branches : "No branches found" });
});

// Fetch and store repo files
app.get("/files/:owner/:repo/:branch?", async (req: Request, res: Response) => {
  const { owner, repo, branch = "main" } = req.params;

  try {
    const repoKey = `${owner}/${repo}/${branch}`;
    if (!tempDirs[repoKey]) {
      tempDirs[repoKey] = tmp.dirSync().name;
    }
    const tempDir = tempDirs[repoKey];

    console.log(`Temporary directory for ${repoKey}: ${tempDir}`);

    const files = await getDirectoryFiles(owner, repo, "", branch, tempDir);

    if (files.length === 0) {
      res.status(404).json({ error: "No files found in repository" });
      return;
    }

    setTimeout(() => {
      fs.remove(tempDir)
        .then(() => {
          console.log(`Cleaned up: ${tempDir}`);
          delete tempDirs[repoKey];
        })
        .catch(err => console.error(`Error cleaning up temp files: ${err}`));
    }, 10 * 60 * 1000);

    res.json({ storedFiles: files });
  } catch (error) {
    console.error("Error fetching files:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Retrieve file content
app.get("/file-content/:owner/:repo/:branch/*", async (req: Request, res: Response) => {
  try {
    const { owner, repo, branch } = req.params;
    const filePath = req.params[0];

    const repoKey = `${owner}/${repo}/${branch}`;
    const tempDir = tempDirs[repoKey];

    if (!tempDir) {
      res.status(404).json({ error: "Files not fetched yet. Fetch via /files first." });
      return;
    }

    const fullFilePath = path.join(tempDir, filePath);

    if (!(await fs.pathExists(fullFilePath))) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const fileContent = await fs.readFile(fullFilePath, "utf-8");
    res.send(fileContent);
  } catch (error) {
    console.error("Error reading file:", error);
    res.status(500).json({ error: "Failed to read file content" });
  }
});

// Analyze files with Hugging Face
app.post("/analyze/:owner/:repo/:branch/*", async (req: Request, res: Response) => {
  try {
    const { owner, repo, branch } = req.params;
    const filePath = req.params[0];
    const { prompt } = req.body;

    const repoKey = `${owner}/${repo}/${branch}`;
    const tempDir = tempDirs[repoKey];

    if (!tempDir) {
      res.status(404).json({ error: "Files not fetched yet. Fetch via /files first." });
      return;
    }

    const fullFilePath = path.join(tempDir, filePath);

    if (!(await fs.pathExists(fullFilePath))) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const fileContent = await fs.readFile(fullFilePath, "utf-8");
    const analysis = await analyzeFileWithAI(fileContent, prompt);

    res.json({ file: filePath, analysis });
  } catch (error) {
    console.error("Error analyzing file:", error);
    res.status(500).json({ error: "Failed to analyze file content" });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});