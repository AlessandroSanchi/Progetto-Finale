from flask import Flask, render_template, request, redirect, url_for, session, jsonify
import sqlite3
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'instance', 'game.sqlite')

os.makedirs(os.path.join(BASE_DIR, 'instance'), exist_ok=True)

app = Flask(__name__, template_folder='app/templates', static_folder='app/static')
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'dev-secret-change-me')


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            score INTEGER NOT NULL DEFAULT 0,
            enemies_killed INTEGER NOT NULL DEFAULT 0,
            bullets_fired INTEGER NOT NULL DEFAULT 0,
            playtime REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
    ''')
    conn.commit()
    conn.close()


with app.app_context():
    init_db()


# ── Auth ──────────────────────────────────────────────────────────────────────

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username', '').strip().lower()
        password = request.form.get('password', '')
        if len(username) < 3 or len(username) > 20:
            return render_template('register.html', error='Username must be 3–20 characters')
        if len(password) < 6:
            return render_template('register.html', error='Password must be at least 6 characters')
        conn = get_db()
        try:
            conn.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)',
                         (username, generate_password_hash(password)))
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            return render_template('register.html', error='Username already taken')
        conn.close()
        return redirect(url_for('login'))
    return render_template('register.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username', '').strip().lower()
        password = request.form.get('password', '')
        conn = get_db()
        row = conn.execute('SELECT id, password_hash FROM users WHERE username = ?', (username,)).fetchone()
        conn.close()
        if row and check_password_hash(row['password_hash'], password):
            session['user_id'] = row['id']
            session['username'] = username
            return redirect(url_for('index'))
        return render_template('login.html', error='Invalid username or password')
    return render_template('login.html')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


# ── Game page ─────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('index.html', username=session['username'])


# ── API ───────────────────────────────────────────────────────────────────────

@app.route('/api/submit-score', methods=['POST'])
def submit_score():
    if 'user_id' not in session:
        return jsonify({'error': 'unauthenticated'}), 401
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'invalid payload'}), 400
    try:
        score       = int(data.get('score', 0))
        enemies     = int(data.get('enemies_killed', 0))
        bullets     = int(data.get('bullets_fired', 0))
        playtime    = float(data.get('playtime', 0))
    except (ValueError, TypeError):
        return jsonify({'error': 'invalid values'}), 400

    conn = get_db()
    existing = conn.execute(
        'SELECT id, score FROM scores WHERE user_id = ?', (session['user_id'],)
    ).fetchone()
    now = datetime.utcnow().isoformat()
    if existing is None:
        conn.execute(
            'INSERT INTO scores (user_id, score, enemies_killed, bullets_fired, playtime, created_at) VALUES (?,?,?,?,?,?)',
            (session['user_id'], score, enemies, bullets, playtime, now)
        )
        action = 'inserted'
    elif score > existing['score']:
        conn.execute(
            'UPDATE scores SET score=?, enemies_killed=?, bullets_fired=?, playtime=?, created_at=? WHERE user_id=?',
            (score, enemies, bullets, playtime, now, session['user_id'])
        )
        action = 'updated'
    else:
        conn.close()
        return jsonify({'status': 'ignored'})
    conn.commit()
    conn.close()
    return jsonify({'status': 'saved', 'action': action})


@app.route('/api/leaderboard')
def leaderboard():
    limit = request.args.get('limit', 10, type=int)
    conn = get_db()
    rows = conn.execute('''
        SELECT u.username, s.score, s.enemies_killed, s.playtime
        FROM scores s JOIN users u ON u.id = s.user_id
        ORDER BY s.score DESC LIMIT ?
    ''', (limit,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/me')
def me():
    if 'user_id' not in session:
        return jsonify({'error': 'unauthenticated'}), 401
    return jsonify({'username': session['username'], 'user_id': session['user_id']})


if __name__ == '__main__':
    app.run(debug=True)
