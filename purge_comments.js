const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// Directories to process
const targetDirs = ["server", path.join("client", "src")]; // Ensure client src is included
// File extensions to process
const fileExtensions = [".js", ".jsx", ".css"];
// Directories to skip
const skipDirs = ["node_modules", "dist", "build", ".git"];

// Regex to remove multi-line comments (works for JS, JSX, CSS)
const multiLineCommentRegex = /\/\*[\s\S]*?\*\//g;
// Regex to remove single-line comments (JS/JSX only)
const jsSingleLineCommentRegex = /(?<!https?:)\/\/.*$/gm;

async function processFile(filePath) {
  try {
    console.log(`Processing: ${filePath}`);
    const originalContent = await readFile(filePath, "utf8");
    let newContent = originalContent;

    // Remove multi-line comments first
    newContent = newContent.replace(multiLineCommentRegex, "");

    // Remove single-line comments for JS/JSX
    if (path.extname(filePath) === ".js" || path.extname(filePath) === ".jsx") {
      newContent = newContent.replace(jsSingleLineCommentRegex, "");
    }

    // Remove empty lines that might be left after comment removal
    newContent = newContent.replace(/^\s*$[\r\n]/gm, "");

    if (newContent !== originalContent) {
      await writeFile(filePath, newContent, "utf8");
      console.log(`  -> Comments removed.`);
    } else {
      console.log(`  -> No comments found or file unchanged.`);
    }
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
  }
}

async function walkDir(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip specified directories
        if (skipDirs.includes(entry.name)) {
          continue;
        }
        await walkDir(fullPath);
      } else if (
        fileExtensions.includes(path.extname(entry.name).toLowerCase())
      ) {
        await processFile(fullPath);
      }
    }
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      // console.warn(`Permission denied, skipping directory: ${dir}`);
    } else {
      console.error(`Error reading directory ${dir}:`, error);
    }
  }
}

async function purgeComments() {
  console.log("Starting comment purge...");
  const workspaceRoot = path.resolve(__dirname);
  console.log(`Workspace root: ${workspaceRoot}`);

  for (const dir of targetDirs) {
    const absoluteDir = path.join(workspaceRoot, dir);
    if (fs.existsSync(absoluteDir)) {
      console.log(`Processing directory: ${absoluteDir}`);
      await walkDir(absoluteDir);
    } else {
      console.warn(`Directory not found, skipping: ${absoluteDir}`);
    }
  }
  console.log("\nComment purge finished.");
}

purgeComments();
