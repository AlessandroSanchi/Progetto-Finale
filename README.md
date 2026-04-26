# Space Survivor

Bullet hell game with Flask backend, SQLite scores, and Phaser 3 frontend.

## Setup

```bash
python -m venv .venv
.\.venv\Scripts\Activate.ps1   # Windows
source .venv/bin/activate      # Mac/Linux

pip install -r requirements.txt
python run.py
```

Open http://127.0.0.1:5000 — register, login, play.

## Structure

```
app.py                  Flask app (routes + DB)
run.py                  Entry point
requirements.txt
app/
  templates/
    base.html
    login.html
    register.html
    index.html          Game page
  static/
    css/styles.css      Dark sci-fi theme
    js/game.js          Phaser 3 bullet hell
instance/
  game.sqlite           Created automatically
```

## API

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/submit-score | Save score (requires login) |
| GET  | /api/leaderboard  | Top scores |
| GET  | /api/me           | Current user info |

Score payload: `{ score, enemies_killed, bullets_fired, playtime }`

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrows | Move |
| Shift (hold) | Focused slow mode + show hitbox |
| R | Restart after game over |
| Auto | Fires automatically |
