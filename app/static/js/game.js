'use strict';

(function () {

  // ── Canvas setup ──────────────────────────────────────────────────────────
  const canvas = document.getElementById('gameCanvas');
  const W = canvas.width;
  const H = canvas.height;

  // ── Web Audio (synthesized — no files needed) ─────────────────────────────
  let audioCtx = null;

  function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freq, type, duration, volume, pitchEnd) {
    try {
      const ctx = getAudio();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (pitchEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(pitchEnd, ctx.currentTime + duration);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  }

  function playNoise(duration, volume) {
    try {
      const ctx = getAudio();
      const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      src.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      src.start();
    } catch (e) {}
  }

  const sfx = {
    shoot:       () => playTone(1200, 'sine', 0.04, 0.006, 800),
    enemyDie:    () => playNoise(0.12, 0.045),
    bossDie:     () => { playNoise(0.5, 0.07); playTone(80, 'sawtooth', 0.5, 0.05, 40); },
    playerHit:   () => { playNoise(0.2, 0.07); playTone(120, 'square', 0.2, 0.04, 60); },
    powerUp:     () => { playTone(440, 'sine', 0.1, 0.03); playTone(880, 'sine', 0.15, 0.03); },
    bossWarning: () => playTone(220, 'sawtooth', 0.3, 0.05, 440),
    areaUp:      () => { playTone(440, 'sine', 0.1, 0.035); playTone(550, 'sine', 0.1, 0.035); playTone(660, 'sine', 0.2, 0.04); },
    bossHit:     () => playTone(200, 'square', 0.04, 0.018, 100),
  };

  // ── Game state ────────────────────────────────────────────────────────────
  let score = 0, lives = 3, coins = 0;
  let enemiesKilled = 0, bulletsFired = 0;
  let elapsedTime = 0, gameStartTime = 0;
  let gameOver = false;
  let gameStarted = false;   // waiting for start button

  let player, playerGfx;
  let invulnerable = false, invulnerableTimer = 0;
  let invulnTween = null;

  let shootTimer = 0;
  const SHOOT_RATE = 165;

  let spawnTimer = 0;
  let spawnRate = 1400;
  let areaLevel = 1;

  // Boss state — boss spawns after a short enemy warmup (BOSS_DELAY ms)
  let bossTimer = 0;
  const BOSS_DELAY = 6000;   // 6s of regular enemies before each boss
  let bossActive = false;
  let currentBoss = null;
  let bossShootTimer = 0;
  let bossCount = 0;         // bosses killed — drives escalation

  // Area transition state
  let transitioning = false;
  let transitionTimer = 0;
  const TRANSITION_DURATION = 2000;

  let enemies, bullets, enemyBullets, powerUps, bosses;
  let cursors, wasd, shiftKey;

  // ── Phaser config ─────────────────────────────────────────────────────────
  const config = {
    type: Phaser.CANVAS,
    canvas,
    width: W,
    height: H,
    backgroundColor: '#0b0b12',
    physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } },
    scene: { preload, create, update }
  };

  new Phaser.Game(config);

  // ── Texture helpers ───────────────────────────────────────────────────────
  function preload() {}

  function makeTexture(scene, key, drawFn) {
    if (scene.textures.exists(key)) return;
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    drawFn(g);
    g.generateTexture(key, 64, 64);
    g.destroy();
  }

  function create() {
    const s = this;
    gameStartTime = Date.now();

    makeTexture(s, 'ship', g => {
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(32, 4, 4, 60, 60, 60);
      g.fillStyle(0x00f0ff, 0.7);
      g.fillCircle(32, 58, 7);
    });
    makeTexture(s, 'drone', g => {
      g.fillStyle(0x00f0ff, 1);
      g.fillTriangle(32, 2, 10, 32, 54, 32);
      g.fillTriangle(32, 62, 10, 32, 54, 32);
    });
    makeTexture(s, 'spinner', g => {
      g.fillStyle(0xff00cc, 1);
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        pts.push({ x: 32 + 26 * Math.cos(a), y: 32 + 26 * Math.sin(a) });
      }
      g.fillPoints(pts, true);
    });
    makeTexture(s, 'rusher', g => {
      g.fillStyle(0xff7700, 1);
      g.fillTriangle(60, 32, 4, 8, 4, 56);
    });
    makeTexture(s, 'boss', g => {
      g.fillStyle(0xff2020, 1);
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        pts.push({ x: 32 + 28 * Math.cos(a), y: 32 + 28 * Math.sin(a) });
      }
      g.fillPoints(pts, true);
    });
    makeTexture(s, 'pbullet', g => {
      g.fillStyle(0xffffff, 1); g.fillRect(28, 0, 8, 28);
      g.fillStyle(0x00f0ff, 0.5); g.fillRect(27, 0, 10, 28);
    });
    makeTexture(s, 'ebullet_cyan', g => { g.fillStyle(0x00f0ff, 1); g.fillCircle(32, 32, 8); });
    makeTexture(s, 'ebullet_mag',  g => { g.fillStyle(0xff00cc, 1); g.fillCircle(32, 32, 8); });
    makeTexture(s, 'ebullet_org',  g => { g.fillStyle(0xff7700, 1); g.fillCircle(32, 32, 8); });
    makeTexture(s, 'ebullet_red',  g => { g.fillStyle(0xff2020, 1); g.fillCircle(32, 32, 10); });
    makeTexture(s, 'powerup', g => {
      g.fillStyle(0x00ff88, 1); g.fillCircle(32, 32, 14);
      g.fillStyle(0xffffff, 0.9); g.fillTriangle(32, 20, 22, 40, 42, 40);
    });

    // Starfield
    s.stars = [];
    for (let i = 0; i < 180; i++) {
      s.stars.push({
        x: Phaser.Math.Between(0, W),
        y: Phaser.Math.Between(0, H),
        r: Math.random() < 0.3 ? 1.5 : 1,
        speed: Phaser.Math.Between(30, 80)
      });
    }
    s.starGfx = s.add.graphics();

    // Player
    player = s.physics.add.image(W / 2, H - 80, 'ship');
    player.setDisplaySize(32, 32);
    player.setCollideWorldBounds(true);
    player.body.setSize(10, 10);
    playerGfx = s.add.graphics();

    // Groups
    enemies      = s.physics.add.group();
    bullets      = s.physics.add.group();
    enemyBullets = s.physics.add.group();
    powerUps     = s.physics.add.group();
    bosses       = s.physics.add.group();

    // Controls
    cursors  = s.input.keyboard.createCursorKeys();
    wasd     = s.input.keyboard.addKeys({ W: 87, A: 65, S: 83, D: 68 });
    shiftKey = s.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

    // Collisions
    s.physics.add.overlap(bullets,      enemies,      hitEnemy,      null, s);
    s.physics.add.overlap(bullets,      bosses,       hitBoss,       null, s);
    s.physics.add.overlap(player,       enemies,      hitPlayer,     null, s);
    s.physics.add.overlap(player,       enemyBullets, hitPlayer,     null, s);
    s.physics.add.overlap(player,       powerUps,     collectPowerUp,null, s);

    // HUD elements
    const mono = { fontFamily: 'monospace' };
    s.hudScore     = s.add.text(10, 10, '', { ...mono, fontSize: '13px', fill: '#e8e8f0' });
    s.hudLives     = s.add.text(W - 10, 10, '', { ...mono, fontSize: '13px', fill: '#e8e8f0', align: 'right' }).setOrigin(1, 0);
    s.hudArea      = s.add.text(W / 2, 10, '', { ...mono, fontSize: '13px', fill: '#00f0ff', align: 'center' }).setOrigin(0.5, 0);
    s.hudBossLabel = s.add.text(W / 2, 30, '', { ...mono, fontSize: '12px', fill: '#ff2d78', align: 'center' }).setOrigin(0.5, 0);
    s.bossBarBg    = s.add.rectangle(W / 2, 50, 200, 8, 0x330000).setVisible(false);
    s.bossBarFg    = s.add.rectangle(W / 2 - 100, 50, 200, 8, 0xff2020).setOrigin(0, 0.5).setVisible(false);

    // Transition overlay (depth on top of everything)
    s.transOverlay   = s.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0).setDepth(10);
    s.transText      = s.add.text(W / 2, H / 2 - 36, '', { ...mono, fontSize: '26px', fill: '#00f0ff', align: 'center' }).setOrigin(0.5).setDepth(11);
    s.transCountdown = s.add.text(W / 2, H / 2 + 24, '', { ...mono, fontSize: '52px', fill: '#ffffff', align: 'center' }).setOrigin(0.5).setDepth(11);

    s.gameOverText = s.add.text(W / 2, H / 2, '', {
      ...mono, fontSize: '32px', fill: '#ff2d78', align: 'center'
    }).setOrigin(0.5).setDepth(12);

    // ── Start screen ──────────────────────────────────────────────────────
    s.startOverlay = s.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.78).setDepth(20);
    s.startTitle   = s.add.text(W / 2, H / 2 - 110, 'SPACE\nSURVIVOR', {
      ...mono, fontSize: '38px', fill: '#00f0ff', align: 'center', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(21);
    s.startSub = s.add.text(W / 2, H / 2 - 10, 'WASD / Arrows  —  move\nShift  —  focus (slow + hitbox)\nAuto-fire  —  survive', {
      ...mono, fontSize: '13px', fill: '#aaaacc', align: 'center'
    }).setOrigin(0.5).setDepth(21);

    // Pulsing start button drawn with graphics
    s.startBtnGfx = s.add.graphics().setDepth(21);
    s.startBtnText = s.add.text(W / 2, H / 2 + 90, '▶  START GAME', {
      ...mono, fontSize: '18px', fill: '#000000', fontStyle: 'bold', align: 'center'
    }).setOrigin(0.5).setDepth(22);

    function drawStartBtn(alpha) {
      s.startBtnGfx.clear();
      s.startBtnGfx.fillStyle(0x00f0ff, alpha);
      s.startBtnGfx.fillRoundedRect(W / 2 - 110, H / 2 + 74, 220, 36, 8);
    }
    drawStartBtn(1);
    s.tweens.add({ targets: { v: 1 }, v: 0.6, yoyo: true, repeat: -1, duration: 800,
      onUpdate: (tw) => drawStartBtn(tw.getValue()) });

    // Click or ENTER to start
    function doStart() {
      if (gameStarted) return;
      gameStarted = true;
      gameStartTime = Date.now();
      s.startOverlay.setVisible(false);
      s.startTitle.setVisible(false);
      s.startSub.setVisible(false);
      s.startBtnGfx.setVisible(false);
      s.startBtnText.setVisible(false);
      player.setVisible(true);
      invulnerable = true;
      invulnerableTimer = 1200;
    }

    s.startBtnGfx.setInteractive(
      new Phaser.Geom.Rectangle(W / 2 - 110, H / 2 + 74, 220, 36),
      Phaser.Geom.Rectangle.Contains
    ).on('pointerdown', doStart);
    s.startBtnText.setInteractive().on('pointerdown', doStart);
    s.input.keyboard.on('keydown-ENTER', doStart);
    s.input.keyboard.on('keydown-SPACE', doStart);

    // Hide player until started
    player.setVisible(false);

    s.input.keyboard.on('keydown-R', () => restart(s));

    updateDOM();
    refreshLeaderboard();
  }

  // ── Update loop ───────────────────────────────────────────────────────────
  function update(time, delta) {
    const s = this;

    // Stars — always scroll (faster during transition for drama)
    s.starGfx.clear();
    s.starGfx.fillStyle(0xffffff, 0.7);
    for (const st of s.stars) {
      const mult = transitioning ? 5 : 1;
      st.y += st.speed * mult * (delta / 1000);
      if (st.y > H) { st.y = -4; st.x = Phaser.Math.Between(0, W); }
      s.starGfx.fillCircle(st.x, st.y, st.r);
    }

    if (gameOver) return;

    if (!gameStarted) return;

    // ── Area transition ───────────────────────────────────────────────────
    if (transitioning) {
      transitionTimer -= delta;
      player.setVelocity(0, 0);
      const secs = Math.ceil(transitionTimer / 1000);
      s.transCountdown.setText(secs > 0 ? String(secs) : '');
      if (transitionTimer <= 0) endTransition(s);
      return;
    }

    elapsedTime += delta;

    // ── Movement ──────────────────────────────────────────────────────────
    const focused = shiftKey.isDown;
    const speed = focused ? 95 : 270;
    let vx = 0, vy = 0;
    if (cursors.left.isDown  || wasd.A.isDown) vx = -1;
    if (cursors.right.isDown || wasd.D.isDown) vx =  1;
    if (cursors.up.isDown    || wasd.W.isDown) vy = -1;
    if (cursors.down.isDown  || wasd.S.isDown) vy =  1;
    if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }
    player.setVelocity(vx * speed, vy * speed);
    player.setAngle(vx * 8);

    playerGfx.clear();
    if (focused) {
      playerGfx.fillStyle(0xffffff, 0.9);
      playerGfx.fillCircle(player.x, player.y, 3);
    }

    // ── Auto-fire ─────────────────────────────────────────────────────────
    shootTimer -= delta;
    if (shootTimer <= 0) {
      firePlayerBullets(s);
      shootTimer = SHOOT_RATE;
    }

    // ── Enemy spawn ───────────────────────────────────────────────────────────
    spawnTimer -= delta;
    if (spawnTimer <= 0) {
      spawnEnemy(s);
      spawnTimer = Phaser.Math.Between(spawnRate - 200, spawnRate + 200);
    }

    // ── Boss timer — counts up, boss spawns after BOSS_DELAY ms ──────────────
    if (!bossActive) {
      bossTimer += delta;
      if (bossTimer >= BOSS_DELAY) {
        sfx.bossWarning();
        s.time.delayedCall(350, () => sfx.bossWarning());
        spawnBoss(s);
        bossTimer = 0;
      }
    }

    // ── Enemy AI ──────────────────────────────────────────────────────────
    enemies.children.iterate(e => {
      if (!e || !e.active || !e.body) return;
      if (e.enemyType === 'drone') {
        e.sineTimer = (e.sineTimer || 0) + delta;
        e.setVelocityX(Math.sin(e.sineTimer * 0.0008 * Math.PI * 2) * 72);
        e.shootTimer = (e.shootTimer || 0) + delta;
        if (e.shootTimer >= 2200) {
          e.shootTimer = 0;
          enemyFire(s, e.x, e.y, 0, 160 + areaLevel * 15, 'ebullet_cyan');
        }
      } else if (e.enemyType === 'spinner') {
        e.shootTimer = (e.shootTimer || 0) + delta;
        if (e.shootTimer >= 1800) {
          e.shootTimer = 0;
          const spd = 160 + areaLevel * 15;
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI * 2 / 6) * i;
            enemyFire(s, e.x, e.y, Math.cos(a) * spd, Math.sin(a) * spd, 'ebullet_mag');
          }
        }
      } else if (e.enemyType === 'rusher') {
        e.lifeTimer = (e.lifeTimer || 0) + delta;
        if (e.lifeTimer >= 3000) e.destroy();
      }
      if (e.y < 20 && e.body.velocity.y < 0) e.setVelocityY(Math.abs(e.body.velocity.y));
      if (e.y > H * 0.7) e.setVelocityY(-Math.abs(e.body.velocity.y));
    });

    // ── Boss AI ───────────────────────────────────────────────────────────
    if (bossActive && currentBoss && currentBoss.active) {
      const hpPct = currentBoss.hp / currentBoss.maxHp;
      const lvl = bossCount;
      const bulletSpd  = 180 + lvl * 25;
      const ringCount  = 8 + lvl * 2;

      // ── Pause between bursts (scales down with area but never below 1s) ──
      // Area 1: 2.0s pause  |  Area 5: 1.4s  |  Area 10: 1.0s
      const pauseDuration = Math.max(800, 2200 - lvl * 140);

      if (currentBoss.inPause) {
        // Boss is resting — count down then resume shooting
        currentBoss.pauseTimer -= delta;
        if (currentBoss.pauseTimer <= 0) {
          currentBoss.inPause = false;
          bossShootTimer = 0;
        }
      } else {
        // Boss is in shooting mode
        // Fire rate: gets faster per phase and per area, but stays readable
        const ringRate = hpPct > 0.66
          ? Math.max(700, 1600 - lvl * 80)
          : hpPct > 0.33
            ? Math.max(550, 1200 - lvl * 70)
            : Math.max(420, 900 - lvl * 55);

        const aimRate = hpPct > 0.66
          ? (lvl < 1 ? 99999 : Math.max(700, 1400 - lvl * 80))
          : hpPct > 0.33
            ? Math.max(600, 900 - lvl * 60)
            : Math.max(450, 700 - lvl * 45);

        bossShootTimer += delta;

        if (bossShootTimer >= Math.min(ringRate, aimRate)) {
          // Rotating ring burst
          const ringAngleOffset = Date.now() * 0.001 * (1 + lvl * 0.2);
          for (let i = 0; i < ringCount; i++) {
            const a = (Math.PI * 2 / ringCount) * i + ringAngleOffset;
            enemyFire(s, currentBoss.x, currentBoss.y, Math.cos(a) * bulletSpd, Math.sin(a) * bulletSpd, 'ebullet_red');
          }

          // Aimed shots (phase 2+)
          if (hpPct <= 0.66 || lvl >= 2) {
            const dx = player.x - currentBoss.x;
            const dy = player.y - currentBoss.y;
            const aimCount = hpPct <= 0.33 ? (2 + lvl) : (1 + Math.floor(lvl / 2));
            for (let i = 0; i < aimCount; i++) {
              const spread = (i - Math.floor(aimCount / 2)) * 0.22;
              const a = Math.atan2(dy, dx) + spread;
              enemyFire(s, currentBoss.x, currentBoss.y, Math.cos(a) * (bulletSpd + 50), Math.sin(a) * (bulletSpd + 50), 'ebullet_red');
            }
          }

          // Phase 3 boss #3+: counter-rotating spiral
          if (hpPct <= 0.33 && lvl >= 2) {
            const ringAngleOffset2 = Date.now() * 0.001 * (1 + lvl * 0.2);
            for (let i = 0; i < 6; i++) {
              const a = (Math.PI * 2 / 6) * i - ringAngleOffset2 * 1.5;
              enemyFire(s, currentBoss.x, currentBoss.y, Math.cos(a) * (bulletSpd * 0.65), Math.sin(a) * (bulletSpd * 0.65), 'ebullet_red');
            }
          }

          bossShootTimer = 0;

          // After each burst, enter a pause
          currentBoss.inPause    = true;
          currentBoss.pauseTimer = pauseDuration;
        }
      }

      // Boss movement speed — faster each round, extra boost in phase 3
      if (currentBoss.body) {
        const targetSpd = 100 + lvl * 28 + (hpPct < 0.33 ? 70 : 0);
        currentBoss.setVelocityX(currentBoss.body.velocity.x >= 0 ? targetSpd : -targetSpd);
      }

      // HP bar
      s.bossBarBg.setVisible(true);
      s.bossBarFg.setVisible(true);
      s.bossBarFg.setDisplaySize(200 * (currentBoss.hp / currentBoss.maxHp), 8);
      s.hudBossLabel.setText(`BOSS #${bossCount + 1}  ${currentBoss.hp} / ${currentBoss.maxHp}`);
    } else if (!bossActive) {
      s.bossBarBg.setVisible(false);
      s.bossBarFg.setVisible(false);
      s.hudBossLabel.setText('');
    }

    // ── Invulnerability ───────────────────────────────────────────────────
    if (invulnerableTimer > 0) {
      invulnerableTimer -= delta;
      if (invulnerableTimer <= 0) {
        invulnerable = false;
        if (invulnTween) { invulnTween.stop(); invulnTween = null; }
        player.setAlpha(1);
      }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────
    const OOB = 120;
    const gone = (o) => !o || !o.active || o.y < -OOB || o.y > H + OOB || o.x < -OOB || o.x > W + OOB;
    bullets.children.each(b      => { if (gone(b)) b && b.destroy(); });
    enemyBullets.children.each(b => { if (gone(b)) b && b.destroy(); });
    enemies.children.each(e      => { if (gone(e)) e && e.destroy(); });
    bosses.children.each(b => {
      if (b && b.active && b.y > H + 200) { b.destroy(); bossActive = false; currentBoss = null; }
    });

    updateHUD(s);
    updateDOM();
  }

  // ── Area transition ───────────────────────────────────────────────────────
  function startTransition(s) {
    transitioning    = true;
    transitionTimer  = TRANSITION_DURATION;

    // Clear the field for a brief breather
    enemies.clear(true, true);
    enemyBullets.clear(true, true);
    bullets.clear(true, true);
    bosses.clear(true, true);
    s.bossBarBg.setVisible(false);
    s.bossBarFg.setVisible(false);
    s.hudBossLabel.setText('');

    s.transOverlay.setAlpha(0.6);
    s.transText.setText(`AREA ${areaLevel} CLEAR!\nEntering Area ${areaLevel + 1}…`);
    s.transCountdown.setText('2');

    sfx.areaUp();
  }

  function endTransition(s) {
    transitioning = false;
    areaLevel     = bossCount + 1;        // area = bosses beaten + 1
    spawnRate     = Math.max(700, 1400 - bossCount * 100);
    bossTimer     = 0;                    // fresh warmup for next boss
    spawnTimer    = 800;

    s.transOverlay.setAlpha(0);
    s.transText.setText('');
    s.transCountdown.setText('');

    // Grace period on area entry
    invulnerable      = true;
    invulnerableTimer = 1500;
  }

  // ── Player bullets ────────────────────────────────────────────────────────
  function firePlayerBullets(s) {
    const offsets = [{ x: 0, a: 0 }, { x: -8, a: -0.21 }, { x: 8, a: 0.21 }];
    for (const o of offsets) {
      const b = bullets.create(player.x + o.x, player.y - 20, 'pbullet');
      b.setDisplaySize(8, 16);
      b.setVelocity(Math.sin(o.a) * 700, -700);
      b.body.allowGravity = false;
    }
    bulletsFired += 3;
    sfx.shoot();
  }

  function enemyFire(s, x, y, vx, vy, tex) {
    const b = enemyBullets.create(x, y, tex);
    b.setDisplaySize(12, 12);
    b.setVelocity(vx, vy);
    b.body.allowGravity = false;
  }

  // ── Spawn enemy ───────────────────────────────────────────────────────────
  function spawnEnemy(s) {
    const maxOnScreen = 3 + areaLevel;
    if (enemies.countActive(true) >= maxOnScreen) return;

    const types = ['drone'];
    if (areaLevel >= 2) types.push('spinner');
    if (areaLevel >= 3) types.push('rusher');

    const type = types[Phaser.Math.Between(0, types.length - 1)];
    let e;

    if (type === 'rusher') {
      const edge = Phaser.Math.Between(0, 3);
      let sx, sy;
      if (edge === 0)      { sx = Phaser.Math.Between(0, W); sy = -20; }
      else if (edge === 1) { sx = Phaser.Math.Between(0, W); sy = H + 20; }
      else if (edge === 2) { sx = -20; sy = Phaser.Math.Between(0, H); }
      else                 { sx = W + 20; sy = Phaser.Math.Between(0, H); }
      e = enemies.create(sx, sy, 'rusher');
      e.setDisplaySize(28, 28);
      const dx = player.x - sx, dy = player.y - sy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      e.setVelocity((dx / len) * 420, (dy / len) * 420);
    } else {
      e = enemies.create(Phaser.Math.Between(30, W - 30), -20, type === 'drone' ? 'drone' : 'spinner');
      e.setDisplaySize(type === 'drone' ? 24 : 28, type === 'drone' ? 24 : 28);
      e.setVelocityY(type === 'drone' ? 55 : 35);
      if (type === 'spinner') s.tweens.add({ targets: e, angle: 360, duration: 1200, repeat: -1 });
    }

    e.enemyType = type;
    e.body.allowGravity = false;
    e.setCollideWorldBounds(type !== 'rusher');
    if (type !== 'rusher') e.setBounce(1, 0);
  }

  // ── Spawn boss ────────────────────────────────────────────────────────────
  function spawnBoss(s) {
    if (bossActive) return;
    // HP: 40 base + 14 per kill + 6 per area level, so each fight is meaningfully harder
    const hp   = 40 + bossCount * 14 + areaLevel * 6;
    const size = Math.min(80 + bossCount * 6, 120);
    const b    = bosses.create(W / 2, 80, 'boss');
    b.setDisplaySize(size, size);
    b.setVelocity(100 + bossCount * 22, 0);
    b.setCollideWorldBounds(true);
    b.setBounce(1, 0);
    b.body.allowGravity = false;
    b.hp    = hp;
    b.maxHp = hp;
    // Pulse tween gets faster with each boss
    s.tweens.add({ targets: b, scaleX: 1.1, scaleY: 1.1, yoyo: true, duration: Math.max(280, 600 - bossCount * 40), repeat: -1 });
    bossActive    = true;
    currentBoss   = b;
    bossShootTimer = 0;
    b.pauseTimer  = 0;        // counts down during the inter-burst pause
    b.inPause     = false;    // true = boss is resting between bursts
  }

  // ── Hit handlers ──────────────────────────────────────────────────────────
  function hitEnemy(bullet, enemy) {
    if (!bullet.active || !enemy.active) return;
    const s = enemy.scene;
    bullet.destroy();
    enemy.destroy();
    score += 10;
    enemiesKilled++;
    coins += 2;
    sfx.enemyDie();
    burst(s, enemy.x, enemy.y, 0x00f0ff);
    floatText(s, enemy.x, enemy.y, '+10', '#00f0ff');
    if (Math.random() < 0.12) spawnPowerUp(s, enemy.x, enemy.y);
  }

  function hitBoss(bullet, boss) {
    if (!bullet.active || !boss.active) return;
    bullet.destroy();
    boss.hp -= 1;
    sfx.bossHit();

    // Phase-change flash
    const pct = boss.hp / boss.maxHp;
    if (boss.hp === Math.floor(boss.maxHp * 0.66) || boss.hp === Math.floor(boss.maxHp * 0.33)) {
      sfx.bossWarning();
    }

    if (boss.hp <= 0) {
      const s = boss.scene;
      sfx.bossDie();
      burst(s, boss.x, boss.y, 0xff2020, 22);
      burst(s, boss.x, boss.y, 0xffaa00, 14);
      const bonus = 200 + bossCount * 50;
      floatText(s, boss.x, boss.y, `+${bonus}`, '#ff2d78');
      score        += bonus;
      enemiesKilled += 5;
      coins        += 15 + bossCount * 3;
      if (Math.random() < 0.65) spawnPowerUp(s, boss.x, boss.y);
      boss.destroy();
      bossActive   = false;
      currentBoss  = null;
      bossCount++;
      invulnerable      = true;
      invulnerableTimer = 600;

      // Start area transition after a short pause
      s.time.delayedCall(520, () => startTransition(s));
    }
  }

  function hitPlayer(playerObj, other) {
    if (gameOver || invulnerable) return;
    lives--;
    sfx.playerHit();
    invulnerable      = true;
    invulnerableTimer = 1200;
    this.cameras.main.shake(180, 0.013);
    if (invulnTween) invulnTween.stop();
    invulnTween = this.tweens.add({ targets: player, alpha: { from: 0.3, to: 1 }, duration: 120, yoyo: true, repeat: -1 });
    if (other.destroy && other.active && enemyBullets.contains(other)) other.destroy();

    if (lives <= 0) {
      gameOver = true;
      player.setAlpha(0.3);
      this.gameOverText.setText('GAME  OVER\n\nPress R to restart');
      const playtime = (Date.now() - gameStartTime) / 1000;
      submitScore(score, enemiesKilled, bulletsFired, playtime);
    }
  }

  // ── Power-up ──────────────────────────────────────────────────────────────
  function spawnPowerUp(s, x, y) {
    const p = powerUps.create(x, y, 'powerup');
    p.setDisplaySize(20, 20);
    p.setVelocityY(80);
    p.body.allowGravity = false;
  }

  function collectPowerUp(playerObj, p) {
    p.destroy();
    sfx.powerUp();
    score  += 30;
    coins  += 3;
    if (lives < 5) { lives++; floatText(playerObj.scene, playerObj.x, playerObj.y - 20, '+1 ❤', '#00ff88'); }
    else floatText(playerObj.scene, playerObj.x, playerObj.y - 20, '+30', '#00ff88');
  }

  // ── Visual helpers ────────────────────────────────────────────────────────
  function burst(s, x, y, color, count = 10) {
    for (let i = 0; i < count; i++) {
      const circle = s.add.circle(x, y, Phaser.Math.Between(2, 5), color);
      const a = Math.random() * Math.PI * 2;
      const spd = Phaser.Math.Between(40, 160);
      s.tweens.add({
        targets: circle,
        x: x + Math.cos(a) * spd,
        y: y + Math.sin(a) * spd,
        alpha: 0, scaleX: 0, scaleY: 0,
        duration: 320, ease: 'Power2',
        onComplete: () => circle.destroy()
      });
    }
  }

  function floatText(s, x, y, msg, color) {
    const t = s.add.text(x, y, msg, { fontSize: '14px', fill: color, fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(0.5);
    s.tweens.add({ targets: t, y: y - 44, alpha: 0, duration: 600, ease: 'Power1', onComplete: () => t.destroy() });
  }

  // ── HUD ───────────────────────────────────────────────────────────────────
  function updateHUD(s) {
    s.hudScore.setText(`Score  ${score}`);
    s.hudLives.setText('♥ '.repeat(Math.max(0, lives)).trim());
    s.hudArea.setText(`Area ${areaLevel}  |  Boss #${bossCount + 1}`);
  }

  function updateDOM() {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('gameScore',   score);
    set('gameEnemies', enemiesKilled);
    set('gameBullets', bulletsFired);
    set('gameCoins',   coins);
    set('gameTime',    (elapsedTime / 1000).toFixed(1) + 's');
  }

  // ── Restart ───────────────────────────────────────────────────────────────
  function restart(s) {
    [enemies, bullets, enemyBullets, powerUps, bosses].forEach(g => g.clear(true, true));
    player.setPosition(W / 2, H - 80);
    player.setAlpha(1);
    player.setVisible(false);
    if (invulnTween) { invulnTween.stop(); invulnTween = null; }

    score = 0; lives = 3; coins = 0;
    enemiesKilled = 0; bulletsFired = 0;
    elapsedTime = 0; gameStartTime = 0;
    gameOver = false; gameStarted = false;
    invulnerable = false; invulnerableTimer = 0;
    shootTimer = 0; spawnTimer = 0; spawnRate = 1400;
    areaLevel = 1;
    bossTimer = 0; bossActive = false; currentBoss = null; bossShootTimer = 0;
    bossCount = 0;
    transitioning = false; transitionTimer = 0;

    s.transOverlay.setAlpha(0);
    s.transText.setText('');
    s.transCountdown.setText('');
    s.gameOverText.setText('');
    s.bossBarBg.setVisible(false);
    s.bossBarFg.setVisible(false);
    s.hudBossLabel.setText('');

    // Show start screen again
    s.startOverlay.setVisible(true);
    s.startTitle.setVisible(true);
    s.startSub.setVisible(true);
    s.startBtnGfx.setVisible(true);
    s.startBtnText.setVisible(true);

    updateDOM();
  }

  // ── Backend ───────────────────────────────────────────────────────────────
  function submitScore(score, enemiesKilled, bulletsFired, playtime) {
    fetch('/api/submit-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score, enemies_killed: enemiesKilled, bullets_fired: bulletsFired, playtime, difficulty: 'normal', pattern_used: 'default' })
    })
      .then(r => r.json())
      .then(() => refreshLeaderboard())
      .catch(err => console.warn('Score submit failed:', err));
  }

  function refreshLeaderboard() {
    fetch('/api/leaderboard?limit=8')
      .then(r => r.json())
      .then(data => {
        const list = document.getElementById('leaderboardList');
        if (!list) return;
        list.innerHTML = '';
        if (!data.length) { list.innerHTML = '<li class="lb-empty">No scores yet</li>'; return; }
        data.forEach((row, i) => {
          const li = document.createElement('li');
          li.textContent = `${i + 1}. ${row.username}  ${row.score}`;
          list.appendChild(li);
        });
      })
      .catch(() => {});
  }

})();