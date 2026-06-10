# D-Bugger v1.0
## Complete Deployment Guide for Netlify (Beginner Friendly)

---

## What You Will Need Before Starting

1. A computer with internet access
2. An Anthropic API key (get one free at https://console.anthropic.com)
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

## STEP 2 — Get Your Anthropic API Key

1. Go to https://console.anthropic.com
2. Sign up for a free account if you don't have one
3. Once logged in, click "API Keys" in the left sidebar
4. Click "Create Key"
5. Give it a name like "SF Debug Tool"
6. COPY the key — it starts with `sk-ant-...`
7. Save it somewhere safe (like Notepad) — you will need it in Step 6
   ⚠️  IMPORTANT: Never share this key or put it in any code file

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

## STEP 7 — Add Your Anthropic API Key (CRITICAL STEP)

This is the most important step. Without this, the AI analysis features will not work.

1. In your Netlify site dashboard, click "Site configuration" in the left menu
2. Click "Environment variables"
3. Click "Add a variable"
4. Fill in:
   - Key: `ANTHROPIC_API_KEY`
   - Value: paste your API key from Step 2 (starts with `sk-ant-...`)
5. Click "Create variable"
6. Now you MUST redeploy for this to take effect:
   - Click "Deploys" in the top menu
   - Click "Trigger deploy" → "Deploy site"
   - Wait 1-2 minutes for it to rebuild

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
- Go back to Step 7 and double-check the environment variable name is exactly: `ANTHROPIC_API_KEY`
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
| Anthropic API | Pay per use ~$0.003 per analysis (very cheap) |
| Custom domain (optional) | ~$10-15/year |
| Password protection (optional) | $19/month (Netlify Pro) |

For a team of 10 engineers doing ~50 analyses per day, Anthropic API cost would be approximately **$4-5 per month**.

---

## Support

If you encounter issues not covered here:
- Netlify docs: https://docs.netlify.com
- Anthropic API docs: https://docs.anthropic.com
- Vite docs: https://vitejs.dev
