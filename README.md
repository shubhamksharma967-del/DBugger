# D-Bugger v1.0
## Complete Deployment Guide for Netlify (Beginner Friendly)

---

## What You Will Need Before Starting

1. A computer with internet access
2. A Google Gemini API key (get one free at https://aistudio.google.com/app/apikey)
3. A GitHub account (free at https://github.com)
4. A Netlify account (free at https://netlify.com)
5. Node.js installed on your computer (free at https://nodejs.org — download the LTS version)

---

## STEP 1 — Install Node.js on Your Computer

1. Go to https://nodejs.org
2. Click the big green button that says "LTS" (recommended)
3. Download and run the installer
4. Click Next through all the steps, keep all defaults
5. When done, open a Terminal (Mac) or Command Prompt (Windows)
   - Windows: Press Windows key, type "cmd", press Enter
   - Mac: Press Cmd+Space, type "terminal", press Enter
6. Type this and press Enter:
   ```
   node --version
   ```
7. You should see something like `v18.x.x` — this means Node.js is installed correctly

---

## STEP 2 — Get Your Free Google Gemini API Key

1. Go to https://aistudio.google.com/app/apikey
2. Sign in with your Google account (Gmail works fine — no credit card needed)
3. Click "Create API Key"
4. Select "Create API key in new project"
5. Your key will appear on screen — it starts with `AIza...`
6. COPY the key and save it somewhere safe (like Notepad)
   ⚠️  IMPORTANT: Never share this key or put it in any code file
   ✅  This key is completely FREE — 15 requests/minute, 1 million tokens/day

---

## STEP 3 — Create a GitHub Account and Repository

1. Go to https://github.com and sign up for a free account
2. Once logged in, click the green "New" button (top left)
3. Fill in:
   - Repository name: `d-bugger`
   - Description: `D-Bugger`
   - Select: Private (recommended for internal tools)
   - Check: "Add a README file"
4. Click "Create repository"
5. You now have an empty repository — keep this tab open

---

## STEP 4 — Upload the Project Files to GitHub

### Option A — Using GitHub's Website (Easiest, No Technical Skills Needed)

1. Download all the project files from this folder to your computer
2. Open your GitHub repository from Step 3
3. Click "Add file" → "Upload files"
4. Drag ALL the project files and folders into the upload area:
   ```
   d-bugger/
   ├── src/
   │   ├── App.jsx
   │   └── main.jsx
   ├── public/
   │   └── index.html
   ├── netlify/
   │   └── functions/
   │       └── analyze.js
   ├── package.json
   ├── vite.config.js
   ├── netlify.toml
   └── .gitignore
   ```
   ⚠️ Make sure to maintain the folder structure when uploading
5. Scroll down and click "Commit changes"
6. Your files are now on GitHub

### Option B — Using Git Commands (If You Know Terminal)

```bash
# In your terminal, navigate to the d-bugger folder
cd path/to/d-bugger

# Initialize git
git init
git add .
git commit -m "Initial commit - D-Bugger v1.0"

# Connect to your GitHub repo (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/d-bugger.git
git branch -M main
git push -u origin main
```

---

## STEP 5 — Create a Netlify Account and Connect GitHub

1. Go to https://netlify.com
2. Click "Sign up" → Choose "Sign up with GitHub" (easiest)
3. Authorize Netlify to access your GitHub account
4. You are now in the Netlify dashboard

---

## STEP 6 — Deploy the App on Netlify

1. In the Netlify dashboard, click "Add new site"
2. Click "Import an existing project"
3. Click "Deploy with GitHub"
4. Find and click your `d-bugger` repository
5. Netlify will auto-detect the settings from `netlify.toml` — you should see:
   - Build command: `npm run build`
   - Publish directory: `dist`
6. Click "Deploy d-bugger"
7. Wait 1-2 minutes — you will see a spinning icon while it builds
8. ✅ When done, you will see a green "Published" message

---

## STEP 7 — Add Your Gemini API Key to Netlify (CRITICAL STEP)

This is the most important step. Without this, the AI analysis features will not work.

1. In your Netlify site dashboard, click "Site configuration" in the left menu
2. Click "Environment variables"
3. Click "Add a variable"
4. Fill in EXACTLY as shown:
   - Key:   GEMINI_API_KEY
   - Value: paste your key from Step 2 (starts with AIza...)
5. Click "Create variable"
6. Now you MUST redeploy for this to take effect:
   - Click "Deploys" in the top menu
   - Click "Trigger deploy" → "Deploy site"
   - Wait 1-2 minutes for it to rebuild
   
   ✅ Once deployed, the AI Root Cause Analysis button will work on your live site

---

## TESTING LOCALLY BEFORE DEPLOYING (Optional but Recommended)

You can test the whole app — including the AI Analysis feature — on your own
computer before pushing to Netlify. This avoids surprises after deployment.

### Why `npm run dev` is NOT enough

Running `npm run dev` starts Vite only (usually on http://localhost:5173).
Vite does NOT run your Netlify serverless function, so `/api/analyze` will
return a 404 or "fetch failed" — even if your code is correct.

To test the AI Analysis feature locally, you must use the Netlify CLI, which
runs BOTH the frontend AND the serverless function together.

### Steps to test locally with Gemini

1. In your project folder, create a new file named exactly `.env`
   (You can copy `.env.example` and rename it to `.env`)

2. Open `.env` and add your real Gemini key:
   ```
   GEMINI_API_KEY=AIza_your_real_key_here
   ```
   ⚠️ Never commit this `.env` file to GitHub — it's already in `.gitignore`

3. Install dependencies (only needed once):
   ```
   npm install
   ```

4. Start the app using Netlify CLI instead of plain Vite:
   ```
   npm run dev:netlify
   ```
   This usually opens at **http://localhost:8888** (not 5173)

5. Open http://localhost:8888 in your browser, upload a log/HAR file, and
   click "AI Root Cause Analysis" — it should now return real results.

### Common local errors and fixes

| Error message | Fix |
|---|---|
| "fetch failed" or 404 on /api/analyze | You're using `npm run dev` (port 5173). Use `npm run dev:netlify` instead (port 8888). |
| "GEMINI_API_KEY is not set" | Your `.env` file is missing, misnamed, or in the wrong folder. It must be in the project root, named exactly `.env`. |
| "Gemini API error: API key not valid" | Your key is wrong or has extra spaces. Re-copy it from https://aistudio.google.com/app/apikey |
| Still on port 5173 and nothing works | Stop the server (Ctrl+C) and run `npm run dev:netlify` — do not run both at once |

---

## STEP 8 — Access Your Live App

1. Go back to your Netlify site overview
2. You will see a URL like: `https://amazing-name-123456.netlify.app`
3. Click that URL — your D-Bugger is now live!
4. Share this URL with your support engineering team

---

## STEP 9 — (Optional) Set a Custom Domain

If you want a nicer URL like `sfdebug.yourcompany.com`:

1. In Netlify dashboard, click "Domain management"
2. Click "Add a domain"
3. Type your desired domain
4. Follow Netlify's instructions to update your DNS settings
   (This requires access to your domain registrar/DNS provider)

---

## STEP 10 — (Optional) Protect with a Password

Since this tool is for internal use, you may want to add password protection:

1. In Netlify dashboard, click "Site configuration"
2. Click "Access control"
3. Under "Password protection", click "Enable password protection"
4. Set a password and share it with your team
   ⚠️ Note: Password protection requires Netlify Pro ($19/month)
   
   Free alternative: Share the URL only internally and keep the repo Private

---

## Updating the Tool in the Future

When you need to update the tool:

1. Edit the files on your computer
2. Upload the changed files to GitHub (same as Step 4)
3. Netlify automatically detects the change and redeploys within 1-2 minutes
4. The live URL stays the same — no action needed

---

## Troubleshooting

### "Build failed" error on Netlify
- Check the build log — click on the failed deploy to see details
- Most common cause: a file is missing or in the wrong folder
- Make sure ALL files from Step 4 were uploaded correctly

### AI Analysis button shows error
- Your API key may not be set correctly
- Go back to Step 7 and double-check the environment variable name is exactly: `GEMINI_API_KEY`
- Make sure you redeployed after adding the key

### "Page not found" on the live URL
- Wait a few more minutes — the first deploy can take up to 5 minutes
- Try a hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)

### App loads but looks broken
- Try in Chrome or Edge — these browsers have best compatibility
- Clear your browser cache: Ctrl+Shift+Delete

---

## Project Structure Explained

```
d-bugger/
│
├── src/
│   ├── App.jsx          ← The entire debug tool application (React)
│   └── main.jsx         ← Entry point that loads the app
│
├── public/
│   └── index.html       ← The HTML shell that React renders into
│
├── netlify/
│   └── functions/
│       └── analyze.js   ← Serverless function that calls Anthropic API
│                           (Your API key is stored here securely)
│
├── package.json         ← Project dependencies (React, Vite)
├── vite.config.js       ← Build configuration
├── netlify.toml         ← Netlify deployment configuration
└── .gitignore           ← Files to exclude from GitHub
```

---

## Security Notes

- ✅ Your Anthropic API key is stored in Netlify's environment variables — never in code
- ✅ The API key is never sent to the browser — all AI calls go through the serverless function
- ✅ Log files uploaded to the tool are processed in-browser only — never sent to any server
- ✅ Encrypted log ZIPs are downloaded directly to the engineer's machine
- ⚠️ Consider adding password protection (Step 10) to prevent unauthorized access
- ⚠️ Keep your GitHub repository Private so the code is not publicly visible

---

## Cost Estimate

| Service | Cost |
|---------|------|
| Netlify Free Tier | $0/month (100GB bandwidth, 300 build minutes) |
| Google Gemini API | FREE — 15 requests/min, 1M tokens/day (no credit card needed) |
| Custom domain (optional) | ~$10-15/year |
| Password protection (optional) | $19/month (Netlify Pro) |

For a team of 10 engineers doing ~50 analyses per day, Google Gemini API cost is **$0 — completely free** on the free tier.

---
