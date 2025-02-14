import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 8000;

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

// Example usage
getRepo("Blackbobs", "Shopercase");

app.get('/', (req: Request, res: Response) => {
  res.send('Welcome to Express & TypeScript Server');
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
