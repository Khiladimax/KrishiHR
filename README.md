# KrishiHR — Full Stack HR Management System

## Project Structure
```
KrishiHR/
├── frontend/          ← Deploy to Vercel
│   ├── *.html         (14 pages)
│   ├── app.js         (shared utilities + API_BASE)
│   ├── style.css
│   └── Logo.ico
└── backend/           ← Deploy to Railway
    ├── src/
    │   ├── server.js
    │   ├── config/
    │   │   ├── db.js              (Neon PostgreSQL with SSL)
    │   │   ├── migrate_all.js     (run once to create tables)
    │   │   └── master_seed_final.sql
    │   ├── middleware/
    │   │   └── auth.js
    │   ├── routes/
    │   │   ├── index.js           (all routes)
    │   │   └── geofence.js
    │   └── controllers/           (12 controllers)
    ├── package.json
    ├── .env.example
    └── .gitignore
```

---

## Deployment Guide

### Step 1 — Backend on Railway

1. Push the `backend/` folder to a GitHub repo
2. Create new project on [railway.app](https://railway.app)
3. Connect your GitHub repo
4. Set environment variables in Railway dashboard (see `.env.example`)
5. Railway will auto-detect Node.js and run `npm start`
6. Copy your Railway domain (e.g. `krishihr-backend.up.railway.app`)

### Step 2 — Update Frontend API URL

In `frontend/app.js`, replace:
```js
const API_BASE = 'https://YOUR_RAILWAY_DOMAIN.up.railway.app/api';
```
with your actual Railway domain.

Also update the same URL in these files if they have standalone `const API = ...`:
- `login.html`
- `announcements.html`
- `forgot-password.html`
- `import_employees.html`

### Step 3 — Frontend on Vercel

1. Push the `frontend/` folder to a GitHub repo
2. Import project on [vercel.com](https://vercel.com)
3. Framework preset: **Other** (static site)
4. Deploy — done!

### Step 4 — Run Migrations

After backend is live, run migrations once to create all tables:
```bash
npm run migrate
```
Or seed initial data using `master_seed_final.sql` via Neon SQL editor.

---

## Environment Variables (Railway)

| Variable | Description |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DB_HOST` | Neon host |
| `DB_PORT` | `5432` |
| `DB_NAME` | Database name |
| `DB_USER` | Neon user |
| `DB_PASSWORD` | Neon password |
| `JWT_SECRET` | Strong random string |
| `JWT_EXPIRES_IN` | `8h` |
