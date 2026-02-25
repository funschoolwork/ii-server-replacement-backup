/**
 * ii's Stupid Menu - Replacement Server
 * Drop-in replacement for https://iidk.online
 * Deploy on Render as a Web Service (Node.js)
 */

const express = require("express");
const { WebSocketServer } = require("ws");
const cors = require("cors");
const http = require("http");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
//  DATA HELPERS
// ─────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, "data");

function readJSON(file) {
  const fp = path.join(DATA_DIR, file);
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); }
  catch { return null; }
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

function initData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(path.join(DATA_DIR, "serverdata.json"))) {
    writeJSON("serverdata.json", {
      // ── Version control ──────────────────────────────────────────────
      // "menu-version"        : latest released version (shown in update prompt)
      // "min-version"         : if client is below this, menu gets DISABLED
      // "min-console-version" : if below this, admin list is NOT loaded
      "menu-version": "8.5.1",
      "min-version": "8.0.0",
      "min-console-version": "1.0.0",

      // ── Display ──────────────────────────────────────────────────────
      // Placeholders: {0}=version, {1}=mod count, {2}=build type, {3}=build timestamp
      "motd": "You are using build {0}. Welcome to ii's Stupid Menu! SERVER FIX BY N5!!!",
      "discord-invite": "https://discord.gg/iidk",

      // ── Admins ───────────────────────────────────────────────────────
      // TO ADD AN ADMIN: add an object to this array:
      //   { "name": "YourName", "user-id": "YourPlayFabUserIdHere" }
      // The PlayFab user ID can be found in-game or via the Gorilla Tag API.
      "admins": [
          { "name": "N5", "user-id": "1522F007FE79BFE1" }
      ],

      // Super admins: list of admin *names* (must match a name in admins above)
      "super-admins": [
        "N5"
      ],

      // ── Patreon members ──────────────────────────────────────────────
      // { "name": "Tier Name", "user-id": "PlayFabUserId", "photo": "https://icon-url" }
      "patreon": [],

      // ── Poll ─────────────────────────────────────────────────────────
      "poll": "What goes well with cheeseburgers?",
      "option-a": "Fries",
      "option-b": "Chips",

      // ── Detected / disabled mods ─────────────────────────────────────
      // Any mod button names listed here will be force-disabled on all clients
      "detected-mods": []
    });
  }

  if (!fs.existsSync(path.join(DATA_DIR, "friends.json")))
    writeJSON("friends.json", {});

  if (!fs.existsSync(path.join(DATA_DIR, "votes.json")))
    writeJSON("votes.json", { "a-votes": 0, "b-votes": 0, poll: "" });
}

initData();

// ─────────────────────────────────────────────
//  GET /serverdata
//  Called every ~60s by every client on startup.
// ─────────────────────────────────────────────

app.get("/serverdata", (req, res) => {
  const data = readJSON("serverdata.json");
  if (!data) return res.status(500).json({ error: "Server data unavailable" });
  res.json(data);
});

// ─────────────────────────────────────────────
//  POST /telemetry  — room/player join data
// ─────────────────────────────────────────────

app.post("/telemetry", (req, res) => {
  console.log("[telemetry]", JSON.stringify(req.body));
  res.json({ success: true });
});

// ─────────────────────────────────────────────
//  POST /syncdata  — periodic player list sync
// ─────────────────────────────────────────────

app.post("/syncdata", (req, res) => {
  console.log("[syncdata] room:", req.body?.directory);
  res.json({ success: true });
});

// ─────────────────────────────────────────────
//  POST /reportban  — ban report + mod list
// ─────────────────────────────────────────────

app.post("/reportban", (req, res) => {
  console.log("[reportban]", req.body?.error);
  res.json({ success: true });
});

// ─────────────────────────────────────────────
//  POST /vote  — poll voting
// ─────────────────────────────────────────────

app.post("/vote", (req, res) => {
  const { option } = req.body;
  const votes = readJSON("votes.json") || { "a-votes": 0, "b-votes": 0, poll: "" };
  const serverdata = readJSON("serverdata.json");
  const currentPoll = serverdata?.poll || "";

  // Reset counts when poll question changes
  if (votes.poll !== currentPoll) {
    votes["a-votes"] = 0;
    votes["b-votes"] = 0;
    votes.poll = currentPoll;
  }

  if (option === "a-votes") votes["a-votes"]++;
  else if (option === "b-votes") votes["b-votes"]++;

  writeJSON("votes.json", votes);
  res.json({ "a-votes": votes["a-votes"], "b-votes": votes["b-votes"] });
});

// ─────────────────────────────────────────────
//  POST /tts
//  Stub — returns 501 until you wire up a provider.
//  To integrate: send req.body.text to a TTS API
//  and pipe the audio bytes back as the response.
// ─────────────────────────────────────────────

app.post("/tts", (req, res) => {
  res.status(501).json({ error: "TTS not configured on this server." });
});

// ─────────────────────────────────────────────
//  FRIENDS — HTTP endpoints
//  The client must send its PlayFab userId in the
//  "x-uid" request header.
// ─────────────────────────────────────────────

function getUserData(uid) {
  const all = readJSON("friends.json") || {};
  if (!all[uid]) all[uid] = { friends: {}, pending: [], blocked: [] };
  return all;
}

function saveAllFriends(data) {
  writeJSON("friends.json", data);
}

// GET /getfriends
app.get("/getfriends", (req, res) => {
  // Client doesn't send a uid header, so we return empty friend data
  // The friend system works via WebSocket once the user registers
  const uid = req.headers["x-uid"] || req.query.uid;
  if (!uid) {
    return res.json({
      friends: {},
      pending: [],
      incomingRequests: [],
      blocked: []
    });
  }

  const all = getUserData(uid);
  const mine = all[uid];

  const incoming = Object.entries(all)
    .filter(([, d]) => Array.isArray(d.pending) && d.pending.includes(uid))
    .map(([id]) => id);

  res.json({
    friends: mine.friends || {},
    pending: mine.pending || [],
    incomingRequests: incoming,
    blocked: mine.blocked || []
  });
});

// POST /frienduser  — send or accept friend request
app.post("/frienduser", (req, res) => {
  const callerUid = req.headers["x-uid"] || req.body.callerUid;
  const { uid } = req.body;
  if (!callerUid || !uid) return res.status(400).json({ error: "Missing uids" });

  const all = getUserData(callerUid);
  if (!all[uid]) all[uid] = { friends: {}, pending: [], blocked: [] };

  const callerData = all[callerUid];
  const targetData = all[uid];

  // If target already sent us a request → accept
  if (Array.isArray(targetData.pending) && targetData.pending.includes(callerUid)) {
    targetData.pending = targetData.pending.filter(id => id !== callerUid);
    callerData.friends[uid] = { currentUserID: uid, currentName: uid };
    targetData.friends[callerUid] = { currentUserID: callerUid, currentName: callerUid };
    saveAllFriends(all);
    notifyUser(uid, { command: "notification", from: "Server", message: `<color=grey>[</color><color=green>FRIENDS</color><color=grey>]</color> Your friend request was accepted.`, time: 5000 });
    return res.json({ success: true, action: "accepted" });
  }

  // Otherwise queue pending request
  if (!Array.isArray(callerData.pending)) callerData.pending = [];
  if (!callerData.pending.includes(uid)) callerData.pending.push(uid);

  saveAllFriends(all);
  notifyUser(uid, { command: "notification", from: "Server", message: `<color=grey>[</color><color=green>FRIENDS</color><color=grey>]</color> You have a new friend request.`, time: 5000 });
  res.json({ success: true, action: "requested" });
});

// POST /unfrienduser  — remove / deny / cancel
app.post("/unfrienduser", (req, res) => {
  const callerUid = req.headers["x-uid"] || req.body.callerUid;
  const { uid } = req.body;
  if (!callerUid || !uid) return res.status(400).json({ error: "Missing uids" });

  const all = getUserData(callerUid);
  if (!all[uid]) all[uid] = { friends: {}, pending: [], blocked: [] };

  const callerData = all[callerUid];
  const targetData = all[uid];

  delete callerData.friends[uid];
  delete targetData.friends[callerUid];
  callerData.pending = (callerData.pending || []).filter(id => id !== uid);
  targetData.pending = (targetData.pending || []).filter(id => id !== callerUid);

  saveAllFriends(all);
  res.json({ success: true });
});

// ─────────────────────────────────────────────
//  WEBSOCKET  — Friend system & admin relay
//  Client connects to wss://your-app.onrender.com
//
//  First message must be:
//    { "command": "register", "uid": "<PlayFabUserId>" }
//
//  Supported relay commands (sent to a target uid):
//    invite, reqinvite, preferences, theme, macro, message, notification
// ─────────────────────────────────────────────

const connectedUsers = new Map(); // uid → WebSocket

function notifyUser(uid, payload) {
  const ws = connectedUsers.get(uid);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
}

wss.on("connection", (ws) => {
  let userId = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return; }

    // Registration must happen first
    if (!userId) {
      if (msg.command === "register" && msg.uid) {
        userId = msg.uid;
        connectedUsers.set(userId, ws);
        console.log(`[ws] connected: ${userId}`);
        ws.send(JSON.stringify({ command: "registered", from: "Server" }));
      }
      return;
    }

    const { command, target } = msg;
    const relayCommands = ["invite", "reqinvite", "preferences", "theme", "macro", "message", "notification"];

    if (relayCommands.includes(command) && target) {
      notifyUser(target, { ...msg, from: userId });
    }
  });

  ws.on("close", () => {
    if (userId) {
      connectedUsers.delete(userId);
      console.log(`[ws] disconnected: ${userId}`);
    }
  });

  ws.on("error", (err) => console.error("[ws] error:", err.message));
});

// ─────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ii's Stupid Menu server running on port ${PORT}`);
});
