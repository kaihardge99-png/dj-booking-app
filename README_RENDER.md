Render deployment guide
======================

Quick steps to deploy this project to Render (no prior Render experience assumed).

1) Create a GitHub repository and push this project

   ```bash
   git init
   git add .
   git commit -m "Initial commit for Render deployment"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

2) Sign up / sign in at https://render.com and connect your GitHub account.

3) Create a new **Web Service** on Render:
   - Select your repository and the `main` branch.
   - Build Command: `npm run build`
   - Start Command: `npm start`
   - Environment: `Node`
   - You can keep the free plan for testing.

4) Set environment variables (Render dashboard -> Environment -> Environment Groups / Variables):
   - `JWT_SECRET` (set a secure random value)
   - `EMAIL_USER` (your Gmail address used for nodemailer)
   - `EMAIL_PASSWORD` (app password if using Gmail)

5) (Optional but recommended) Use a proper managed database instead of SQLite:
   - SQLite (`bookings.db`) is stored inside the container and will be lost on redeploys or restarts.
   - Render offers managed PostgreSQL. If you add one, update `server.js` to use Postgres and migrate the data.

6) Deploy and monitor logs in Render dashboard. Once the service is live you will get a stable public URL.

If you want, I can open the Render dashboard and walk you step-by-step, or automate creation if you provide the Render API key and a GitHub repo URL. For security, do NOT paste secrets in chat unless you understand the risk.
