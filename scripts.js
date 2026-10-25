
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const scoreElement = document.getElementById("score");
const coinsElement = document.getElementById("coins");
const levelElement = document.getElementById("level");
const finalScoreElement = document.getElementById("finalScore");
const muteButton = document.getElementById("muteButton");
const volumeIcon = document.getElementById("volumeIcon");
const volumeSlider = document.getElementById("volumeSlider");
const volumeValue = document.getElementById("volumeValue");

const startScreen = document.getElementById("startScreen");
const gameOverScreen = document.getElementById("gameOverScreen");

const roadWidth = 420;
const roadLeft = (600 - roadWidth) / 2;
const laneX = [
    roadLeft + roadWidth / 6,
    roadLeft + roadWidth / 2,
    roadLeft + roadWidth * 5 / 6
];
const carColors = ["#3188e8", "#f5c542", "#38a96b", "#f4f4ef", "#252b36", "#e45c52"];
const baseSpeed = 220;
const maxSpeed = 420;
const speedPerDistance = 0.012;
const levelDistance = 2500;
const baseSpawnInterval = 0.95;
const minSpawnInterval = 0.72;
const audioPreferenceKey = "subwayRunnerAudio";
const musicNotes = [0, 7, 10, 7, 3, 7, 12, 10, 0, 7, 10, 14, 3, 10, 7, 5];

let player;
let obstacles;
let coins;
let scenery;
let score;
let collectedCoins;
let speed;
let spawnTimer;
let distance;
let difficulty;
let level;
let running = false;
let lastTime = 0;
let runTime = 0;
let audioContext;
let masterGain;
let musicGain;
let effectsGain;
let musicTimer;
let musicStep = 0;
let volume = 0.65;
let isMuted = false;
let lastCoinSoundTime = 0;

function loadAudioPreferences() {
    try {
        const saved = localStorage.getItem(audioPreferenceKey);
        if (saved) {
            const preferences = JSON.parse(saved);
            if (Number.isFinite(preferences.volume)) {
                volume = Math.max(0, Math.min(1, preferences.volume));
            }
            isMuted = Boolean(preferences.isMuted);
        }
    } catch (error) {
        console.warn("Δεν ήταν δυνατή η ανάγνωση των ρυθμίσεων ήχου:", error);
    }

    volumeSlider.value = Math.round(volume * 100);
    updateAudioControls();
}

function saveAudioPreferences() {
    try {
        localStorage.setItem(audioPreferenceKey, JSON.stringify({ volume, isMuted }));
    } catch (error) {
        console.warn("Δεν ήταν δυνατή η αποθήκευση των ρυθμίσεων ήχου:", error);
    }
}

function updateAudioControls() {
    const silent = isMuted || volume === 0;
    volumeIcon.textContent = silent ? "🔇" : volume < 0.4 ? "🔉" : "🔊";
    muteButton.setAttribute("aria-pressed", String(isMuted));
    muteButton.setAttribute("aria-label", isMuted ? "Ενεργοποίηση ήχου" : "Σίγαση ήχου");
    volumeValue.textContent = `${Math.round(volume * 100)}%`;

    if (masterGain && audioContext) {
        masterGain.gain.setTargetAtTime(
            isMuted ? 0 : volume,
            audioContext.currentTime,
            0.02
        );
    }
}

function ensureAudio() {
    if (audioContext) return true;

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
        console.error("Το πρόγραμμα περιήγησης δεν υποστηρίζει Web Audio API.");
        return false;
    }

    audioContext = new AudioContextConstructor();
    masterGain = audioContext.createGain();
    musicGain = audioContext.createGain();
    effectsGain = audioContext.createGain();

    musicGain.gain.value = 0.24;
    effectsGain.gain.value = 0.72;
    musicGain.connect(masterGain);
    effectsGain.connect(masterGain);
    masterGain.connect(audioContext.destination);
    updateAudioControls();

    return true;
}

function resumeAudio() {
    if (!ensureAudio()) return false;
    if (audioContext.state === "suspended") {
        audioContext.resume().catch(error => {
            console.error("Δεν ήταν δυνατή η εκκίνηση του ήχου:", error);
        });
    }
    return true;
}

function playTone(frequency, duration, waveform, gain, destination, endFrequency) {
    if (!audioContext || isMuted || volume === 0) return;

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const envelope = audioContext.createGain();
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency) {
        oscillator.frequency.exponentialRampToValueAtTime(
            Math.max(1, endFrequency),
            now + duration
        );
    }
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(envelope);
    envelope.connect(destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
    oscillator.addEventListener("ended", () => {
        oscillator.disconnect();
        envelope.disconnect();
    }, { once: true });
}

function playMusicStep() {
    if (!audioContext || !running || isMuted || volume === 0) return;

    const step = musicStep % musicNotes.length;
    const root = 110;
    const note = root * Math.pow(2, musicNotes[step] / 12);

    if (step % 4 === 0) {
        playTone(130, 0.13, "sine", 0.48, musicGain, 48);
    }
    if (step % 4 === 2) {
        playTone(190, 0.07, "triangle", 0.12, musicGain, 90);
    }
    if (step % 2 === 0) {
        playTone(note * 2, 0.105, "square", 0.075, musicGain);
    }
    playTone(note, 0.11, "triangle", 0.16, musicGain);
    musicStep++;
}

function startMusic() {
    if (!resumeAudio() || musicTimer) return;

    musicStep = 0;
    musicGain.gain.cancelScheduledValues(audioContext.currentTime);
    musicGain.gain.setTargetAtTime(0.24, audioContext.currentTime, 0.04);
    playMusicStep();
    musicTimer = window.setInterval(playMusicStep, 125);
}

function stopMusic() {
    if (musicTimer) {
        window.clearInterval(musicTimer);
        musicTimer = undefined;
    }
    if (musicGain && audioContext) {
        musicGain.gain.cancelScheduledValues(audioContext.currentTime);
        musicGain.gain.setTargetAtTime(0.0001, audioContext.currentTime, 0.07);
    }
}

function playJumpSound() {
    if (!resumeAudio()) return;
    playTone(420, 0.16, "triangle", 0.25, effectsGain, 760);
}

function playCrouchSound() {
    if (!resumeAudio()) return;
    playTone(300, 0.12, "sine", 0.16, effectsGain, 175);
}

function playCoinSound() {
    if (!resumeAudio()) return;
    const now = audioContext.currentTime;
    if (now - lastCoinSoundTime < 0.07) return;
    lastCoinSoundTime = now;
    playTone(880, 0.09, "sine", 0.2, effectsGain);
    playTone(1320, 0.12, "sine", 0.13, effectsGain);
}

function playCrashSound() {
    if (!resumeAudio()) return;
    playTone(165, 0.32, "sawtooth", 0.32, effectsGain, 42);
    playTone(95, 0.22, "triangle", 0.22, effectsGain, 38);
}

function resetGame() {
    player = {
        lane: 1,
        x: laneX[1],
        y: 535,
        width: 42,
        height: 58,
        jump: 0,
        jumpVelocity: 0,
        crouch: 0,
        crouchHeld: false,
        crouchSoundPlayed: false
    };

    obstacles = [];
    coins = [];
    scenery = createScenery();
    score = 0;
    collectedCoins = 0;
    distance = 0;
    difficulty = 0;
    level = 1;
    speed = baseSpeed;
    spawnTimer = 0;
    runTime = 0;

    scoreElement.textContent = "0";
    coinsElement.textContent = "0";
    levelElement.textContent = "1";
}

function createScenery() {
    const objects = [];
    const types = ["tree", "building", "lamp", "bush"];

    for (const side of [-1, 1]) {
        for (let index = 0; index < 8; index++) {
            objects.push({
                side,
                depth: index / 8,
                type: types[Math.floor(Math.random() * types.length)],
                variation: Math.random()
            });
        }
    }

    return objects;
}

function startGame() {
    resetGame();

    startScreen.classList.add("hidden");
    gameOverScreen.classList.add("hidden");

    running = true;
    lastTime = performance.now();
    startMusic();
    requestAnimationFrame(gameLoop);
}

function endGame() {
    if (!running) return;
    running = false;

    finalScoreElement.textContent = Math.floor(score);
    gameOverScreen.classList.remove("hidden");
    playCrashSound();
    stopMusic();
}

function movePlayer(direction) {
    if (!running) return;

    player.lane = Math.max(
        0,
        Math.min(2, player.lane + direction)
    );
}

function jump() {
    if (!running || player.jump > 0) return;

    player.crouchHeld = false;
    player.jumpVelocity = 520;
    playJumpSound();
}

document.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key)) {
        event.preventDefault();
    }

    if (event.key === "ArrowDown") {
        if (running && !player.crouchHeld) {
            player.crouchHeld = true;
            player.crouchSoundPlayed = false;
        }
        return;
    }

    if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
        movePlayer(-1);
    }

    if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
        movePlayer(1);
    }

    if (event.key === "ArrowUp" || event.key === " ") {
        jump();
    }
});

document.addEventListener("keyup", (event) => {
    if (event.key === "ArrowDown" && player) {
        player.crouchHeld = false;
    }
});

window.addEventListener("blur", () => {
    if (player) player.crouchHeld = false;
});

function spawnObjects() {
    const lanes = [0, 1, 2];
    for (let index = lanes.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [lanes[index], lanes[swapIndex]] = [lanes[swapIndex], lanes[index]];
    }
    const obstacleCount = difficulty > 0.12 && Math.random() < difficulty * 0.55 ? 2 : 1;

    for (let index = 0; index < obstacleCount; index++) {
        const lane = lanes[index];
        const isOverhead = difficulty > 0.08 &&
            Math.random() < 0.08 + difficulty * 0.16;
        const isBarrier = !isOverhead &&
            Math.random() < 0.06 + difficulty * 0.24;

        obstacles.push({
            lane,
            y: isOverhead ? -110 : isBarrier ? -84 : -60,
            width: isOverhead ? 118 : isBarrier ? 58 : 54,
            height: isOverhead ? 20 : isBarrier ? 30 : 54,
            type: isOverhead ? "overhead" : isBarrier ? "barrier" : "car",
            color: carColors[Math.floor(Math.random() * carColors.length)],
            style: Math.random()
        });
    }

    // Keep a coin path available in the open lane from time to time.
    if (Math.random() < 0.35) {
        const openLane = lanes[obstacleCount];
        coins.push({
            lane: openLane,
            y: -30,
            radius: 13
        });
    }
}

function update(dt) {
    score += dt * 10;
    runTime += dt;
    distance += speed * dt;
    difficulty = Math.min(1, distance / 12000);
    level = Math.floor(distance / levelDistance) + 1;
    speed = Math.min(maxSpeed, baseSpeed + distance * speedPerDistance);

    for (const object of scenery) {
        object.depth += speed * dt / 620;

        while (object.depth >= 1) {
            object.depth -= 1;
            object.type = ["tree", "building", "lamp", "bush"][
                Math.floor(Math.random() * 4)
            ];
            object.variation = Math.random();
        }
    }

    // Ομαλή κίνηση προς την επιλεγμένη λωρίδα
    player.x += (laneX[player.lane] - player.x) *
                Math.min(1, dt * 12);
    const crouchTarget = player.crouchHeld && player.jump < 10 ? 1 : 0;
    if (crouchTarget && !player.crouchSoundPlayed) {
        playCrouchSound();
        player.crouchSoundPlayed = true;
    }
    player.crouch += (crouchTarget - player.crouch) *
                     Math.min(1, dt * 14);
    if (Math.abs(crouchTarget - player.crouch) < 0.02) {
        player.crouch = crouchTarget;
    }

    // Άλμα με βαρύτητα
    if (player.jump > 0 || player.jumpVelocity > 0) {
        player.jump += player.jumpVelocity * dt;
        player.jumpVelocity -= 1300 * dt;

        if (player.jump <= 0) {
            player.jump = 0;
            player.jumpVelocity = 0;
        }
    }

    spawnTimer += dt;

    const spawnInterval = baseSpawnInterval -
        difficulty * (baseSpawnInterval - minSpawnInterval);
    if (spawnTimer >= spawnInterval) {
        spawnObjects();
        spawnTimer -= spawnInterval;
    }

    for (const obstacle of obstacles) {
        obstacle.y += speed * dt;

        const sameLane = obstacle.lane === player.lane;
        if (obstacle.type === "overhead") {
            const overlapsHead = obstacle.y < player.y + 8 &&
                obstacle.y + obstacle.height > player.y - 22;

            if (sameLane && overlapsHead &&
                (player.crouch < 0.75 || player.jump > 10)) {
                endGame();
                return;
            }
            continue;
        }

        const hitboxTop = obstacle.type === "barrier" ? obstacle.y + 8 : obstacle.y;
        const hitboxBottom = obstacle.y + obstacle.height;
        const closeY = hitboxBottom > player.y &&
                       hitboxTop < player.y + player.height;

        const cannotJumpOver = obstacle.type === "barrier" && player.jump < 45;
        const carCollision = obstacle.type !== "barrier" && player.jump < 45;
        if (sameLane && closeY && (cannotJumpOver || carCollision)) {
            endGame();
            return;
        }
    }

    for (const coin of coins) {
        coin.y += speed * dt;

        const sameLane = coin.lane === player.lane;
        const closeY = Math.abs(
            coin.y - (player.y + player.height / 2)
        ) < 35;

        if (sameLane && closeY && !coin.collected) {
            coin.collected = true;
            collectedCoins++;
            score += 50;
            playCoinSound();
        }
    }

    obstacles = obstacles.filter(
        obstacle => obstacle.y < canvas.height + 70
    );

    coins = coins.filter(
        coin => coin.y < canvas.height + 40 && !coin.collected
    );

    scoreElement.textContent = Math.floor(score);
    coinsElement.textContent = collectedCoins;
    levelElement.textContent = level;
}

function draw() {
    // Πλατιές άκρες δρόμου / πεζοδρόμια
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#91b9a0");
    gradient.addColorStop(1, "#638b71");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#b8b7a5";
    ctx.fillRect(roadLeft - 5, 0, roadWidth + 10, canvas.height);
    ctx.fillStyle = "#c9c7b6";
    ctx.fillRect(0, 0, roadLeft - 5, canvas.height);
    ctx.fillRect(roadLeft + roadWidth + 5, 0, roadLeft - 5, canvas.height);
    drawSidewalkDetails();
    drawScenery();

    // Τρεις λωρίδες
    const roadGradient = ctx.createLinearGradient(roadLeft, 0, roadLeft + roadWidth, 0);
    roadGradient.addColorStop(0, "#303b4c");
    roadGradient.addColorStop(0.5, "#3d4858");
    roadGradient.addColorStop(1, "#303b4c");
    ctx.fillStyle = roadGradient;
    ctx.fillRect(roadLeft, 0, roadWidth, canvas.height);
    ctx.fillStyle = "#e2d7b9";
    ctx.fillRect(roadLeft + 3, 0, 3, canvas.height);
    ctx.fillRect(roadLeft + roadWidth - 6, 0, 3, canvas.height);

    ctx.strokeStyle = "#8090a5";
    ctx.lineWidth = 3;
    ctx.setLineDash([22, 18]);

    ctx.beginPath();
    ctx.moveTo(roadLeft + roadWidth / 3, 0);
    ctx.lineTo(roadLeft + roadWidth / 3, canvas.height);
    ctx.moveTo(roadLeft + roadWidth * 2 / 3, 0);
    ctx.lineTo(roadLeft + roadWidth * 2 / 3, canvas.height);
    ctx.stroke();

    ctx.setLineDash([]);

    // Εμπόδια
    for (const obstacle of obstacles) {
        if (obstacle.type === "overhead") {
            drawOverhead(obstacle);
        } else if (obstacle.type === "barrier") {
            drawBarrier(obstacle);
        } else {
            drawCar(obstacle);
        }
    }

    // Νομίσματα
    for (const coin of coins) {
        ctx.beginPath();
        ctx.arc(
            laneX[coin.lane],
            coin.y,
            coin.radius,
            0,
            Math.PI * 2
        );
        ctx.fillStyle = "#ffd447";
        ctx.fill();
        ctx.strokeStyle = "#fff0a0";
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    drawRunner();
}

function drawOverhead(obstacle) {
    const x = laneX[obstacle.lane];
    const y = obstacle.y;

    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = "rgb(8 14 23 / 30%)";
    ctx.fillRect(-58, 68, 8, 5);
    ctx.fillRect(50, 68, 8, 5);

    ctx.fillStyle = "#4b5966";
    ctx.fillRect(-55, 12, 7, 56);
    ctx.fillRect(48, 12, 7, 56);
    ctx.fillStyle = "#778797";
    ctx.fillRect(-53, 15, 3, 50);
    ctx.fillRect(50, 15, 3, 50);

    ctx.fillStyle = "#202d3b";
    ctx.beginPath();
    ctx.roundRect(-62, -2, 124, 24, 5);
    ctx.fill();
    ctx.fillStyle = "#f0b93e";
    ctx.beginPath();
    ctx.roundRect(-58, 1, 116, 17, 3);
    ctx.fill();
    ctx.fillStyle = "#263343";
    ctx.font = "bold 10px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ΧΑΜΗΛΟ", 0, 9);

    ctx.restore();
}

function drawBarrier(obstacle) {
    const x = laneX[obstacle.lane];
    const y = obstacle.y;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgb(8 14 23 / 30%)";
    ctx.beginPath();
    ctx.ellipse(0, 31, 31, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f2a33a";
    ctx.beginPath();
    ctx.roundRect(-29, 8, 58, 22, 5);
    ctx.fill();
    ctx.fillStyle = "#f7e8bd";
    for (let stripe = -20; stripe <= 12; stripe += 16) {
        ctx.save();
        ctx.translate(stripe, 8);
        ctx.rotate(-0.55);
        ctx.fillRect(0, 0, 7, 22);
        ctx.restore();
    }
    ctx.fillStyle = "#e9edf0";
    ctx.fillRect(-25, 30, 7, 6);
    ctx.fillRect(18, 30, 7, 6);
    ctx.restore();
}

function drawSidewalkDetails() {
    const offset = (runTime * speed * 0.45) % 52;
    ctx.fillStyle = "rgb(91 91 80 / 18%)";

    for (let y = -52 + offset; y < canvas.height; y += 52) {
        ctx.fillRect(0, y, roadLeft - 5, 2);
        ctx.fillRect(roadLeft + roadWidth + 5, y, roadLeft - 5, 2);
    }
}

function drawScenery() {
    const horizonY = 82;
    const depthRange = canvas.height - horizonY + 55;

    for (const object of scenery) {
        const depth = object.depth;
        const perspective = depth * depth * (3 - 2 * depth);
        const y = horizonY + perspective * depthRange;
        const scale = 0.35 + depth * 0.65;
        const side = object.side;
        let x;

        if (object.type === "building") {
            x = side < 0 ? roadLeft - 5 : roadLeft + roadWidth + 5;
        } else if (object.type === "tree") {
            x = side < 0
                ? roadLeft - 39 * scale
                : roadLeft + roadWidth + 39 * scale;
        } else if (object.type === "bush") {
            x = side < 0 ? roadLeft - 31 * scale : roadLeft + roadWidth + 31 * scale;
        } else {
            x = side < 0 ? roadLeft - 26 * scale : roadLeft + roadWidth + 26 * scale;
        }

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scale, scale);

        if (object.type === "tree") {
            const trunkHeight = 38 + object.variation * 28;
            const crownRadius = 24 + object.variation * 10;
            ctx.fillStyle = "rgb(26 43 34 / 22%)";
            ctx.beginPath();
            ctx.ellipse(side < 0 ? 18 : -18, 2, 28, 8, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#68482f";
            ctx.fillRect(-6, -trunkHeight, 12, trunkHeight);
            ctx.fillStyle = object.variation > 0.5 ? "#347d52" : "#438f5b";
            ctx.beginPath();
            ctx.arc(0, -trunkHeight - crownRadius * 0.55, crownRadius, 0, Math.PI * 2);
            ctx.arc(-crownRadius * 0.65, -trunkHeight, crownRadius * 0.68, 0, Math.PI * 2);
            ctx.arc(crownRadius * 0.65, -trunkHeight, crownRadius * 0.68, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "rgb(176 220 145 / 55%)";
            ctx.beginPath();
            ctx.arc(-crownRadius * 0.25, -trunkHeight - crownRadius * 0.9, 5, 0, Math.PI * 2);
            ctx.fill();
        } else if (object.type === "building") {
            const buildingWidth = 48 + object.variation * 28;
            const buildingHeight = 66 + object.variation * 70;
            const facadeX = side < 0 ? -buildingWidth : 0;
            ctx.fillStyle = "rgb(26 37 46 / 20%)";
            ctx.fillRect(facadeX + (side < 0 ? -8 : 8), -buildingHeight + 8, buildingWidth, buildingHeight);
            ctx.fillStyle = object.variation > 0.5 ? "#6b8796" : "#a38368";
            ctx.fillRect(
                facadeX,
                -buildingHeight,
                buildingWidth,
                buildingHeight
            );
            ctx.fillStyle = object.variation > 0.5 ? "#829dad" : "#bd9b79";
            ctx.fillRect(facadeX, -buildingHeight, buildingWidth, 8);
            ctx.fillStyle = "#f4d58a";
            for (let windowY = -buildingHeight + 18; windowY < -10; windowY += 22) {
                for (let windowX = facadeX + 9; windowX < facadeX + buildingWidth - 8; windowX += 18) {
                    ctx.fillRect(windowX, windowY, 8, 11);
                    ctx.fillStyle = "rgb(255 255 255 / 35%)";
                    ctx.fillRect(windowX + 1, windowY + 1, 2, 8);
                    ctx.fillStyle = "#f4d58a";
                }
            }
        } else if (object.type === "lamp") {
            ctx.strokeStyle = "#d4dbe2";
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -82);
            ctx.lineTo(side < 0 ? 19 : -19, -82);
            ctx.stroke();
            ctx.fillStyle = "rgb(255 226 138 / 25%)";
            ctx.beginPath();
            ctx.arc(side < 0 ? 19 : -19, -82, 13, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#ffe28a";
            ctx.fillRect(side < 0 ? 14 : -24, -87, 10, 8);
        } else {
            ctx.fillStyle = "#347b54";
            ctx.beginPath();
            ctx.ellipse(0, -10, 26, 16, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#55a66e";
            ctx.beginPath();
            ctx.arc(-10, -16, 11, 0, Math.PI * 2);
            ctx.arc(8, -17, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#dfcfad";
            ctx.fillRect(-19, 0, 38, 4);
        }

        ctx.restore();
    }
}

function drawCar(obstacle) {
    const x = laneX[obstacle.lane];
    const y = obstacle.y;
    const width = 50;
    const height = 54;
    const bodyColor = obstacle.color;
    const roofHeight = obstacle.style > 0.55 ? 24 : 20;

    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = "rgb(5 12 20 / 38%)";
    ctx.beginPath();
    ctx.ellipse(2, height - 2, 27, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#171d25";
    ctx.beginPath();
    ctx.roundRect(-width / 2 - 3, 10, 8, 15, 3);
    ctx.roundRect(width / 2 - 5, 10, 8, 15, 3);
    ctx.roundRect(-width / 2 - 3, 34, 8, 15, 3);
    ctx.roundRect(width / 2 - 5, 34, 8, 15, 3);
    ctx.fill();

    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.moveTo(-19, 2);
    ctx.quadraticCurveTo(-24, 5, -24, 14);
    ctx.lineTo(-25, 42);
    ctx.quadraticCurveTo(-24, 51, -17, 53);
    ctx.lineTo(17, 53);
    ctx.quadraticCurveTo(24, 51, 25, 42);
    ctx.lineTo(24, 14);
    ctx.quadraticCurveTo(24, 5, 19, 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgb(255 255 255 / 45%)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#223b50";
    ctx.beginPath();
    ctx.moveTo(-16, 11);
    ctx.quadraticCurveTo(-14, 7, -9, 7);
    ctx.lineTo(9, 7);
    ctx.quadraticCurveTo(14, 7, 16, 11);
    ctx.lineTo(18, roofHeight);
    ctx.lineTo(-18, roofHeight);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgb(177 224 241 / 62%)";
    ctx.beginPath();
    ctx.moveTo(-14, 11);
    ctx.lineTo(-2, 10);
    ctx.lineTo(-2, roofHeight - 3);
    ctx.lineTo(-16, roofHeight - 3);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#263e50";
    ctx.fillRect(-17, roofHeight + 4, 34, 3);
    ctx.fillStyle = "#ffe6a1";
    ctx.fillRect(-19, 5, 9, 4);
    ctx.fillRect(10, 5, 9, 4);
    ctx.fillStyle = "#fa514d";
    ctx.fillRect(-19, 46, 9, 4);
    ctx.fillRect(10, 46, 9, 4);
    ctx.fillStyle = "rgb(255 255 255 / 30%)";
    ctx.fillRect(-2, 30, 4, 11);

    ctx.restore();
}

function drawRunner() {
    const groundY = player.y + player.height - player.jump;
    const phase = Math.sin(runTime * 13);
    const stride = phase * 9 * (1 - player.crouch * 0.75);

    ctx.save();
    ctx.translate(player.x, groundY + player.crouch * 2);
    ctx.fillStyle = "rgb(8 14 23 / 30%)";
    ctx.beginPath();
    ctx.ellipse(0, 1 + player.jump * 0.015, 19, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.scale(1, 1 - player.crouch * 0.34);
    ctx.rotate(player.crouch * 0.12);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Legs and bright running shoes
    ctx.strokeStyle = "#273956";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(-5, -25);
    ctx.lineTo(-7 + stride, -13);
    ctx.lineTo(-8 + stride * 1.45, -3);
    ctx.moveTo(5, -25);
    ctx.lineTo(7 - stride, -13);
    ctx.lineTo(8 - stride * 1.45, -3);
    ctx.stroke();

    ctx.strokeStyle = "#f4f6f8";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-8 + stride * 1.45, -3);
    ctx.lineTo(-13 + stride * 1.45, -1);
    ctx.moveTo(8 - stride * 1.45, -3);
    ctx.lineTo(13 - stride * 1.45, -1);
    ctx.stroke();
    ctx.strokeStyle = "#e84f45";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-10 + stride * 1.45, -2);
    ctx.lineTo(-5 + stride * 1.45, -2);
    ctx.moveTo(6 - stride * 1.45, -2);
    ctx.lineTo(11 - stride * 1.45, -2);
    ctx.stroke();

    // Arms swing opposite to the legs
    ctx.strokeStyle = "#d99b70";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-10, -45 + player.crouch * 8);
    ctx.lineTo(-14 - stride * 0.55, -36 + player.crouch * 12);
    ctx.lineTo(-11 - stride, -30 + player.crouch * 13);
    ctx.moveTo(10, -45 + player.crouch * 8);
    ctx.lineTo(14 + stride * 0.55, -36 + player.crouch * 12);
    ctx.lineTo(11 + stride, -30 + player.crouch * 13);
    ctx.stroke();

    // Shirt, neck, and head
    ctx.fillStyle = "#13a7a0";
    ctx.beginPath();
    ctx.roundRect(-11, -50, 22, 28, 7);
    ctx.fill();
    ctx.fillStyle = "#f0b78c";
    ctx.fillRect(-4, -55, 8, 8);
    ctx.beginPath();
    ctx.arc(0, -62, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3b2c29";
    ctx.beginPath();
    ctx.arc(-1, -66, 10, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#30313a";
    ctx.beginPath();
    ctx.arc(-3, -62, 1.2, 0, Math.PI * 2);
    ctx.arc(3, -62, 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function gameLoop(timestamp) {
    if (!running) return;

    const dt = Math.min((timestamp - lastTime) / 1000, 0.04);
    lastTime = timestamp;

    update(dt);

    if (!running) {
        draw();
        return;
    }

    draw();
    requestAnimationFrame(gameLoop);
}

document.getElementById("startButton")
    .addEventListener("click", startGame);

document.getElementById("restartButton")
    .addEventListener("click", startGame);

muteButton.addEventListener("click", () => {
    isMuted = !isMuted;
    updateAudioControls();
    saveAudioPreferences();
});

volumeSlider.addEventListener("input", () => {
    volume = Number(volumeSlider.value) / 100;
    updateAudioControls();
    saveAudioPreferences();
});

// Αρχική εμφάνιση πριν ξεκινήσει το παιχνίδι
loadAudioPreferences();
resetGame();
draw();
