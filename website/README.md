# 🎬 YouB00B – App Scaffold (Work in Progress)

This folder is the working codebase for the YouB00B product (separate from the marketing landing page in `website/`). The goal is to build a lightweight, Netflix‑style YouTube experience using vanilla PHP, MySQL, and vanilla JS (with CURSY CSS for the UI).

## Structure

- `public/` — App frontend (HTML/JS/CSS) that will call the PHP APIs.
- `api/` — PHP endpoints (videos, comments, search, categories).
- `classes/` — Shared PHP classes (DB, YouTube client, repositories, response helpers).
- `config/` — Environment/config placeholders.
- `data/` — Placeholder for cached data / temp files.
- `website/` — The promo/marketing site that was relocated here (unchanged).

## Getting Started (dev)

1) Copy `config/config.example.php` to `config/config.php` and fill in:
   - DB creds (MySQL)
   - `YOUTUBE_API_KEY`
   - Optional CORS origin for local dev
2) Serve `public/` via PHP built-in server:
   ```bash
   php -S localhost:8000 -t public
   ```
3) Test a stub endpoint:
   - `http://localhost:8000/../api/videos.php`

## Notes

- APIs are stubbed with sample payloads until DB + YouTube API wiring is added.
- Add real schema + migrations before turning on write paths.
- Keep `website/` intact for marketing; ship product UI from `public/`.

## Database schema

See `config/schema.sql` for initial tables (`videos`, `comments`). Apply manually or via your preferred migration tool.

Built with ⚡ by FutureVision Studios / Team DC.

