/**
 * Player Client Controller (Kahoot-Style Flow)
 */

class PlayerController {
    constructor() {
        const urlParams = new URLSearchParams(window.location.search);
        this.roomId = (urlParams.get("room") || "ACM2026").toUpperCase();
        this.sync = new GameSync(this.roomId);

        this.currentPlayer = null; // { id, name }
        this.timeLimitSeconds = 120;
        this.timerCountdownInterval = null;
        this.remainingSeconds = 120;
        this.gameStarted = false;
        this.gameFinished = false;
        this.heartbeatInterval = null;

        this.initDOM();
        this.bindEvents();
        this.listenToSync();
    }

    startHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            if (this.currentPlayer && this.currentPlayer.id) {
                this.sync.sendHeartbeat(this.currentPlayer.id);
            }
        }, 1500);
    }

    initDOM() {
        const roomBadge = document.getElementById("displayRoomCode");
        if (roomBadge) roomBadge.textContent = this.roomId;

        // Rule: If player closes browser completely or refreshes the page,
        // they are completely removed from the room, waiting room, & leaderboard.
        // We do NOT restore previous session; we ensure any old session is removed on the server.
        try {
            const saved = sessionStorage.getItem(`acm_player_${this.roomId}`) || localStorage.getItem(`acm_player_${this.roomId}`);
            if (saved) {
                const old = JSON.parse(saved);
                if (old && old.id) {
                    this.sync.leaveRoom(old.id, true);
                }
            }
        } catch (e) {}
        try { sessionStorage.removeItem(`acm_player_${this.roomId}`); } catch (e) {}
        try { localStorage.removeItem(`acm_player_${this.roomId}`); } catch (e) {}
        try { sessionStorage.removeItem(`acm_active_game_${this.roomId}`); } catch (e) {}
        try { localStorage.removeItem(`acm_maze_save_${this.roomId}`); } catch (e) {}
        this.currentPlayer = null;
    }

    bindEvents() {
        // Handle tab close, app switch, or clearing recent tabs: immediately remove player
        const handlePlayerUnload = () => {
            if (this.currentPlayer && this.currentPlayer.id) {
                const pid = this.currentPlayer.id;
                this.sync.leaveRoom(pid, true);
                if (this.heartbeatInterval) {
                    clearInterval(this.heartbeatInterval);
                    this.heartbeatInterval = null;
                }
                try { sessionStorage.removeItem(`acm_player_${this.roomId}`); } catch (e) {}
                try { localStorage.removeItem(`acm_player_${this.roomId}`); } catch (e) {}
                try { sessionStorage.removeItem(`acm_active_game_${this.roomId}`); } catch (e) {}
                try { localStorage.removeItem(`acm_maze_save_${this.roomId}`); } catch (e) {}
            }
        };
        window.addEventListener("beforeunload", handlePlayerUnload);
        window.addEventListener("pagehide", handlePlayerUnload);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") {
                handlePlayerUnload();
            }
        });

        const joinBtn = document.getElementById("btnJoinLobby");
        const nameInput = document.getElementById("inputNickname");

        const submitJoin = async () => {
            const name = nameInput.value.trim();
            this.showError("");

            if (!name) {
                this.showError("Please enter your nickname.");
                return;
            }

            if (name.length > 20) {
                this.showError("Nickname must be 20 characters or less.");
                return;
            }

            joinBtn.disabled = true;
            joinBtn.textContent = "Joining...";

            try {
                const res = await this.sync.joinPlayer(name);
                if (!res.success) {
                    this.showError(res.error || "Could not join lobby.");
                    joinBtn.disabled = false;
                    joinBtn.textContent = "Join Game";
                    return;
                }

                this.currentPlayer = { id: res.playerId, name: res.player.name };
                this.sync.setCurrentPlayerId(this.currentPlayer.id);
                this.startHeartbeat();
                try {
                    sessionStorage.setItem(`acm_player_${this.roomId}`, JSON.stringify(this.currentPlayer));
                } catch (e) {}

                // Immediately transition to waiting room (Ready)
                this.showLobbyWaiting();
            } catch (err) {
                console.error("Join error:", err);
                this.showError("Network error joining lobby. Please try again.");
            } finally {
                joinBtn.disabled = false;
                joinBtn.textContent = "Join Game";
            }
        };

        if (joinBtn) joinBtn.addEventListener("click", submitJoin);
        if (nameInput) {
            nameInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") submitJoin();
            });
        }
    }

    showError(msg) {
        const el = document.getElementById("joinErrorBanner");
        if (!el) return;
        if (!msg) {
            el.style.display = "none";
            el.textContent = "";
        } else {
            el.style.display = "block";
            el.textContent = msg;
        }
    }

    switchScreen(screenId) {
        document.querySelectorAll(".app-screen").forEach(el => el.classList.remove("active"));
        const target = document.getElementById(screenId);
        if (target) target.classList.add("active");
        // Lock viewport scroll on mobile during the game screen
        document.body.classList.toggle("game-active", screenId === "screenGame");
    }

    showLobbyWaiting() {
        const nameDisplay = document.getElementById("waitingPlayerName");
        if (nameDisplay && this.currentPlayer) {
            nameDisplay.textContent = this.currentPlayer.name;
        }
        this.switchScreen("screenLobbyWaiting");
    }

    showCountdownOverlay() {
        if (this.isCountingDown) return; // Prevent repeated reset while countdown is actively ticking
        this.isCountingDown = true;

        const overlay = document.getElementById("countdownOverlay");
        const numEl = document.getElementById("countdownNumber");
        const subEl = document.getElementById("countdownSubtitle");
        if (!overlay || !numEl) return;

        overlay.classList.add("active");
        let count = 3;
        numEl.textContent = count;
        numEl.style.color = "#38bdf8";
        if (subEl) subEl.textContent = "GET READY!";

        if (window.gameInstance && window.gameInstance.sound) {
            window.gameInstance.sound.init();
            window.gameInstance.sound.playCountdownBeep(false);
        }

        if (this.countdownTimerInterval) clearInterval(this.countdownTimerInterval);
        this.countdownTimerInterval = setInterval(() => {
            count--;
            if (count > 0) {
                numEl.textContent = count;
                numEl.style.animation = 'none';
                void numEl.offsetWidth;
                numEl.style.animation = 'zoomPulse 1s ease-in-out infinite';

                if (window.gameInstance && window.gameInstance.sound) {
                    window.gameInstance.sound.playCountdownBeep(false);
                }
            } else if (count === 0) {
                numEl.textContent = "GO!";
                numEl.style.color = "#00f5d4";
                numEl.style.animation = 'none';
                void numEl.offsetWidth;
                numEl.style.animation = 'zoomPulse 1s ease-in-out infinite';

                if (subEl) subEl.textContent = "FIND LETTERS A, C, M!";
                if (window.gameInstance && window.gameInstance.sound) {
                    window.gameInstance.sound.playCountdownBeep(true);
                }

                // EXACT 3-SECOND MARK: START GAME IMMEDIATELY WITH ZERO DELAY!
                if (this.currentPlayer && !this.gameStarted && !this.gameFinished) {
                    this.launchGame(this.cachedTimeLimit || 120, this.cachedStartTime || Date.now());
                }

                // Hide overlay after quick 350ms "GO!" flash directly into the live game
                setTimeout(() => {
                    this.hideCountdownOverlay();
                }, 350);

                clearInterval(this.countdownTimerInterval);
                this.countdownTimerInterval = null;
            }
        }, 1000);
    }

    hideCountdownOverlay() {
        this.isCountingDown = false;
        if (this.countdownTimerInterval) {
            clearInterval(this.countdownTimerInterval);
            this.countdownTimerInterval = null;
        }
        const overlay = document.getElementById("countdownOverlay");
        if (overlay) overlay.classList.remove("active");
    }

    listenToSync() {
        this.sync.onUpdate((state) => {
            // If host triggers 3-second countdown
            if (state.status === "COUNTDOWN") {
                this.cachedTimeLimit = state.timeLimit || 120;
                this.cachedStartTime = state.startTime || (state.countdownStart ? state.countdownStart + 3000 : Date.now() + 3000);
                if (this.currentPlayer && !this.gameStarted) {
                    // Pre-switch directly to screenGame behind overlay so no lobby/joining screen is ever exposed
                    this.switchScreen("screenGame");
                    if (window.gameInstance) {
                        window.gameInstance.resizeCanvas();
                    }
                    this.showCountdownOverlay();
                }
            } else if (state.status === "STARTED") {
                this.hideCountdownOverlay();
                if (this.currentPlayer && !this.gameStarted && !this.gameFinished) {
                    this.launchGame(state.timeLimit, state.startTime);
                }
            } else if (state.status === "ENDED") {
                this.hideCountdownOverlay();
                if (this.currentPlayer) {
                    this.showLeaderboard(state);
                }
            } else if (state.status === "LOBBY") {
                this.hideCountdownOverlay();
                this.gameStarted = false;
                this.gameFinished = false;
                this.finishTimestamp = null;
                if (this.timerCountdownInterval) clearInterval(this.timerCountdownInterval);

                // If player has joined, keep them in the waiting room!
                if (this.currentPlayer) {
                    if (state.players && state.players[this.currentPlayer.id]) {
                        this.showLobbyWaiting();
                    } else if (state.players && Object.keys(state.players).length === 0) {
                        // Host explicitly cleared the lobby completely
                        this.currentPlayer = null;
                        try { sessionStorage.removeItem(`acm_player_${this.roomId}`); } catch (e) {}
                        this.switchScreen("screenJoin");
                    } else {
                        // Re-register player with the host in case server lost state
                        this.sync.ensurePlayerInRoom(this.currentPlayer);
                        this.showLobbyWaiting();
                    }
                } else {
                    this.switchScreen("screenJoin");
                }
            }
        });
    }

    launchGame(timeLimit, startTime) {
        if (this.gameStarted) return;
        this.gameStarted = true;
        this.gameFinished = false;
        this.finishTimestamp = null;
        this.timeLimitSeconds = timeLimit || 120;
        this.remainingSeconds = this.timeLimitSeconds;

        this.switchScreen("screenGame");

        // Start countdown timer
        const timerVal = document.getElementById("timerVal");
        const statusBanner = document.getElementById("statusBanner");
        if (statusBanner) {
            const mins = Math.floor(this.timeLimitSeconds / 60);
            const secs = this.timeLimitSeconds % 60;
            const timeFormatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            let minuteWord = "";
            if (mins === 1 && secs === 0) {
                minuteWord = "1 minute";
            } else if (secs === 0) {
                minuteWord = `${mins} minutes`;
            } else if (mins === 0) {
                minuteWord = `${secs} seconds`;
            } else {
                minuteWord = `${mins}m ${secs}s`;
            }
            statusBanner.textContent = `Race to find letters A, C, M! You have ${minuteWord} (${timeFormatted})!`;
        }

        if (this.timerCountdownInterval) clearInterval(this.timerCountdownInterval);

        // Adjust remaining time based on server start time if available
        if (startTime) {
            let st = Number(startTime);
            if (st > 0 && st < 10000000000) st = st * 1000;
            const elapsed = Math.floor((Date.now() - st) / 1000);
            if (elapsed >= 0 && elapsed < this.timeLimitSeconds) {
                this.remainingSeconds = this.timeLimitSeconds - elapsed;
            } else if (elapsed < 0) {
                // Client clock is behind server clock, grant full round time limit
                this.remainingSeconds = this.timeLimitSeconds;
            } else {
                this.remainingSeconds = 0;
            }
        }

        this.updateTimerDisplay();

        this.timerCountdownInterval = setInterval(() => {
            this.remainingSeconds--;
            this.updateTimerDisplay();

            if (this.remainingSeconds <= 0) {
                clearInterval(this.timerCountdownInterval);
                // Timer expired!
                this.handleTimeExpired();
            }
        }, 1000);

        // Reset game instance maze
        if (window.gameInstance) {
            window.gameInstance.resizeCanvas();
            window.gameInstance.resetGame();
            // Hook completion callback:
            // "after collecting all letters people automatically land on waiting page again until timer goes off or host end game"
            window.gameInstance.onSpellComplete = (stats) => {
                this.onPlayerCompletedSpell(stats);
            };
            // Hook live letter collection callback:
            window.gameInstance.onLetterCollected = (letter, sequence) => {
                this.onPlayerCollectedLetter(letter, sequence);
            };
        }
    }

    onPlayerCollectedLetter(letter, sequence) {
        if (!this.currentPlayer) return;
        this.sync.updatePlayerProgress(this.currentPlayer.id, sequence);
    }

    updateTimerDisplay() {
        const timerVal = document.getElementById("timerVal");
        if (timerVal) {
            const clamped = Math.max(0, this.remainingSeconds);
            const mins = String(Math.floor(clamped / 60)).padStart(2, '0');
            const secs = String(clamped % 60).padStart(2, '0');
            timerVal.textContent = `${mins}:${secs}`;
            if (clamped <= 15) {
                timerVal.style.color = '#ef4444';
            } else {
                timerVal.style.color = '#38bdf8';
            }
        }
    }

    onPlayerCompletedSpell(stats) {
        if (this.gameFinished) return;
        // Strict guard: verify sequence contains all 3 distinct letters 'A', 'C', and 'M'
        const seq = (stats && Array.isArray(stats.sequence)) ? stats.sequence : [];
        const hasA = seq.includes('A');
        const hasC = seq.includes('C');
        const hasM = seq.includes('M');
        if (!hasA || !hasC || !hasM || seq.length < 3) {
            console.warn("Premature spell completion rejected: missing runes", seq);
            return;
        }
        this.gameFinished = true;
        this.finishTimestamp = Date.now();
        if (this.timerCountdownInterval) clearInterval(this.timerCountdownInterval);

        const timeTaken = stats.seconds;
        const mins = String(Math.floor(timeTaken / 60)).padStart(2, '0');
        const secs = String(timeTaken % 60).padStart(2, '0');
        const formatted = `${mins}:${secs}`;

        // Sync to host/cloud
        if (this.currentPlayer) {
            Promise.resolve(this.sync.markPlayerFinished(this.currentPlayer.id, timeTaken, formatted, stats.sequence)).then((res) => {
                if (res && res.room && res.room.status === "ENDED") {
                    this.showLeaderboard(res.room);
                }
            }).catch(() => {});
        }

        // Show player finished waiting page:
        // "after collecting all letters people automatically land on waiting page again until timer goes off or host end game."
        const finishTimeDisplay = document.getElementById("finishedTimeDisplay");
        const finishStepsDisplay = document.getElementById("finishedStepsDisplay");
        const finishOrderDisplay = document.getElementById("finishedOrderDisplay");

        if (finishTimeDisplay) finishTimeDisplay.textContent = formatted;
        if (finishStepsDisplay) finishStepsDisplay.textContent = stats.steps;
        if (finishOrderDisplay) finishOrderDisplay.textContent = stats.sequence.join(' ➔ ');

        this.switchScreen("screenFinishedWaiting");
    }

    handleTimeExpired() {
        if (this.gameFinished) return;
        this.gameFinished = true;
        this.finishTimestamp = null;

        // Player ran out of time without finding all letters
        this.switchScreen("screenFinishedWaiting");
        const title = document.getElementById("finishedTitle");
        const desc = document.getElementById("finishedDesc");
        if (title) title.textContent = "⏰ TIME'S UP!";
        if (desc) desc.textContent = "Round has concluded. Calculating final leaderboard rankings...";
    }

    showLeaderboard(state) {
        if (this.timerCountdownInterval) clearInterval(this.timerCountdownInterval);

        // If player completed the spell very recently, give them a brief moment to see
        // their completion card before automatically transitioning to the podium
        const now = Date.now();
        const timeSinceFinish = this.finishTimestamp ? (now - this.finishTimestamp) : 9999;
        const delay = Math.max(0, 1600 - timeSinceFinish);

        if (delay > 0) {
            const desc = document.getElementById("finishedDesc");
            if (desc) {
                desc.textContent = "🎉 All players have finished! Revealing final rankings...";
            }
            setTimeout(() => {
                this.renderLeaderboard(state);
            }, delay);
        } else {
            this.renderLeaderboard(state);
        }
    }

    renderLeaderboard(state) {
        this.switchScreen("screenLeaderboard");

        // Calculate and sort rankings
        const playerList = Object.values(state.players || {});
        playerList.sort((a, b) => {
            if (a.finished && !b.finished) return -1;
            if (!a.finished && b.finished) return 1;
            if (a.finished && b.finished) {
                return (a.finishTimeSeconds || 9999) - (b.finishTimeSeconds || 9999);
            }
            return 0;
        });

        // Personal rank announcement
        const myRankEl = document.getElementById("myRankAnnouncement");
        if (myRankEl && this.currentPlayer) {
            const idx = playerList.findIndex(p => p.id === this.currentPlayer.id);
            if (idx !== -1) {
                const rankNum = idx + 1;
                const me = playerList[idx];
                if (me.finished) {
                    myRankEl.innerHTML = `🎉 You ranked <strong>#${rankNum}</strong> out of ${playerList.length} players! (Time: ${me.finishTimeFormatted})`;
                } else {
                    myRankEl.innerHTML = `You completed the round ranked <strong>#${rankNum}</strong>!`;
                }
            }
        }

        // Podium render
        const p1Name = document.getElementById("podium1Name");
        const p1Time = document.getElementById("podium1Time");
        const p2Name = document.getElementById("podium2Name");
        const p2Time = document.getElementById("podium2Time");
        const p3Name = document.getElementById("podium3Name");
        const p3Time = document.getElementById("podium3Time");

        if (playerList[0]) {
            if (p1Name) p1Name.textContent = playerList[0].name;
            if (p1Time) p1Time.textContent = playerList[0].finished ? `⏱️ ${playerList[0].finishTimeFormatted}` : 'Exploring';
        } else {
            if (p1Name) p1Name.textContent = '-';
            if (p1Time) p1Time.textContent = '-';
        }

        if (playerList[1]) {
            if (p2Name) p2Name.textContent = playerList[1].name;
            if (p2Time) p2Time.textContent = playerList[1].finished ? `⏱️ ${playerList[1].finishTimeFormatted}` : 'Exploring';
        } else {
            if (p2Name) p2Name.textContent = '-';
            if (p2Time) p2Time.textContent = '-';
        }

        if (playerList[2]) {
            if (p3Name) p3Name.textContent = playerList[2].name;
            if (p3Time) p3Time.textContent = playerList[2].finished ? `⏱️ ${playerList[2].finishTimeFormatted}` : 'Exploring';
        } else {
            if (p3Name) p3Name.textContent = '-';
            if (p3Time) p3Time.textContent = '-';
        }

        // Full rankings table
        const tbody = document.getElementById("leaderboardBody");
        if (tbody) {
            tbody.innerHTML = "";
            playerList.forEach((p, idx) => {
                const letters = Array.isArray(p.collectedLetters) ? p.collectedLetters : (p.finished ? ['A', 'C', 'M'] : []);
                let runesHtml = '<span class="player-runes">';
                for (let i = 0; i < 3; i++) {
                    if (i > 0) runesHtml += '<span class="mini-rune-arrow">➔</span>';
                    const char = letters[i];
                    if (char) {
                        const charLower = char.toLowerCase();
                        runesHtml += `<span class="mini-rune rune-${charLower} found">${char}</span>`;
                    } else {
                        runesHtml += `<span class="mini-rune rune-empty">—</span>`;
                    }
                }
                runesHtml += '</span>';
                const seqDisplay = letters.length > 0 ? letters.join(' ➔ ') : 'None';

                const tr = document.createElement("tr");
                tr.className = `rank-row ${this.currentPlayer && p.id === this.currentPlayer.id ? 'highlight-me' : ''}`;
                tr.innerHTML = `
                    <td style="font-weight: 800;">#${idx + 1}</td>
                    <td>${this.escape(p.name)} ${this.currentPlayer && p.id === this.currentPlayer.id ? '<em>(You)</em>' : ''}</td>
                    <td style="text-align: center;">${runesHtml}</td>
                    <td>${p.finished ? `<span style="color: #00f5d4; font-weight: 700;">Completed (${p.finishTimeFormatted}) • <small style="color: #bae6fd;">${seqDisplay}</small></span>` : `<span style="color: #94a3b8;">${letters.length}/3 Runes (${seqDisplay})</span>`}</td>
                `;
                tbody.appendChild(tr);
            });
        }
    }

    async leaveGame() {
        if (!this.currentPlayer) {
            this.switchScreen("screenJoin");
            return;
        }

        // Strict condition check: Player can ONLY exit before game starts (LOBBY) or after final leaderboard (ENDED)
        const currentStatus = this.sync.cachedState ? this.sync.cachedState.status : "LOBBY";
        if (currentStatus !== "LOBBY" && currentStatus !== "ENDED") {
            alert("Exit is disabled while the game is actively in progress. You can only exit from the waiting room before the game starts, or from the final leaderboard once the round concludes.");
            return;
        }

        const confirmMsg = currentStatus === "LOBBY"
            ? "Are you sure you want to completely leave the game and room?"
            : "Are you sure you want to exit the game, remove your result, and leave the room?";

        if (!confirm(confirmMsg)) return;

        const leavingPlayerId = this.currentPlayer.id;

        // Clear local session/storage immediately
        this.currentPlayer = null;
        try { sessionStorage.removeItem(`acm_player_${this.roomId}`); } catch (e) {}
        try { localStorage.removeItem(`acm_player_${this.roomId}`); } catch (e) {}

        // Reset state and intervals
        this.gameStarted = false;
        this.gameFinished = false;
        this.finishTimestamp = null;
        if (this.timerCountdownInterval) clearInterval(this.timerCountdownInterval);
        this.hideCountdownOverlay();

        // Reset 3D game instance if running
        if (window.gameInstance) {
            if (window.gameInstance.sound && typeof window.gameInstance.sound.stopAll === 'function') {
                try { window.gameInstance.sound.stopAll(); } catch (e) {}
            }
            if (typeof window.gameInstance.resetGame === 'function') {
                try { window.gameInstance.resetGame(); } catch (e) {}
            }
        }

        // Notify server/sync provider to delete player completely
        try {
            await this.sync.leaveRoom(leavingPlayerId);
        } catch (e) {}

        // Return player back to Join screen
        this.switchScreen("screenJoin");
        const nicknameInput = document.getElementById("inputNickname");
        if (nicknameInput) nicknameInput.value = "";
    }

    escape(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
}

window.addEventListener("DOMContentLoaded", () => {
    window.playerClient = new PlayerController();
});
