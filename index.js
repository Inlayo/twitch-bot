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
  REST,
  Routes,
} = require("discord.js");

const SETTINGS_DIR = path.join(__dirname, "settings");
if (!fs.existsSync(SETTINGS_DIR)) {
  fs.mkdirSync(SETTINGS_DIR);
}

function getChannelSettingFile(channelId) {
  return path.join(SETTINGS_DIR, `${channelId}.json`);
}

function loadChannelSettings(channelId) {
  const file = getChannelSettingFile(channelId);
  if (!fs.existsSync(file)) {
    const defaultSettings = {
      streamers: [],
      liveStatus: {}
    };
    fs.writeFileSync(file, JSON.stringify(defaultSettings, null, 2));
    return defaultSettings;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveChannelSettings(channelId, data) {
  const file = getChannelSettingFile(channelId);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getAllChannelIds() {
  if (!fs.existsSync(SETTINGS_DIR)) return [];
  return fs.readdirSync(SETTINGS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

// Backward compatibility: migrate old guild-settings.json to new structure
const OLD_GUILD_SETTINGS_FILE = path.join(__dirname, "guild-settings.json");
if (fs.existsSync(OLD_GUILD_SETTINGS_FILE)) {
  try {
    const oldSettings = JSON.parse(fs.readFileSync(OLD_GUILD_SETTINGS_FILE, 'utf8'));
    for (const [guildId, setting] of Object.entries(oldSettings)) {
      if (setting.channelId) {
        const channelId = setting.channelId;
        const newSettings = {
          streamers: setting.streamers || [],
          liveStatus: setting.liveStatus || {}
        };
        saveChannelSettings(channelId, newSettings);
      }
    }
    // Rename old file to backup
    fs.renameSync(OLD_GUILD_SETTINGS_FILE, OLD_GUILD_SETTINGS_FILE + '.backup');
    console.log('Migrated old guild-settings.json to new settings structure');
  } catch (err) {
    console.error('Error migrating old settings:', err);
  }
}

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

client.on("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity("osu!", { type: 0 });
  
  // Register slash commands
  const commands = [
    {
      name: 'twitch',
      description: 'Manage Twitch stream notifications',
      options: [
        {
          name: 'add',
          description: 'Add a streamer to this channel',
          type: 1, // SUB_COMMAND
          options: [
            {
              name: 'streamer',
              description: 'Twitch username',
              type: 3, // STRING
              required: true
            }
          ]
        },
        {
          name: 'delete',
          description: 'Remove a streamer from this channel',
          type: 1,
          options: [
            {
              name: 'streamer',
              description: 'Twitch username',
              type: 3,
              required: true
            }
          ]
        },
        {
          name: 'list',
          description: 'List all streamers in this channel',
          type: 1
        },
        {
          name: 'channel',
          description: 'Setup this channel for stream notifications',
          type: 1
        }
      ]
    }
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  
  try {
    console.log('Registering slash commands...');
    const applicationId = process.env.DISCORD_APPLICATION_ID || client.user.id;
    await rest.put(
      Routes.applicationCommands(applicationId),
      { body: commands }
    );
    console.log('Slash commands registered!');
  } catch (error) {
    console.error('Error registering slash commands:', error);
  }
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

  const channelId = msg.channel.id;
  const channelSettings = loadChannelSettings(channelId);

  if (command === "channel") {
    // This command is now implicit - settings are per channel
    return msg.reply(`This channel is now set up for stream notifications. Use \`!t add <streamer>\` to add streamers.`);
  }

  if (command === "add") {
    if (!name) return msg.reply("Please provide a streamer name.");

    if (channelSettings.streamers.find((s) => s.login === name))
      return msg.reply("Streamer already exists in this channel.");

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

    channelSettings.streamers.push(newStreamer);
    channelSettings.liveStatus[userInfo.login] = false;

    saveChannelSettings(channelId, channelSettings);

    return msg.reply(`Streamer ${userInfo.login} added to this channel.`);
  }

  if (command === "delete") {
    if (!name) return msg.reply("Please provide a streamer name.");

    const exists = channelSettings.streamers.find((s) => s.login === name);
    if (!exists) return msg.reply("Streamer not found in this channel.");

    channelSettings.streamers = channelSettings.streamers.filter((s) => s.login !== name);
    delete channelSettings.liveStatus[name];

    saveChannelSettings(channelId, channelSettings);

    return msg.reply(`Streamer ${name} removed from this channel.`);
  }

  if (command === "list") {
    if (channelSettings.streamers.length === 0) return msg.reply("No streamers saved in this channel.");

    return msg.reply(
      "**Streamers:**\n" +
      channelSettings.streamers.map((s) => `• \`${s.login}\` (ID: ${s.userid})`).join("\n")
    );
  }

  msg.reply("Commands: channel, add, delete, list");
});

// Handle slash commands
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  
  if (interaction.commandName === 'twitch') {
    const subcommand = interaction.options.getSubcommand();
    const channelId = interaction.channel.id;
    const channelSettings = loadChannelSettings(channelId);
    
    if (subcommand === 'channel') {
      await interaction.reply(`This channel is now set up for stream notifications. Use \`/twitch add\` to add streamers.`);
    }
    
    else if (subcommand === 'add') {
      const name = interaction.options.getString('streamer').toLowerCase();
      
      if (channelSettings.streamers.find((s) => s.login === name)) {
        return interaction.reply('Streamer already exists in this channel.');
      }
      
      try {
        const userInfoRes = await axios.get(
          `https://api.twitch.tv/helix/users?login=${name}`,
          {
            headers: {
              "Client-ID": twitchClientID,
              Authorization: `Bearer ${twitchToken}`,
            },
          }
        );
        
        if (userInfoRes.data.data.length === 0) {
          return interaction.reply('Twitch user not found.');
        }
        
        const userInfo = userInfoRes.data.data[0];
        const newStreamer = {
          login: userInfo.login.toLowerCase(),
          userid: userInfo.id,
        };
        
        channelSettings.streamers.push(newStreamer);
        channelSettings.liveStatus[userInfo.login] = false;
        
        saveChannelSettings(channelId, channelSettings);
        
        await interaction.reply(`Streamer ${userInfo.login} added to this channel.`);
      } catch (error) {
        await interaction.reply('Error adding streamer. Please try again.');
      }
    }
    
    else if (subcommand === 'delete') {
      const name = interaction.options.getString('streamer').toLowerCase();
      
      const exists = channelSettings.streamers.find((s) => s.login === name);
      if (!exists) {
        return interaction.reply('Streamer not found in this channel.');
      }
      
      channelSettings.streamers = channelSettings.streamers.filter((s) => s.login !== name);
      delete channelSettings.liveStatus[name];
      
      saveChannelSettings(channelId, channelSettings);
      
      await interaction.reply(`Streamer ${name} removed from this channel.`);
    }
    
    else if (subcommand === 'list') {
      if (channelSettings.streamers.length === 0) {
        return interaction.reply('No streamers saved in this channel.');
      }
      
      await interaction.reply(
        "**Streamers:**\n" +
        channelSettings.streamers.map((s) => `• \`${s.login}\` (ID: ${s.userid})`).join("\n")
      );
    }
  }
});

async function checkLoginChanged(streamer, channelId) {
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

    const channelSettings = loadChannelSettings(channelId);
    const streamerIndex = channelSettings.streamers.findIndex(s => s.userid === userid);
    if (streamerIndex !== -1) {
      channelSettings.streamers[streamerIndex].login = newLogin;
      saveChannelSettings(channelId, channelSettings);
    }

    return newLogin;
  } catch { }

  return login;
}

async function sendLiveNotification(streamInfo, userInfo, channelId) {
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

  console.log(`[LIVE NOTIFY] ${login} — ${streamInfo.title} (Channel: ${channelId})`);
}

async function checkStreamer(streamer, channelId) {
  try {
    const login = await checkLoginChanged(streamer, channelId);

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
    const channelSettings = loadChannelSettings(channelId);

    if (data.length > 0) {
      if (!channelSettings.liveStatus[login]) {
        channelSettings.liveStatus[login] = true;
        saveChannelSettings(channelId, channelSettings);

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

        sendLiveNotification(streamInfo, userInfo, channelId);
      }
    } else {
      if (channelSettings.liveStatus[login]) {
        channelSettings.liveStatus[login] = false;
        saveChannelSettings(channelId, channelSettings);
      }
    }
  } catch { }
}

setInterval(() => {
  if (!twitchToken) return;

  const allChannelIds = getAllChannelIds();

  for (const channelId of allChannelIds) {
    const settings = loadChannelSettings(channelId);
    
    if (!settings.streamers || settings.streamers.length === 0) continue;

    settings.streamers.forEach(streamer => {
      checkStreamer(streamer, channelId);
    });
  }
}, 60000);

app.get("/status", (req, res) => {
  const allChannelIds = getAllChannelIds();
  const statusByChannel = {};

  for (const channelId of allChannelIds) {
    const settings = loadChannelSettings(channelId);
    statusByChannel[channelId] = settings.liveStatus || {};
  }

  res.json(statusByChannel);
});
app.get("/discord", (req, res) => res.json({ connected: !!client.readyAt }));
app.get("/twitch", (req, res) => res.json({ token: !!twitchToken }));

app.listen(port, () => { });
