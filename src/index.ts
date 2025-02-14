import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 8000;

interface GithubFile {
  type: "file" | "dir" | "submodule" | "symlink";
  path: string
}

// Async function to fetch repo details
async function getRepo(owner: string, repo: string) {
  try {
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit();

    const response = await octokit.rest.repos.get({ owner, repo });
    console.log(response.data); 
  } catch (error) {
    console.error("Error fetching repo:", error);
  }
}

async function getDirectoryFiles(owner: string, repo: string, path: string = "", branch: string = "main"): Promise<string[]> {
  try {
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit();

    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });

    if (Array.isArray(data)) {
      // If it's a directory, recursively fetch its contents
      const files = await Promise.all(
        data.map(async (item: GithubFile) => {
          if (item.type === "dir") {
            return getDirectoryFiles(owner, repo, item.path, branch);
          } else {
            return item.path;
          }
        })
      );
      return files.flat(1);
    } else {
      return [data.path];
    }
  }  catch (error) {
    console.error("Error fetching files:", error);
    return [];
  }
}

// Example usage:
// getDirectoryFiles("Blackbobs", "Shopercase", "", "master").then((files) => console.log(files));



// getRepo("Blackbobs", "Shopercase");

async function listBranches(owner: string, repo: string): Promise<string[]> {
  try {
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit();

    const { data } = await octokit.rest.repos.listBranches({ owner, repo });
    return data.map(branch => branch.name); 
  } catch (error) {
    console.error("Error fetching branches:", error);
    return [];
  }
}

async function main() {
  const owner = "Blackbobs";
  const repo = "scraped_products";

  // List branches
  const branches = await listBranches(owner, repo);
  console.log("Available branches:", branches);

  if (branches.length === 0) {
    console.log("No branches found.");
    return;
  }
// Stimulate user input
  const selectedBranch = branches.includes("develop") ? "develop" : branches[0]; 
  console.log(`Fetching files from branch: ${selectedBranch}`);

  // Fetch files from the selected branch
  const files = await getDirectoryFiles(owner, repo, "", selectedBranch);
  console.log("Files:", files);
}

main();

app.get('/', (req: Request, res: Response) => {
  res.send('Welcome to Express & TypeScript Server');
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
