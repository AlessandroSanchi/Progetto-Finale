# Space Survivor

Bullet hell game with Flask backend, SQLite scores, and Phaser 3 frontend.

## Setup

```bash
python -m venv .venv
.\.venv\Scripts\Activate # Windows
source .venv/bin/activate      # Mac/Linux

pip install -r requirements.txt
python run.py
```

Open http://127.0.0.1:5002 — register, login, play.


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
