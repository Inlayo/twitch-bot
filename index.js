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

const GUILD_SETTINGS_FILE = path.join(__dirname, "guild-settings.json");
if (!fs.existsSync(GUILD_SETTINGS_FILE)) {
  fs.writeFileSync(GUILD_SETTINGS_FILE, JSON.stringify({}));
}

function loadGuildSettings() {
  return JSON.parse(fs.readFileSync(GUILD_SETTINGS_FILE));
}

function saveGuildSettings(data) {
  fs.writeFileSync(GUILD_SETTINGS_FILE, JSON.stringify(data, null, 2));
}

function getGuildSetting(guildId) {
  const settings = loadGuildSettings();
  if (!settings[guildId]) {
    settings[guildId] = {
      channelId: null,
      streamers: [],
      liveStatus: {}
    };
    saveGuildSettings(settings);
  }
  return settings[guildId];
}

function updateGuildSetting(guildId, updates) {
  const settings = loadGuildSettings();
  settings[guildId] = { ...settings[guildId], ...updates };
  saveGuildSettings(settings);
}

let guildSettings = loadGuildSettings();

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
  } catch { }
}

fetchTwitchToken();
setInterval(fetchTwitchToken, 86400000);

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.guild) return;

  const prefix = "!t";
  if (!msg.content.startsWith(prefix)) return;

  const args = msg.content.slice(prefix.length).trim().split(/ +/);
  const command = args[0]?.toLowerCase();
  const name = args[1]?.toLowerCase();

  const guildId = msg.guild.id;
  const guildSetting = getGuildSetting(guildId);

  if (command === "channel") {
    if (!msg.member.permissions.has("ManageGuild")) {
      return msg.reply("You need 'Manage Server' permission to use this command.");
    }

    updateGuildSetting(guildId, {
      ...guildSetting,
      channelId: msg.channel.id
    });

    return msg.reply(`Notification channel set to ${msg.channel.name}`);
  }

  if (command === "add") {
    if (!name) return msg.reply("Please provide a streamer name.");

    if (guildSetting.streamers.find((s) => s.login === name))
      return msg.reply("Streamer already exists in this server.");

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
    const newStreamer = {
      login: userInfo.login.toLowerCase(),
      userid: userInfo.id,
    };

    guildSetting.streamers.push(newStreamer);
    guildSetting.liveStatus[userInfo.login] = false;

    updateGuildSetting(guildId, guildSetting);

    return msg.reply(`Streamer ${userInfo.login} added to this server.`);
  }

  if (command === "delete") {
    if (!name) return msg.reply("Please provide a streamer name.");

    const exists = guildSetting.streamers.find((s) => s.login === name);
    if (!exists) return msg.reply("Streamer not found in this server.");

    guildSetting.streamers = guildSetting.streamers.filter((s) => s.login !== name);
    delete guildSetting.liveStatus[name];

    updateGuildSetting(guildId, guildSetting);

    return msg.reply(`Streamer ${name} removed from this server.`);
  }

  if (command === "list") {
    if (guildSetting.streamers.length === 0) return msg.reply("No streamers saved in this server.");

    const channelInfo = guildSetting.channelId
      ? `<#${guildSetting.channelId}>`
      : "Not set (use !t channel)";

    return msg.reply(
      `**Notification Channel:** ${channelInfo}\n\n` +
      "**Streamers:**\n" +
      guildSetting.streamers.map((s) => `• \`${s.login}\` (ID: ${s.userid})`).join("\n")
    );
  }

  msg.reply("Commands: channel, add, delete, list");
});

async function checkLoginChanged(streamer, guildId) {
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
  } catch { }

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

    const guildSetting = getGuildSetting(guildId);
    const streamerIndex = guildSetting.streamers.findIndex(s => s.userid === userid);
    if (streamerIndex !== -1) {
      guildSetting.streamers[streamerIndex].login = newLogin;
      updateGuildSetting(guildId, guildSetting);
    }

    return newLogin;
  } catch { }

  return login;
}

async function sendLiveNotification(streamInfo, userInfo, guildId, channelId) {
  const login = streamInfo.user_login;
  const channel = client.channels.cache.get(channelId);

  if (!channel) return;

  const embed = new EmbedBuilder()
    .setAuthor({
      name: `${login} is now live on Twitch!`,
      iconURL: userInfo.profile_image_url,
      url: `https://twitch.tv/${login}`,
    })
    .setTitle(streamInfo.title || "No title")
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

  const oldFiles = fs.readdirSync(THUMBNAIL_DIR).filter(f => f.startsWith(`${login}_`));
  oldFiles.forEach(f => {
    try {
      fs.unlinkSync(path.join(THUMBNAIL_DIR, f));
    } catch { }
  });

  const timestamp = Date.now();
  const filename = `${login}_${timestamp}.jpg`;

  const thumbnailUrl = streamInfo.thumbnail_url
    .replace("{width}", 1280)
    .replace("{height}", 720) + `?t=${timestamp}`;

  const downloaded = await downloadThumbnail(thumbnailUrl, filename);
  let thumbnailPath = downloaded;

  if (thumbnailPath) {
    embed.setImage(`attachment://${filename}`);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Watch Stream")
      .setStyle(ButtonStyle.Link)
      .setURL(`https://twitch.tv/${login}`)
  );

  const files = thumbnailPath
    ? [{ attachment: thumbnailPath, name: path.basename(thumbnailPath) }]
    : [];

  await channel.send({ embeds: [embed], components: [row], files });

  console.log(`[LIVE NOTIFY] ${login} — ${streamInfo.title} (Guild: ${guildId})`);
}

async function checkStreamer(streamer, guildId, channelId) {
  try {
    const login = await checkLoginChanged(streamer, guildId);

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
    const guildSetting = getGuildSetting(guildId);

    if (data.length > 0) {
      if (!guildSetting.liveStatus[login]) {
        guildSetting.liveStatus[login] = true;
        updateGuildSetting(guildId, guildSetting);

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

        sendLiveNotification(streamInfo, userInfo, guildId, channelId);
      }
    } else {
      if (guildSetting.liveStatus[login]) {
        guildSetting.liveStatus[login] = false;
        updateGuildSetting(guildId, guildSetting);
      }
    }
  } catch { }
}

setInterval(() => {
  if (!twitchToken) return;

  const allSettings = loadGuildSettings();

  for (const [guildId, setting] of Object.entries(allSettings)) {
    if (!setting.channelId || !setting.streamers || setting.streamers.length === 0) continue;

    setting.streamers.forEach(streamer => {
      checkStreamer(streamer, guildId, setting.channelId);
    });
  }
}, 60000);

app.get("/status", (req, res) => {
  const allSettings = loadGuildSettings();
  const statusByGuild = {};

  for (const [guildId, setting] of Object.entries(allSettings)) {
    statusByGuild[guildId] = setting.liveStatus || {};
  }

  res.json(statusByGuild);
});
app.get("/discord", (req, res) => res.json({ connected: !!client.readyAt }));
app.get("/twitch", (req, res) => res.json({ token: !!twitchToken }));

app.listen(port, () => { });
