import os
import sqlite3
from flask import Flask

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH  = os.path.join(BASE_DIR, 'instance', 'game.sqlite')


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS scores (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id        INTEGER NOT NULL,
            score          INTEGER NOT NULL DEFAULT 0,
            enemies_killed INTEGER NOT NULL DEFAULT 0,
            bullets_fired  INTEGER NOT NULL DEFAULT 0,
            playtime       REAL    NOT NULL DEFAULT 0,
            created_at     TEXT    NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
    ''')
    conn.commit()
    conn.close()


def create_app():
    app = Flask(
        __name__,
        template_folder='templates',
        static_folder='static'
    )
    app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'dev-secret-change-me')

    # Create DB tables once at startup
    with app.app_context():
        init_db()

    # Register blueprints
    from app.auth  import auth_bp
    from app.game  import game_bp
    from app.api   import api_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(game_bp)
    app.register_blueprint(api_bp)

    return app
