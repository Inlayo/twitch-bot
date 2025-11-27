require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const STREAMER_FILE = path.join(__dirname, "streamers.json");
if (!fs.existsSync(STREAMER_FILE)) {
  fs.writeFileSync(STREAMER_FILE, JSON.stringify([]));
}

function loadStreamers() {
  return JSON.parse(fs.readFileSync(STREAMER_FILE));
}

function saveStreamers(data) {
  fs.writeFileSync(STREAMER_FILE, JSON.stringify(data, null, 2));
}

let streamers = loadStreamers();
let liveStatus = {};

const THUMBNAIL_DIR = path.join(__dirname, "thumbnails");
if (!fs.existsSync(THUMBNAIL_DIR)) {
  fs.mkdirSync(THUMBNAIL_DIR);
}

async function downloadThumbnail(url, filename) {
  const filepath = path.join(THUMBNAIL_DIR, filename);
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    fs.writeFileSync(filepath, response.data);
    return filepath;
  } catch {
    return null;
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const app = express();
const port = process.env.PORT || 3000;

const twitchClientID = process.env.TWITCH_CLIENT_ID;
const twitchSecret = process.env.TWITCH_SECRET;
const discordChannelID = process.env.DISCORD_CHANNEL_ID;

let twitchToken = null;

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity("osu!", { type: 0 });
});

client.login(process.env.DISCORD_BOT_TOKEN);

async function fetchTwitchToken() {
  try {
    const res = await axios.post(
      `https://id.twitch.tv/oauth2/token?client_id=${twitchClientID}&client_secret=${twitchSecret}&grant_type=client_credentials`
    );
    twitchToken = res.data.access_token;
  } catch {}
}

fetchTwitchToken();
setInterval(fetchTwitchToken, 86400000);

async function autoFixStreamers() {
  let changed = false;
  let updated = [];

  for (const s of streamers) {
    if (typeof s === "string") {
      try {
        const res = await axios.get(
          `https://api.twitch.tv/helix/users?login=${s}`,
          {
            headers: {
              "Client-ID": twitchClientID,
              Authorization: `Bearer ${twitchToken}`,
            },
          }
        );
        if (res.data.data.length > 0) {
          updated.push({
            login: res.data.data[0].login.toLowerCase(),
            userid: res.data.data[0].id,
          });
          changed = true;
        }
      } catch {}
    } else if (!s.userid) {
      try {
        const res = await axios.get(
          `https://api.twitch.tv/helix/users?login=${s.login}`,
          {
            headers: {
              "Client-ID": twitchClientID,
              Authorization: `Bearer ${twitchToken}`,
            },
          }
        );
        if (res.data.data.length > 0) {
          updated.push({
            login: res.data.data[0].login.toLowerCase(),
            userid: res.data.data[0].id,
          });
          changed = true;
        }
      } catch {}
    } else {
      updated.push(s);
    }
  }

  if (changed) {
    streamers = updated;
    saveStreamers(updated);
  }

  liveStatus = {};
  for (const s of streamers) liveStatus[s.login] = false;
}

setTimeout(autoFixStreamers, 2000);

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  const prefix = "Inlayo";
  if (!msg.content.startsWith(prefix)) return;

  const args = msg.content.slice(prefix.length).trim().split(/ +/);
  const command = args[0]?.toLowerCase();
  const name = args[1]?.toLowerCase();

  if (command === "add") {
    if (!name) return msg.reply("Please provide a streamer name.");
    if (streamers.find((s) => s.login === name))
      return msg.reply("Streamer already exists.");

    const userInfoRes = await axios.get(
      `https://api.twitch.tv/helix/users?login=${name}`,
      {
        headers: {
          "Client-ID": twitchClientID,
          Authorization: `Bearer ${twitchToken}`,
        },
      }
    );

    if (userInfoRes.data.data.length === 0)
      return msg.reply("Twitch user not found.");

    const userInfo = userInfoRes.data.data[0];

    streamers.push({
      login: userInfo.login.toLowerCase(),
      userid: userInfo.id,
    });

    liveStatus[userInfo.login] = false;
    saveStreamers(streamers);

    return msg.reply(`Streamer ${userInfo.login} added.`);
  }

  if (command === "delete") {
    if (!name) return msg.reply("Please provide a streamer name.");

    const exists = streamers.find((s) => s.login === name);
    if (!exists) return msg.reply("Streamer not found.");

    streamers = streamers.filter((s) => s.login !== name);
    saveStreamers(streamers);

    return msg.reply(`Streamer ${name} deleted.`);
  }

  if (command === "list") {
    if (streamers.length === 0) return msg.reply("No streamers saved.");
    return msg.reply(
      "Streamers:\n" +
        streamers.map((s) => `• \`${s.login}\` (ID: ${s.userid})`).join("\n")
    );
  }

  msg.reply("Commands: add, delete, list");
});

async function checkLoginChanged(streamer) {
  const { login, userid } = streamer;

  try {
    const res = await axios.get(
      `https://api.twitch.tv/helix/users?login=${login}`,
      {
        headers: {
          "Client-ID": twitchClientID,
          Authorization: `Bearer ${twitchToken}`,
        },
      }
    );
    if (res.data.data.length > 0) return login;
  } catch {}

  try {
    const idCheck = await axios.get(
      `https://api.twitch.tv/helix/users?id=${userid}`,
      {
        headers: {
          "Client-ID": twitchClientID,
          Authorization: `Bearer ${twitchToken}`,
        },
      }
    );

    if (idCheck.data.data.length === 0) return login;

    const newLogin = idCheck.data.data[0].login.toLowerCase();
    streamer.login = newLogin;
    saveStreamers(streamers);
    return newLogin;
  } catch {}

  return login;
}

async function sendLiveNotification(streamInfo, userInfo) {
  const login = streamInfo.user_login;
  const channel = client.channels.cache.get(discordChannelID);

  const embed = new EmbedBuilder()
    .setAuthor({
      name: `${login} is now live on Twitch!`,
      iconURL: userInfo.profile_image_url,
      url: `https://twitch.tv/${login}`,
    })
    .setTitle(streamInfo.title)
    .setURL(`https://twitch.tv/${login}`)
    .setColor("#9146FF")
    .setFooter({ text: `made by Inlayo` })
    .setTimestamp();

  if (streamInfo.game_name && streamInfo.game_name !== "Unknown") {
    embed.addFields({
      name: "Game",
      value: streamInfo.game_name,
      inline: true,
    });
  }

  let thumbnailPath = path.join(THUMBNAIL_DIR, `${login}.jpg`);

  if (!fs.existsSync(thumbnailPath)) {
    const dl = await downloadThumbnail(
      streamInfo.thumbnail_url
        .replace("{width}", 1280)
        .replace("{height}", 720),
      `${login}.jpg`
    );
    if (dl) thumbnailPath = dl;
    else thumbnailPath = null;
  }

  if (thumbnailPath) {
    embed.setImage(`attachment://${login}.jpg`);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Watch Stream")
      .setStyle(ButtonStyle.Link)
      .setURL(`https://twitch.tv/${login}`)
  );

  const files = thumbnailPath
    ? [{ attachment: thumbnailPath, name: `${login}.jpg` }]
    : [];

  await channel.send({ embeds: [embed], components: [row], files });
}

async function checkStreamer(streamer) {
  try {
    const login = await checkLoginChanged(streamer);

    const res = await axios.get(
      `https://api.twitch.tv/helix/streams?user_login=${login}`,
      {
        headers: {
          "Client-ID": twitchClientID,
          Authorization: `Bearer ${twitchToken}`,
        },
      }
    );

    const data = res.data.data;

    if (data.length > 0) {
      if (!liveStatus[login]) {
        liveStatus[login] = true;

        const streamInfo = data[0];

        const userInfoRes = await axios.get(
          `https://api.twitch.tv/helix/users?login=${login}`,
          {
            headers: {
              "Client-ID": twitchClientID,
              Authorization: `Bearer ${twitchToken}`,
            },
          }
        );

        const userInfo = userInfoRes.data.data[0];

        sendLiveNotification(streamInfo, userInfo);
      }
    } else {
      liveStatus[login] = false;
    }
  } catch {}
}

setInterval(() => {
  if (!twitchToken) return;
  streamers.forEach(checkStreamer);
}, 60000);

app.get("/status", (req, res) => res.json(liveStatus));
app.get("/discord", (req, res) => res.json({ connected: !!client.readyAt }));
app.get("/twitch", (req, res) => res.json({ token: !!twitchToken }));

app.listen(port, () => {});
